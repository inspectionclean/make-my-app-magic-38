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

        const [{ data: photos }, { data: notes }, { data: times }] = await Promise.all([
          supabaseAdmin.from("job_photos").select("*").eq("job_id", jobId),
          supabaseAdmin.from("job_notes").select("*").eq("job_id", jobId).order("created_at"),
          supabaseAdmin.from("time_entries").select("*").eq("job_id", jobId),
        ]);

        const totalMin = (times ?? []).reduce((acc, e) => {
          const s = new Date(e.arrived_at).getTime();
          const en = e.left_at ? new Date(e.left_at).getTime() : s;
          return acc + Math.max(0, Math.floor((en - s) / 60000));
        }, 0);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;

        // Generate signed URLs for photos
        const photoLinks: { type: string; url: string }[] = [];
        for (const p of photos ?? []) {
          const { data } = await supabaseAdmin.storage.from("job-photos").createSignedUrl(p.storage_path, 60 * 60 * 24 * 7);
          if (data?.signedUrl) photoLinks.push({ type: p.type, url: data.signedUrl });
        }
        const before = photoLinks.filter((p) => p.type === "before");
        const after = photoLinks.filter((p) => p.type === "after");

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#222">
            <h1 style="font-size:22px;margin:0 0 8px">Service report — ${escapeHtml(job.customer_name)}</h1>
            <p style="color:#666;margin:0 0 20px">${new Date(job.scheduled_at).toLocaleString()}</p>
            <h3 style="margin:16px 0 4px">Location</h3>
            <p style="margin:0">${escapeHtml(job.address)}</p>
            <h3 style="margin:16px 0 4px">Time on site</h3>
            <p style="margin:0">${h > 0 ? `${h}h ` : ""}${m}m</p>
            ${job.description ? `<h3 style="margin:16px 0 4px">Scope</h3><p style="margin:0">${escapeHtml(job.description)}</p>` : ""}
            ${notes && notes.length ? `<h3 style="margin:16px 0 4px">Notes</h3>${notes.map((n) => `<p style="margin:0 0 8px;white-space:pre-wrap">${escapeHtml(n.body)}</p>`).join("")}` : ""}
            ${before.length ? `<h3 style="margin:16px 0 4px">Before</h3>${before.map((p) => `<a href="${p.url}"><img src="${p.url}" style="max-width:280px;margin:4px;border-radius:6px"/></a>`).join("")}` : ""}
            ${after.length ? `<h3 style="margin:16px 0 4px">After</h3>${after.map((p) => `<a href="${p.url}"><img src="${p.url}" style="max-width:280px;margin:4px;border-radius:6px"/></a>`).join("")}` : ""}
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
            await sendLovableEmail({
              apiKey,
              senderDomain: "notify.inspectionclean.com",
              from: "Inspection Clean <service@notify.inspectionclean.com>",
              to,
              subject: `Service report — ${job.customer_name}`,
              html,
            });
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