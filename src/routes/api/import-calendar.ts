import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "service@inspectionclean.com";
const SERVICE_TYPES = ["Hood Clean", "Repair", "Call Back", "Estimate"];

/**
 * Clean a single customer name:
 * - Strip SMS phone tags:  #+18645551234#
 * - Strip status prefixes: Confirmed:, Pending:, MAYBE
 * - Strip trailing punctuation
 */
function cleanCustomerName(raw: string): string {
  return raw
    .replace(/#\+?[\d\s\-().]{7,}#/g, "")
    .replace(/^(confirmed|pending|maybe)\s*:?\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—,:.]+$/, "")
    .trim();
}

/**
 * Parse a calendar event summary into one or more customer jobs.
 */
function parseSummary(summary: string | undefined): { service_type: string | null; customer_name: string }[] {
  const s = (summary ?? "").trim();

  let service_type: string | null = null;
  let remainder = s;
  const tagMatch = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (tagMatch) {
    const tag = tagMatch[1].trim();
    const matched = SERVICE_TYPES.find((t) => t.toLowerCase() === tag.toLowerCase());
    service_type = matched ?? tag;
    remainder = tagMatch[2].trim();
  }

  const cleaned = cleanCustomerName(remainder) || "Untitled event";

  const segments = cleaned.split(/\s*\/\s*/).map((seg) => seg.trim()).filter(Boolean);

  if (segments.length <= 1) {
    return [{ service_type, customer_name: cleaned }];
  }

  const firstSeg = segments[0];
  const brandMatch = firstSeg.match(/^(.*?)\s*#\d/);
  const brand = brandMatch ? brandMatch[1].trim() : null;

  return segments.map((seg) => {
    const isJustNumber = /^#\d+$/.test(seg);
    const customer_name = isJustNumber && brand ? `${brand} ${seg}` : seg;
    return { service_type, customer_name };
  });
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

        const timeMin = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
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

        const eventIds = events.map((e) => e.id).filter(Boolean);
        const { data: existing } = await supabaseAdmin
          .from("jobs")
          .select("google_event_id")
          .in("google_event_id", eventIds.length ? eventIds : ["__none__"]);
        const existingIds = new Set((existing ?? []).map((j) => j.google_event_id));

        const toInsert: any[] = [];
        let skipped = 0;

        for (const ev of events) {
          if (!ev.id) { skipped++; continue; }

          const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T09:00:00` : null);
          if (!startIso) { skipped++; continue; }

          const parsed = parseSummary(ev.summary);

          for (let i = 0; i < parsed.length; i++) {
            const stableId = i === 0 ? ev.id : `${ev.id}__${i}`;

            if (existingIds.has(stableId)) {
              skipped++;
              continue;
            }

            const { service_type, customer_name } = parsed[i];

            toInsert.push({
              customer_name,
              address: ev.location ?? "(no address)",
              scheduled_at: new Date(startIso).toISOString(),
              description: ev.description ?? null,
              service_type,
              google_event_id: stableId,
              created_by: userId,
            });
          }
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
