import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SENDER_DOMAIN = "notify.inspectionclean.com";
const FROM_DOMAIN = "inspectionclean.com";
const SITE_NAME = "Inspection Clean";
const CONTACT_PHONE = "(864) 313-8418";

function stripPhone(name: string): string {
  return name
    .replace(/#\+?[\d\s\-().]{7,}#/g, "")
    .replace(/^(confirmed|pending|maybe)\s*:?\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—,:.]+$/, "")
    .trim();
}

function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

async function generateToken(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateUnsubscribeToken(email: string): Promise<string | null> {
  const normalized = email.toLowerCase();
  const { data: existing } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", normalized)
    .maybeSingle();
  if (existing && !existing.used_at) return existing.token;
  if (!existing) {
    const token = await generateToken();
    await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .upsert({ token, email: normalized }, { onConflict: "email", ignoreDuplicates: true });
    const { data: stored } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", normalized)
      .maybeSingle();
    return stored?.token ?? null;
  }
  return null;
}

async function enqueueEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<void> {
  const normalized = opts.to.toLowerCase();

  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails").select("id").eq("email", normalized).maybeSingle();
  if (suppressed) return;

  const unsubscribeToken = await getOrCreateUnsubscribeToken(opts.to);
  if (!unsubscribeToken) return;

  const messageId = crypto.randomUUID();
  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: "day-of-reminder",
    recipient_email: opts.to,
    status: "pending",
  });

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: opts.to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      purpose: "transactional",
      label: "day-of-reminder",
      idempotency_key: opts.idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) throw new Error(`Failed to enqueue reminder: ${error.message}`);
}

export const Route = createFileRoute("/api/public/hooks/send-day-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: accept cron key or authenticated admin
        const auth = request.headers.get("authorization");
        const expectedApiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const cronSecret = process.env.CRON_SECRET;
        const isCron =
          request.headers.get("apikey") === expectedApiKey ||
          (!!cronSecret && request.headers.get("x-cron-secret") === cronSecret);

        if (!isCron) {
          if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
          const token = auth.slice(7);
          const { data: claims } = await supabaseAdmin.auth.getClaims(token);
          if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        }

        // ── Build today's date window in Eastern Time ──────────────────────
        // Use UTC offsets for EDT (UTC-4) to correctly bracket today ET
        // regardless of where the server is running.
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const year = nowET.getFullYear();
        const month = nowET.getMonth();
        const day = nowET.getDate();

        // Today 00:00 ET = today 04:00 UTC (EDT, UTC-4)
        const startOfDay = new Date(Date.UTC(year, month, day, 4, 0, 0));
        // Today 23:59 ET = tomorrow 03:59 UTC (EDT, UTC-4)
        const endOfDay = new Date(Date.UTC(year, month, day + 1, 3, 59, 59));

        // Also store today's date string for idempotency keys
        const todayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const { data: todaysJobs } = await supabaseAdmin
          .from("jobs")
          .select("*")
          .gte("scheduled_at", startOfDay.toISOString())
          .lte("scheduled_at", endOfDay.toISOString())
          .neq("status", "cancelled");

        if (!todaysJobs?.length) {
          return Response.json({ ok: true, sent: 0, message: "No jobs today" });
        }

        const sent: string[] = [];
        const skipped: string[] = [];
        const errors: { customer: string; error: string }[] = [];

        for (const job of todaysJobs) {
          const cleanName = stripPhone(job.customer_name ?? "");

          try {
            // ── Find the matching intake submission ──────────────────────
            let intake: any = null;

            // 1. Match by customer email (most reliable)
            if (job.customer_email) {
              const { data } = await supabaseAdmin
                .from("intake_submissions")
                .select("*")
                .ilike("email", job.customer_email)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              intake = data;
            }

            // 2. Match by store number (e.g. #7114) — best for chain locations
            if (!intake) {
              const idMatch = (job.customer_name ?? "").match(/#\s*(\d{2,})/);
              const storeId = idMatch?.[1];
              if (storeId) {
                const { data } = await supabaseAdmin
                  .from("intake_submissions")
                  .select("*")
                  .ilike("business_name", `%${storeId}%`)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                intake = data;
              }
            }

            // 3. Match by full cleaned business name
            if (!intake && cleanName) {
              const { data } = await supabaseAdmin
                .from("intake_submissions")
                .select("*")
                .ilike("business_name", `%${cleanName}%`)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              intake = data;
            }

            // Skip if no intake found or email_reminder not enabled
            if (!intake?.email_reminder) {
              skipped.push(cleanName);
              continue;
            }

            // Skip if no email to send to
            const recipientEmail = job.customer_email || intake?.email;
            if (!recipientEmail) {
              skipped.push(`${cleanName} (no email)`);
              continue;
            }

            const contactName = intake?.contact_name || cleanName;
            const address = job.address || intake?.service_address || "";
            const jobTime = formatTime(job.scheduled_at);
            const jobDate = formatDate(job.scheduled_at);

            const subject = `Hood Cleaning Appointment Today at ${cleanName}`;

            const html = `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#222">
                <h2 style="font-size:18px;margin:0 0 16px">Hood Cleaning Appointment Today at ${escapeHtml(cleanName)}</h2>

                <p style="margin:0 0 12px">Hi ${escapeHtml(contactName)},</p>

                <p style="margin:0 0 12px">
                  This is a reminder that your scheduled hood cleaning is today,
                  <strong>${escapeHtml(jobDate)}</strong> at <strong>${escapeHtml(jobTime)}</strong>.
                </p>

                <p style="margin:0 0 12px">
                  Please ensure access is available at ${escapeHtml(address)}.
                </p>

                <p style="margin:0 0 24px">
                  Please ensure all equipment is off and cooled down by <strong>${escapeHtml(jobTime)}</strong>.
                </p>

                <p style="margin:0 0 4px">Questions? Call us at ${escapeHtml(CONTACT_PHONE)}.</p>

                <p style="margin:24px 0 0;color:#666;font-size:13px">— ${escapeHtml(SITE_NAME)}</p>
              </div>`;

            const text = [
              `Hood Cleaning Appointment Today at ${cleanName}`,
              ``,
              `Hi ${contactName},`,
              ``,
              `This is a reminder that your scheduled hood cleaning is today, ${jobDate} at ${jobTime}.`,
              ``,
              `Please ensure access is available at ${address}.`,
              ``,
              `Please ensure all equipment is off and cooled down by ${jobTime}.`,
              ``,
              `Questions? Call us at ${CONTACT_PHONE}.`,
              ``,
              `— ${SITE_NAME}`,
            ].join("\n");

            await enqueueEmail({
              to: recipientEmail,
              subject,
              html,
              text,
              idempotencyKey: `day-reminder-${job.id}-${todayStr}`,
            });

            sent.push(cleanName);
          } catch (err: any) {
            errors.push({ customer: cleanName, error: err.message ?? "Unknown error" });
          }
        }

        return Response.json({ ok: true, sent, skipped, errors });
      },
    },
  },
});
