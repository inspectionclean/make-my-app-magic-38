import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const ACTIVE_CUSTOMERS_FOLDER = "Active Customers";
const THEY_WILL_CALL_FOLDER = "They will call";
const OLD_CUSTOMERS_FOLDER = "Old Customers";

// Customers who go in "They will call" folder
const THEY_WILL_CALL = [
  "86pho",
  "matt davis",
  "oconee lanes",
  "brick street bakery",
  "cannons",
  "little river roasting",
];

// Customers who go in "Old Customers" folder
const OLD_CUSTOMERS = [
  "ike's korner",
  "ikes korner",
  "lakeview assisted",
  "blue ridge brewing",
  "smoking butt",
  "study hall",
  "village inn",
  "cross creek",
  "delaney",
  "farmhouse tacos",
  "gerhard",
  "bellwether",
  "southend",
  "coral",
  "flying biscuit",
  "urban wren",
  "links o tryon",
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function authHeaders() {
  const lk = process.env.LOVABLE_API_KEY;
  const dk = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lk) throw new Error("LOVABLE_API_KEY is not configured");
  if (!dk) throw new Error("GOOGLE_DRIVE_API_KEY is not configured");
  return {
    Authorization: `Bearer ${lk}`,
    "X-Connection-Api-Key": dk,
  } as Record<string, string>;
}

async function gfetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const clauses = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const url = `/drive/v3/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=${encodeURIComponent("files(id,name)")}&pageSize=1`;
  const json = await gfetch(url);
  return json.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const res = await gfetch(`/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return res.id;
}

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

/** Format month folder name: "5- May 26" */
function monthFolderName(date: Date): string {
  const m = date.getUTCMonth();
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${m + 1}- ${MONTH_NAMES[m]} ${yy}`;
}

/** Calculate next due date from last_cleaning + frequency */
function calcNextDue(lastCleaning: string, frequency: string): Date | null {
  const last = new Date(lastCleaning + "T00:00:00Z");
  if (isNaN(last.getTime())) return null;

  const freq = frequency.toLowerCase().trim();

  // Skip inactive customers
  if (freq === "inactive") return null;

  let months = 0;
  if (freq.includes("bi-month") || freq.includes("bimonth") || freq === "bi monthly") months = 2;
  else if (freq.includes("month")) months = 1;
  else if (freq.includes("quarter")) months = 3;
  else if (freq.includes("semi") || freq.includes("bi-annual") || freq.includes("biannual")) months = 6;
  else if (freq.includes("annual") || freq.includes("year")) months = 12;
  else return null;

  return new Date(Date.UTC(
    last.getUTCFullYear(),
    last.getUTCMonth() + months,
    1
  ));
}

/** Check if business name matches any entry in a list */
function matchesList(name: string, list: string[]): boolean {
  const lower = name.toLowerCase();
  return list.some((entry) => lower.includes(entry));
}

export const Route = createFileRoute("/api/rebuild-drive-folders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Admin only
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return new Response("Unauthorized", { status: 401 });
        const { data: roles } = await supabaseAdmin
          .from("user_roles").select("role").eq("user_id", userId);
        if (!roles?.some((r) => r.role === "admin"))
          return new Response("Forbidden", { status: 403 });

        // ── Find root folders ──────────────────────────────────────────────
        const activeId = await findFolder(ACTIVE_CUSTOMERS_FOLDER);
        if (!activeId) return new Response(`"${ACTIVE_CUSTOMERS_FOLDER}" folder not found`, { status: 404 });

        const theyWillCallId = await findFolder(THEY_WILL_CALL_FOLDER);
        if (!theyWillCallId) return new Response(`"${THEY_WILL_CALL_FOLDER}" folder not found`, { status: 404 });

        const oldCustomersId = await findFolder(OLD_CUSTOMERS_FOLDER);
        if (!oldCustomersId) return new Response(`"${OLD_CUSTOMERS_FOLDER}" folder not found`, { status: 404 });

        // ── Load all intake submissions ────────────────────────────────────
        const { data: intakes, error } = await supabaseAdmin
          .from("intake_submissions")
          .select("*")
          .order("business_name");

        if (error) return new Response(error.message, { status: 500 });

        // Deduplicate by business_name — keep most recent
        const seen = new Map<string, any>();
        for (const intake of (intakes ?? [])) {
          const key = (intake.business_name ?? "").toLowerCase().trim();
          if (!key) continue;
          if (!seen.has(key) || new Date(intake.created_at) > new Date(seen.get(key).created_at)) {
            seen.set(key, intake);
          }
        }
        const unique = Array.from(seen.values());

        const results: {
          customer: string;
          status: "active" | "they_will_call" | "old_customers" | "skipped";
          folder?: string;
          reason?: string;
        }[] = [];

        // Cache month folder IDs to avoid duplicate API calls
        const monthFolderCache = new Map<string, string>();

        for (const intake of unique) {
          const name = (intake.business_name ?? "").trim();
          if (!name) continue;

          try {
            // ── Route to "They will call" ──────────────────────────────────
            if (matchesList(name, THEY_WILL_CALL)) {
              await getOrCreateFolder(name, theyWillCallId);
              results.push({ customer: name, status: "they_will_call", folder: THEY_WILL_CALL_FOLDER });
              continue;
            }

            // ── Route to "Old Customers" ───────────────────────────────────
            if (matchesList(name, OLD_CUSTOMERS)) {
              await getOrCreateFolder(name, oldCustomersId);
              results.push({ customer: name, status: "old_customers", folder: OLD_CUSTOMERS_FOLDER });
              continue;
            }

            // ── Route inactive frequency to Old Customers ──────────────────
            if ((intake.frequency ?? "").toLowerCase().trim() === "inactive") {
              await getOrCreateFolder(name, oldCustomersId);
              results.push({ customer: name, status: "old_customers", folder: OLD_CUSTOMERS_FOLDER });
              continue;
            }

            // ── Route to Active Customers month folder ─────────────────────
            if (!intake.frequency) {
              results.push({
                customer: name,
                status: "skipped",
                reason: "Missing frequency",
              });
              continue;
            }

            if (!intake.last_cleaning) {
              results.push({
                customer: name,
                status: "skipped",
                reason: "Missing last cleaning date",
              });
              continue;
            }

            const nextDue = calcNextDue(intake.last_cleaning, intake.frequency);
            if (!nextDue) {
              results.push({
                customer: name,
                status: "skipped",
                reason: `Could not calculate next due from frequency "${intake.frequency}"`,
              });
              continue;
            }

            // Get or create the month folder
            const monthName = monthFolderName(nextDue);
            let monthFolderId = monthFolderCache.get(monthName);
            if (!monthFolderId) {
              monthFolderId = await getOrCreateFolder(monthName, activeId);
              monthFolderCache.set(monthName, monthFolderId);
            }

            // Create customer folder inside month folder
            await getOrCreateFolder(name, monthFolderId);

            results.push({
              customer: name,
              status: "active",
              folder: `${ACTIVE_CUSTOMERS_FOLDER}/${monthName}`,
            });

          } catch (err: any) {
            results.push({
              customer: name,
              status: "skipped",
              reason: err.message ?? "Unknown error",
            });
          }
        }

        const summary = {
          active: results.filter((r) => r.status === "active").length,
          they_will_call: results.filter((r) => r.status === "they_will_call").length,
          old_customers: results.filter((r) => r.status === "old_customers").length,
          skipped: results.filter((r) => r.status === "skipped").length,
          total: results.length,
        };

        return Response.json({ ok: true, summary, results });
      },
    },
  },
});
