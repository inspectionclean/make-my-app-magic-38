import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/prefill-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claims.claims.sub as string;

        const url = new URL(request.url);
        const jobId = url.searchParams.get("jobId");
        if (!jobId) return new Response("Missing jobId", { status: 400 });

        const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).maybeSingle();
        if (!job) return new Response("Not found", { status: 404 });

        const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
        const isAdmin = roles?.some((r) => r.role === "admin");
        if (!isAdmin && job.assigned_to !== userId) return new Response("Forbidden", { status: 403 });

        let intake: any = null;
        if (job.customer_email) {
          const { data } = await supabaseAdmin
            .from("intake_submissions").select("*")
            .ilike("email", job.customer_email)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          intake = data;
        }
        if (!intake && job.customer_name) {
          const { data } = await supabaseAdmin
            .from("intake_submissions").select("*")
            .ilike("business_name", job.customer_name)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          intake = data;
        }

        let lastReport: any = null;
        {
          const { data } = await supabaseAdmin
            .from("performance_reports").select("*").eq("job_id", jobId)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          lastReport = data;
        }
        if (!lastReport && job.customer_name) {
          const { data } = await supabaseAdmin
            .from("performance_reports").select("*")
            .ilike("business_name", job.customer_name)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          lastReport = data;
        }

        const { data: times } = await supabaseAdmin
          .from("time_entries").select("*").eq("job_id", jobId)
          .order("arrived_at", { ascending: true });
        const firstTime = times?.[0] ?? null;
        const lastTime = times && times.length ? times[times.length - 1] : null;

        const { data: profile } = await supabaseAdmin
          .from("profiles").select("full_name").eq("id", userId).maybeSingle();

        return Response.json({
          job, intake, lastReport, firstTime, lastTime,
          technicianName: profile?.full_name ?? null,
        });
      },
    },
  },
});