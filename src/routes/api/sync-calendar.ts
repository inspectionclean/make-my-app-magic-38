import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const CALENDAR_ID = "primary";

async function gcalFetch(path: string, init: RequestInit = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_CALENDAR_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!GOOGLE_CALENDAR_API_KEY) throw new Error("GOOGLE_CALENDAR_API_KEY is not configured");
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_CALENDAR_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google Calendar API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function formatSmsPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`;
  return `#${e164}#`;
}

function buildEvent(job: any) {
  const start = new Date(job.scheduled_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour
  const smsTag = formatSmsPhone(job.customer_phone);
  const descLines = [
    smsTag,
    job.service_type ? `Type: ${job.service_type}` : null,
    job.customer_phone ? `Phone: ${job.customer_phone}` : null,
    job.customer_email ? `Email: ${job.customer_email}` : null,
    job.description ? `\n${job.description}` : null,
  ].filter(Boolean);
  return {
    summary: `${job.service_type ? `[${job.service_type}] ` : ""}${job.customer_name}`,
    location: job.address,
    description: descLines.join("\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

export const Route = createFileRoute("/api/sync-calendar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });

        const { jobId, action } = (await request.json()) as {
          jobId: string;
          action: "upsert" | "delete";
        };

        const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).maybeSingle();

        try {
          if (action === "delete") {
            if (job?.google_event_id) {
              await gcalFetch(`/calendars/${CALENDAR_ID}/events/${job.google_event_id}`, { method: "DELETE" });
            }
            return Response.json({ ok: true });
          }

          if (!job) return new Response("Job not found", { status: 404 });
          const body = JSON.stringify(buildEvent(job));

          if (job.google_event_id) {
            await gcalFetch(`/calendars/${CALENDAR_ID}/events/${job.google_event_id}`, {
              method: "PUT",
              body,
            });
          } else {
            const created = await gcalFetch(`/calendars/${CALENDAR_ID}/events`, {
              method: "POST",
              body,
            });
            if (created?.id) {
              await supabaseAdmin.from("jobs").update({ google_event_id: created.id }).eq("id", jobId);
            }
          }
          return Response.json({ ok: true });
        } catch (e: any) {
          console.error("[sync-calendar]", e);
          return new Response(e.message ?? "Calendar sync failed", { status: 500 });
        }
      },
    },
  },
});