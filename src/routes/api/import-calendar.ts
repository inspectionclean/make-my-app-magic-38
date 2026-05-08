import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";
const SERVICE_TYPES = ["Hood Clean", "Repair", "Call Back", "Estimate"];

function parseSummary(summary: string | undefined): { service_type: string | null; customer_name: string } {
  const s = (summary ?? "").trim();
  const m = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) {
    const tag = m[1].trim();
    const matched = SERVICE_TYPES.find((t) => t.toLowerCase() === tag.toLowerCase());
    return { service_type: matched ?? tag, customer_name: m[2].trim() || s };
  }
  return { service_type: null, customer_name: s || "Untitled event" };
}

export const Route = createFileRoute("/api/import-calendar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Admin gate
        const { data: roles } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        if (!roles?.some((r) => r.role === "admin")) {
          return new Response("Forbidden", { status: 403 });
        }

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        const GOOGLE_CALENDAR_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY;
        if (!LOVABLE_API_KEY || !GOOGLE_CALENDAR_API_KEY) {
          return new Response("Calendar not configured", { status: 500 });
        }

        // Pull events from 30 days ago through 180 days ahead, paginate
        const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
        const events: any[] = [];
        let pageToken: string | undefined;
        try {
          do {
            const params = new URLSearchParams({
              timeMin,
              timeMax,
              singleEvents: "true",
              orderBy: "startTime",
              maxResults: "250",
            });
            if (pageToken) params.set("pageToken", pageToken);
            const res = await fetch(`${GATEWAY_URL}/calendars/${CALENDAR_ID}/events?${params}`, {
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": GOOGLE_CALENDAR_API_KEY,
              },
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${text}`);
            const json = JSON.parse(text);
            events.push(...(json.items ?? []));
            pageToken = json.nextPageToken;
          } while (pageToken);
        } catch (e: any) {
          console.error("[import-calendar]", e);
          return new Response(e.message ?? "Failed to fetch calendar", { status: 500 });
        }

        // Skip events that already have a corresponding job
        const eventIds = events.map((e) => e.id).filter(Boolean);
        const { data: existing } = await supabaseAdmin
          .from("jobs")
          .select("google_event_id")
          .in("google_event_id", eventIds.length ? eventIds : ["__none__"]);
        const existingIds = new Set((existing ?? []).map((j) => j.google_event_id));

        const toInsert: any[] = [];
        let skipped = 0;
        for (const ev of events) {
          if (!ev.id || existingIds.has(ev.id)) {
            skipped++;
            continue;
          }
          const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T09:00:00` : null);
          if (!startIso) {
            skipped++;
            continue;
          }
          const { service_type, customer_name } = parseSummary(ev.summary);
          toInsert.push({
            customer_name,
            address: ev.location ?? "(no address)",
            scheduled_at: new Date(startIso).toISOString(),
            description: ev.description ?? null,
            service_type,
            google_event_id: ev.id,
            created_by: userId,
          });
        }

        let inserted = 0;
        if (toInsert.length) {
          const { error, count } = await supabaseAdmin
            .from("jobs")
            .insert(toInsert, { count: "exact" });
          if (error) {
            console.error("[import-calendar] insert", error);
            return new Response(error.message, { status: 500 });
          }
          inserted = count ?? toInsert.length;
        }

        return Response.json({ ok: true, inserted, skipped, total: events.length });
      },
    },
  },
});