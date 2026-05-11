import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSimplePdf } from "@/lib/pdf.server";
import { getOrCreateCustomerFolder, uploadFile } from "@/lib/drive.server";
import { LOGO_PNG_BASE64 } from "@/lib/logo-data";

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

/** Strip SMS phone tags from customer name for Drive lookups and email subjects */
function stripPhone(name: string): string {
  return name
    .replace(/#\+?[\d\s\-().]{7,}#/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—,]+$/, "")
    .trim();
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

        // ---- Find the best performance report ----
        // First try: report directly linked to this job
        let { data: report } = await supabaseAdmin
          .from("performance_reports")
          .select("*")
          .eq("job_id", jobId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Second try: if no linked report (duplicate job bug), find the most recent
        // report for this customer by business name, submitted within 24 hours of
        // the job's scheduled time.
        if (!report && job.customer_name) {
          const cleanName = stripPhone(job.customer_name).toLowerCase();
          const scheduledAt = new Date(job.scheduled_at);
          const windowStart = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
          const windowEnd = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000).toISOString();

          const { data: candidates } = await supabaseAdmin
            .from("performance_reports")
            .select("*")
            .gte("created_at", windowStart)
            .lte("created_at", windowEnd)
            .order("created_at", { ascending: false })
            .limit(20);

          // Find the candidate whose business_name most closely matches the job customer
          report = (candidates ?? []).find((r) =>
            r.business_name?.toLowerCase().includes(cleanName) ||
            cleanName.includes(r.business_name?.toLowerCase() ?? "")
          ) ?? null;

          // If found via fallback, link it to this job so future sends work correctly
          if (report) {
            await supabaseAdmin
              .from("performance_reports")
              .update({ job_id: jobId })
              .eq("id", report.id);
          }
        }

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

        // ---- Build branded PDF ----
        const pdfBytes = await buildSimplePdf({
          title: "Hood Cleaning Performance Report",
          subtitle: `${report.business_name} — ${report.service_date}`,
          footer: "Inspection Clean  •  service@inspectionclean.com",
          sections: [
            { heading: "Customer", rows: [
              ["Business", report.business_name],
              ["Address", `${report.address}, ${report.city}, ${report.state} ${report.zip}`],
              ["Contact", report.contact_name ?? ""],
              ["Phone", report.phone ?? ""],
              ["Email", report.email ?? ""],
              ["PO Number", (job as any).po_number ?? ""],
            ].filter(([, v]) => v) as [string, string][] },
            { heading: "Service", rows: [
              ["Service Date", report.service_date ?? ""],
              ["Arrival", report.arrival_time ?? ""],
              ["Completion", report.completion_time ?? ""],
              ["Technicians", report.technicians ?? ""],
              ["Service Type", report.service_type ?? ""],
              ["Previous Cleaning", report.previous_cleaning_date ?? ""],
            ].filter(([, v]) => v) as [string, string][] },
            { heading: "System", rows: [
              ["Hoods", String(report.hoods ?? "")],
              ["Exhaust Fans", String(report.fans ?? "")],
              ["Duct Runs", String(report.duct_runs ?? "")],
              ["Fire Suppression", report.fire_suppression == null ? "" : report.fire_suppression ? "Yes" : "No"],
              ["Access Panels", report.access_panels == null ? "" : report.access_panels ? "Yes" : "No"],
              ["Roof Access", report.roof_access == null ? "" : report.roof_access ? "Yes" : "No"],
            ].filter(([, v]) => v) as [string, string][] },
            { heading: "Areas Cleaned", rows: [
              ["Areas", (report.areas_cleaned ?? []).join(", ")],
              ["Other", report.other_cleaned ?? ""],
            ].filter(([, v]) => v) as [string, string][] },
            { heading: "Performance Results", rows: [
              ["Condition Before", report.condition_before ?? ""],
              ["Condition After", report.condition_after ?? ""],
              ["Grease Level", report.grease_level ?? ""],
              ["Airflow Check", report.airflow_check ?? ""],
              ["Fan Check", report.fan_check ?? ""],
              ["Filter Condition", report.filter_condition ?? ""],
              ["Access Panel Condition", report.access_panel_condition ?? ""],
            ].filter(([, v]) => v) as [string, string][] },
            {
              heading: "Findings & Recommendations",
              paragraphs: [report.findings, report.recommendations].filter(Boolean) as string[],
              rows: [
                ["Recommended Items", (report.recommendation_items ?? []).join(", ")],
              ].filter(([, v]) => v) as [string, string][],
            },
            { heading: "Sign-Off", rows: [
              ["Technician", report.technician_name ?? ""],
              ["Customer Representative", report.customer_rep ?? ""],
              ["Signed", report.signature_date ?? ""],
            ].filter(([, v]) => v) as [string, string][] },
          ],
        });

        // ---- Save PDF to Supabase storage and create signed download URL ----
        const pdfFileName = `report-${jobId}-${Date.now()}.pdf`;
        const pdfStoragePath = `reports/${jobId}/${pdfFileName}`;
        await supabaseAdmin.storage
          .from("job-photos")
          .upload(pdfStoragePath, pdfBytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        const { data: signed } = await supabaseAdmin.storage
          .from("job-photos")
          .createSignedUrl(pdfStoragePath, 60 * 60 * 24 * 30);
        const pdfUrl = signed?.signedUrl ?? null;

        // ---- Upload PDF to the customer's Drive folder (best-effort) ----
        try {
          // Strip phone tags so job names like "Roma's #+18645551234#"
          // find the correct Drive folder instead of creating a duplicate
          const driveCustomerName = stripPhone(job.customer_name);
          const folderId = await getOrCreateCustomerFolder(driveCustomerName);
          await uploadFile({
            folderId,
            name: `Performance Report - ${report.service_date}.pdf`,
            mimeType: "application/pdf",
            content: pdfBytes,
          });
        } catch (e) {
          console.error("Drive upload of report PDF failed", e);
        }

        const cleanSubjectName = stripPhone(job.customer_name);
        const logoImg = `<img src="data:image/png;base64,${LOGO_PNG_BASE64}" alt="Inspection Clean" style="height:64px;display:block;margin:0 auto 12px" />`;
        const pdfButton = pdfUrl
          ? `<p style="text-align:center;margin:18px 0"><a href="${pdfUrl}" style="display:inline-block;background:#0f5ba1;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Download PDF Report</a></p>`
          : "";

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;color:#222">
            ${logoImg}
            <h1 style="font-size:22px;margin:0 0 4px">Hood Cleaning Performance Report</h1>
            <p style="color:#666;margin:0 0 16px">${escapeHtml(report.business_name)} — ${escapeHtml(report.service_date ?? "")}</p>
            ${pdfButton}

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
                // Clean subject — no phone number tags visible to customer
                subject: `Performance report — ${cleanSubjectName}`,
                html,
                text: `Service report for ${cleanSubjectName} on ${new Date(job.scheduled_at).toLocaleString()}.`,
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
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
