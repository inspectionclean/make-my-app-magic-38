import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SENDER_DOMAIN = "notify.inspectionclean.com";
const FROM_DOMAIN = "inspectionclean.com";
const SITE_NAME = "Inspection Clean";

function generateToken(): string {
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
    const token = generateToken();
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
  return null; // already used → suppressed
}

export const Route = createFileRoute("/api/send-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });

        const { jobId } = (await request.json()) as { jobId: string };
        const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).maybeSingle();
        if (!job) return new Response("Job not found", { status: 404 });

        const { data: report } = await supabaseAdmin
          .from("performance_reports")
          .select("*")
          .eq("job_id", jobId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!report) {
          return new Response("No performance report submitted for this job", { status: 400 });
        }

        const { data: jobPhotos } = await supabaseAdmin
          .from("job_photos")
          .select("*")
          .eq("job_id", jobId)
          .order("taken_at", { ascending: true });
        const photoUrl = async (path: string) => {
          const { data } = await supabaseAdmin.storage
            .from("job-photos")
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          return data?.signedUrl ?? null;
        };
        const beforePhotos = (jobPhotos ?? []).filter((p) => p.type === "before");
        const afterPhotos = (jobPhotos ?? []).filter((p) => p.type === "after");
        const beforeUrls = (await Promise.all(beforePhotos.map((p) => photoUrl(p.storage_path)))).filter(Boolean) as string[];
        const afterUrls = (await Promise.all(afterPhotos.map((p) => photoUrl(p.storage_path)))).filter(Boolean) as string[];
        const photoSection = (title: string, urls: string[]) =>
          urls.length
            ? `<h3 style="margin:18px 0 6px">${escapeHtml(title)}</h3><div style="display:flex;flex-wrap:wrap;gap:8px">${urls
                .map(
                  (u) =>
                    `<a href="${u}"><img src="${u}" alt="${escapeHtml(title)}" style="width:180px;height:135px;object-fit:cover;border-radius:6px;border:1px solid #e5e5e5" /></a>`,
                )
                .join("")}</div>`
            : "";

        const row = (label: string, value: unknown) => {
          if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "";
          const v = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
          return `<tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600;width:45%">${escapeHtml(label)}</td><td style="padding:6px 10px">${escapeHtml(v)}</td></tr>`;
        };
        const section = (title: string, rows: string) =>
          rows ? `<h3 style="margin:18px 0 6px">${escapeHtml(title)}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : "";

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;color:#222">
            <h1 style="font-size:22px;margin:0 0 4px">Hood Cleaning Performance Report</h1>
            <p style="color:#666;margin:0 0 16px">${escapeHtml(report.business_name)} — ${escapeHtml(report.service_date)}</p>

            ${section("Customer", row("Business", report.business_name) + row("Address", `${report.address}, ${report.city}, ${report.state} ${report.zip}`) + row("Contact", report.contact_name) + row("Phone", report.phone) + row("Email", report.email))}

            ${section("Service", row("Service date", report.service_date) + row("Arrival", report.arrival_time) + row("Completion", report.completion_time) + row("Technicians", report.technicians) + row("Previous cleaning", report.previous_cleaning_date) + row("Service type", report.service_type))}

            ${section("System", row("Hoods", report.hoods) + row("Exhaust fans", report.fans) + row("Duct runs", report.duct_runs) + row("Fire suppression", report.fire_suppression) + row("Access panels", report.access_panels) + row("Roof access", report.roof_access))}

            ${section("Areas cleaned", row("Areas", report.areas_cleaned) + row("Other", report.other_cleaned))}

            ${section("Performance results", row("Condition before", report.condition_before) + row("Condition after", report.condition_after) + row("Grease level", report.grease_level) + row("Airflow check", report.airflow_check) + row("Fan check", report.fan_check) + row("Filter condition", report.filter_condition) + row("Access panel condition", report.access_panel_condition))}

            ${section("Findings & recommendations", row("Findings", report.findings) + row("Recommendations", report.recommendations) + row("Recommended items", report.recommendation_items) + row("Photos taken", report.photos))}

            ${section("Sign-off", row("Technician", report.technician_name) + row("Customer rep", report.customer_rep) + row("Signed", report.signature_date))}

            ${photoSection("Before photos", beforeUrls)}
            ${photoSection("After photos", afterUrls)}
          </div>`;

        const ALWAYS_CC = "service@inspectionclean.com";
        const recipients = Array.from(
          new Set(
            [job.customer_email, job.mgmt_email, ALWAYS_CC].filter(Boolean) as string[],
          ),
        );

        try {
          for (const to of recipients) {
            const normalized = to.toLowerCase();
            const { data: suppressed } = await supabaseAdmin
              .from("suppressed_emails").select("id").eq("email", normalized).maybeSingle();
            if (suppressed) {
              console.log("Skipping suppressed recipient", { recipient: normalized });
              continue;
            }
            const unsubscribeToken = await getOrCreateUnsubscribeToken(to);
            if (!unsubscribeToken) {
              console.log("Skipping recipient (unsubscribed)", { recipient: normalized });
              continue;
            }
            const messageId = crypto.randomUUID();
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: "service-report",
              recipient_email: to,
              status: "pending",
            });
            const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email", {
              queue_name: "transactional_emails",
              payload: {
                message_id: messageId,
                to,
                from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
                sender_domain: SENDER_DOMAIN,
                subject: `Performance report — ${job.customer_name}`,
                html,
                text: `Service report for ${job.customer_name} on ${new Date(job.scheduled_at).toLocaleString()}.`,
                purpose: "transactional",
                label: "service-report",
                idempotency_key: `service-report-${jobId}-${to}`,
                unsubscribe_token: unsubscribeToken,
                queued_at: new Date().toISOString(),
              },
            });
            if (enqErr) throw new Error(`Failed to enqueue email: ${enqErr.message}`);
          }
          await supabaseAdmin.from("jobs").update({ report_sent_at: new Date().toISOString() }).eq("id", jobId);
        } catch (e: any) {
          console.error("Failed to send job report", e);
          return new Response(`Failed to send report: ${e.message}`, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}