import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendLovableEmail } from "@lovable.dev/email-js";

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

            ${section("Sign-off", row("Technician", report.technician_name) + row("Technician signature", report.technician_signature) + row("Customer rep", report.customer_rep) + row("Customer signature", report.customer_signature) + row("Signed", report.signature_date))}
          </div>`;

        const ALWAYS_CC = "service@inspectionclean.com";
        const recipients = Array.from(
          new Set(
            [job.customer_email, job.mgmt_email, ALWAYS_CC].filter(Boolean) as string[],
          ),
        );

        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
          for (const to of recipients) {
            await sendLovableEmail(
              {
                from: "Inspection Clean <service@notify.inspectionclean.com>",
                sender_domain: "notify.inspectionclean.com",
                to,
              subject: `Performance report — ${job.customer_name}`,
                html,
                text: `Service report for ${job.customer_name} on ${new Date(job.scheduled_at).toLocaleString()}.`,
                label: "service-report",
                idempotency_key: `service-report-${jobId}-${to}`,
              },
              { apiKey },
            );
          }
          await supabaseAdmin.from("jobs").update({ report_sent_at: new Date().toISOString() }).eq("id", jobId);
        } catch (e: any) {
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