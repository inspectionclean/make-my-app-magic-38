import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SENDER_DOMAIN = "notify.inspectionclean.com";
const FROM_DOMAIN = "inspectionclean.com";
const SITE_NAME = "Inspection Clean";
const SERVICE_EMAIL = "service@inspectionclean.com";

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
  return null;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export const Route = createFileRoute("/api/cancel-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub as string;

        const { jobId, reason } = (await request.json()) as { jobId: string; reason: string };
        if (!jobId || !reason?.trim()) {
          return new Response("jobId and reason are required", { status: 400 });
        }

        const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).maybeSingle();
        if (!job) return new Response("Job not found", { status: 404 });

        const { data: profile } = await supabaseAdmin
          .from("profiles").select("full_name").eq("id", userId).maybeSingle();

        const { error: updErr } = await supabaseAdmin
          .from("jobs")
          .update({
            status: "cancelled",
            cancellation_reason: reason.trim(),
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        if (updErr) return new Response(`Failed to cancel job: ${updErr.message}`, { status: 500 });

        const scheduled = new Date(job.scheduled_at).toLocaleString();
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;color:#222">
            <h1 style="font-size:20px;margin:0 0 8px">Job Cancelled — Needs Reschedule</h1>
            <p>The following job was marked unable-to-perform and needs to be rescheduled.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
              <tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600;width:35%">Customer</td><td style="padding:6px 10px">${esc(job.customer_name)}</td></tr>
              <tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Address</td><td style="padding:6px 10px">${esc(job.address)}</td></tr>
              <tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Originally scheduled</td><td style="padding:6px 10px">${esc(scheduled)}</td></tr>
              ${job.customer_phone ? `<tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Customer phone</td><td style="padding:6px 10px">${esc(job.customer_phone)}</td></tr>` : ""}
              ${job.customer_email ? `<tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Customer email</td><td style="padding:6px 10px">${esc(job.customer_email)}</td></tr>` : ""}
              ${job.service_type ? `<tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Service type</td><td style="padding:6px 10px">${esc(job.service_type)}</td></tr>` : ""}
              ${(job as any).po_number ? `<tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">PO Number</td><td style="padding:6px 10px">${esc(String((job as any).po_number))}</td></tr>` : ""}
              <tr><td style="padding:6px 10px;background:#f6f6f6;font-weight:600">Marked by</td><td style="padding:6px 10px">${esc(profile?.full_name || "Technician")}</td></tr>
            </table>
            <h3 style="margin:18px 0 6px">Reason for cancellation</h3>
            <p style="white-space:pre-wrap;background:#fff7e6;border:1px solid #ffe7a3;padding:12px;border-radius:6px">${esc(reason.trim())}</p>
          </div>`;

        const unsubscribeToken = await getOrCreateUnsubscribeToken(SERVICE_EMAIL);
        if (!unsubscribeToken) {
          return Response.json({ ok: true, emailed: false, reason: "service email suppressed" });
        }

        const messageId = crypto.randomUUID();
        await supabaseAdmin.from("email_send_log").insert({
          message_id: messageId,
          template_name: "job-cancelled",
          recipient_email: SERVICE_EMAIL,
          status: "pending",
        });
        const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: SERVICE_EMAIL,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: `Job cancelled — ${job.customer_name} (${scheduled})`,
            html,
            text: `Job cancelled for ${job.customer_name} (${scheduled}).\nReason: ${reason.trim()}`,
            purpose: "transactional",
            label: "job-cancelled",
            idempotency_key: `cancel-${jobId}`,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
          },
        });
        if (enqErr) return new Response(`Failed to enqueue email: ${enqErr.message}`, { status: 500 });

        return Response.json({ ok: true, emailed: true });
      },
    },
  },
});