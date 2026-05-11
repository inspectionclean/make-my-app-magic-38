import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CAL_GATEWAY = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

async function lastCalendarEventDate(customerName: string): Promise<string | null> {
  const lk = process.env.LOVABLE_API_KEY;
  const ck = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!lk || !ck) return null;
  try {
    const now = new Date().toISOString();
    // Search past events whose summary contains the customer name
    const params = new URLSearchParams({
      q: customerName,
      timeMax: now,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    });
    const res = await fetch(`${CAL_GATEWAY}/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": ck },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: Array<{ start?: { date?: string; dateTime?: string }; summary?: string }> };
    const items = json.items ?? [];
    if (!items.length) return null;
    // Items returned in start-time ascending order; take the latest
    const last = items[items.length - 1];
    const raw = last.start?.dateTime ?? last.start?.date;
    if (!raw) return null;
    return raw.slice(0, 10);
  } catch (e) {
    console.error("Calendar lookup failed", e);
    return null;
  }
}

export const Route = createFileRoute("/api/customer-prefill")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const customerName = url.searchParams.get("customer")?.trim();
        if (!customerName) return new Response("Missing customer", { status: 400 });

        // Most recent intake submission for this customer
        const { data: intake } = await supabaseAdmin
          .from("intake_submissions")
          .select("*")
          .ilike("business_name", customerName)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Most recent past performance report (by service_date) for this customer
        const { data: lastReport } = await supabaseAdmin
          .from("performance_reports")
          .select("service_date, business_name")
          .ilike("business_name", customerName)
          .order("service_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Most recent past completed job for this customer
        const { data: lastJob } = await supabaseAdmin
          .from("jobs")
          .select("scheduled_at, customer_name")
          .ilike("customer_name", customerName)
          .lt("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const calendarDate = await lastCalendarEventDate(customerName);

        const candidates: string[] = [];
        if (lastReport?.service_date) candidates.push(String(lastReport.service_date));
        if (lastJob?.scheduled_at) candidates.push(String(lastJob.scheduled_at).slice(0, 10));
        if (calendarDate) candidates.push(calendarDate);
        candidates.sort((a, b) => (a < b ? 1 : -1));
        const lastCleanDate = candidates[0] ?? null;

        return Response.json({
          intake,
          lastCleanDate,
          sources: { lastReport, lastJob, calendarDate },
        });
      },
    },
  },
});