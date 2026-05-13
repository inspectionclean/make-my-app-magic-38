import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const ACTIVE_CUSTOMERS_FOLDER = "Active Customers";

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

async function gfetch(path: string) {
  const res = await fetch(`${GATEWAY}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function gfetchText(path: string) {
  const res = await fetch(`${GATEWAY}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.text();
}

async function listChildren(
  parentId: string,
  mimeType?: string
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const q = mimeType
    ? `'${parentId}' in parents and mimeType='${mimeType}' and trashed=false`
    : `'${parentId}' in parents and trashed=false`;
  const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(
    "files(id,name,mimeType)"
  )}&pageSize=500`;
  const json = await gfetch(url);
  return json.files ?? [];
}

async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const clauses = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const url = `/drive/v3/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=${encodeURIComponent(
    "files(id,name)"
  )}&pageSize=1`;
  const json = await gfetch(url);
  return json.files?.[0]?.id ?? null;
}

/** Export a Google Sheet as CSV (exports the first/default sheet) */
async function exportSheetAsCsv(fileId: string, sheetName: string): Promise<string | null> {
  try {
    // gid=0 exports the first sheet; we need to find the right gid for "Profile"
    // Drive export doesn't support sheet name — it exports first sheet
    // Use gid param: 0 = first sheet
    const url = `/drive/v3/files/${fileId}/export?mimeType=text%2Fcsv`;
    const res = await fetch(`${GATEWAY}${url}`, { headers: authHeaders() });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/** Simple CSV parser that handles quoted fields */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let inQuote = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  return rows;
}

/**
 * Parse the Profile sheet CSV into a structured customer record.
 *
 * The sheet layout (from the template):
 * Columns: A B C(label) D E(value) F G(label2) H I(value2)
 *
 * Row content:
 *   Customer Name  | <name>         | Business Hours  | <hours>
 *   Phone Number   | <phone>        | Preferred Clean | <access_time>
 *   1st Contact    | <contact>      | 2nd Contact     | <contact2>
 *   Phone          | <phone>        | Phone           | <phone2>
 *   Email          | <email>        | Email           | <email2>
 *   Last Clean     | <date>         | Street Address  | <address>
 *   Cleaner(s)     | <cleaners>     | City            | <city>
 *   Hours          | <hours_worked> | State           | <state>
 *   Payment        | <payment>      | Zip             | <zip>
 *   Price -        | <price>        | Master Notes    | <notes>
 *   Every -        | <months>
 *   Filters -      | <filters>
 *   Fans -         | <fans>
 */
function parseProfileCsv(csv: string, folderName: string): CustomerData | null {
  const rows = parseCsv(csv);
  if (!rows.length) return null;

  // Helper: find a row by label (checks col 2 and col 6 for both left and right columns)
  const findRow = (label: string): { left: string; right: string } => {
    const lowerLabel = label.toLowerCase().replace(/[-\s]/g, "");
    for (const row of rows) {
      for (let c = 0; c < row.length; c++) {
        const cell = (row[c] ?? "").toLowerCase().replace(/[-\s]/g, "");
        if (cell === lowerLabel || cell.startsWith(lowerLabel)) {
          // Value is 2 cols to the right
          const leftVal = (row[c + 2] ?? row[c + 1] ?? "").trim();
          // Right side label/value (typically 4 cols to the right of left label)
          const rightVal = (row[c + 6] ?? row[c + 5] ?? row[c + 4] ?? "").trim();
          return { left: leftVal, right: rightVal };
        }
      }
    }
    return { left: "", right: "" };
  };

  const customerName = findRow("Customer Name").left || folderName;
  const phoneRaw = findRow("Phone Number").left;
  const businessHours = findRow("Business Hours").left || findRow("Business Hours").right;
  const accessTime = findRow("Preferred Clean").left || findRow("Preferred Clean").right;

  const contact1Row = findRow("1st Contact");
  const contactName = contact1Row.left;
  // contact2 is in the right column of the same row
  // const contact2Name = contact1Row.right;

  // Phone and Email appear after 1st Contact row — find them contextually
  // They appear as plain "Phone" and "Email" labels
  let contactPhone = "";
  let contactEmail = "";
  let contact2Phone = "";
  let foundContact = false;
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] ?? "").toLowerCase().trim();
      if (cell === "1st contact") { foundContact = true; continue; }
      if (foundContact && cell === "phone") {
        contactPhone = (row[c + 2] ?? row[c + 1] ?? "").trim();
        contact2Phone = (row[c + 6] ?? row[c + 4] ?? "").trim();
        foundContact = false;
      }
      if (cell === "email") {
        contactEmail = (row[c + 2] ?? row[c + 1] ?? "").trim();
        break;
      }
    }
    if (contactEmail) break;
  }

  const lastCleanRaw = findRow("Last Clean").left;
  const streetAddress = findRow("Street Address").left || findRow("Street Address").right;
  const city = findRow("City").left || findRow("City").right;
  const state = findRow("State").left || findRow("State").right;
  const zipRaw = findRow("Zip").left || findRow("Zip").right;
  const masterNotes = findRow("Master Notes").left || findRow("Master Notes").right;
  const everyMonths = findRow("Every").left;
  const filtersRaw = findRow("Filters").left;
  const fansRaw = findRow("Fans").left;
  const hoodsRaw = findRow("Hoods").left;
  const priceRaw = findRow("Price").left;

  // Format phone: strip non-digits, format as (XXX)XXX-XXXX
  const formatPhone = (raw: string): string => {
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10) return raw; // return as-is if can't parse
    return `(${ten.slice(0, 3)})${ten.slice(3, 6)}-${ten.slice(6)}`;
  };

  // Format zip: remove .0 from numeric
  const formatZip = (raw: string): string => {
    if (!raw) return "";
    return raw.replace(/\.0+$/, "").trim();
  };

  // Convert Excel date serial to ISO date string
  const formatDate = (raw: string): string => {
    if (!raw) return "";
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 40000) {
      // Excel date serial (days since Jan 1, 1900)
      const date = new Date((num - 25569) * 86400 * 1000);
      return date.toISOString().slice(0, 10);
    }
    return raw;
  };

  // Convert "Every X months" to frequency label
  const formatFrequency = (months: string): string => {
    const n = parseInt(months);
    if (n === 1) return "Monthly";
    if (n === 2) return "Bi-Monthly";
    if (n === 3) return "Quarterly";
    if (n === 6) return "Semi-Annually";
    if (n === 12) return "Annually";
    return "";
  };

  // Parse hoods/fans — may be "alot", a number, or empty
  const parseNum = (raw: string): number | null => {
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
  };

  return {
    business_name: customerName,
    contact_name: contactName || customerName,
    phone: formatPhone(phoneRaw),
    text_phone: formatPhone(contactPhone) || formatPhone(phoneRaw),
    email: contactEmail,
    service_address: streetAddress,
    city,
    state,
    zip: formatZip(zipRaw),
    hours: businessHours,
    access_time: accessTime,
    last_cleaning: formatDate(lastCleanRaw),
    frequency: formatFrequency(everyMonths),
    hoods: parseNum(hoodsRaw),
    fans: parseNum(fansRaw),
    filters_raw: filtersRaw,
    master_notes: masterNotes,
    price: priceRaw,
  };
}

interface CustomerData {
  business_name: string;
  contact_name: string;
  phone: string;
  text_phone: string;
  email: string;
  service_address: string;
  city: string;
  state: string;
  zip: string;
  hours: string;
  access_time: string;
  last_cleaning: string;
  frequency: string;
  hoods: number | null;
  fans: number | null;
  filters_raw: string;
  master_notes: string;
  price: string;
}

export const Route = createFileRoute("/api/import-drive-customers")({
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

        const results: {
          folder: string;
          status: "imported" | "skipped" | "error";
          reason?: string;
          data?: Partial<CustomerData>;
        }[] = [];

        try {
          // 1. Find Active Customers folder
          const activeId = await findFolder(ACTIVE_CUSTOMERS_FOLDER);
          if (!activeId) {
            return new Response(
              `"${ACTIVE_CUSTOMERS_FOLDER}" folder not found in Drive`,
              { status: 404 }
            );
          }

          // 2. List all month folders under Active Customers
          const monthFolders = await listChildren(
            activeId,
            "application/vnd.google-apps.folder"
          );

          // 3. For each month folder, list customer folders
          for (const monthFolder of monthFolders) {
            const customerFolders = await listChildren(
              monthFolder.id,
              "application/vnd.google-apps.folder"
            );

            for (const customerFolder of customerFolders) {
              const folderName = customerFolder.name;

              try {
                // 4. Find the Google Sheet in this customer folder
                const files = await listChildren(customerFolder.id);
                const sheet = files.find(
                  (f) => f.mimeType === "application/vnd.google-apps.spreadsheet"
                );

                if (!sheet) {
                  results.push({
                    folder: folderName,
                    status: "skipped",
                    reason: "No Google Sheet found in folder",
                  });
                  continue;
                }

                // 5. Export sheet as CSV (exports Profile/first tab)
                const csv = await exportSheetAsCsv(sheet.id, "Profile");
                if (!csv) {
                  results.push({
                    folder: folderName,
                    status: "skipped",
                    reason: "Could not export sheet as CSV",
                  });
                  continue;
                }

                // 6. Parse the CSV
                const data = parseProfileCsv(csv, folderName);
                if (!data) {
                  results.push({
                    folder: folderName,
                    status: "skipped",
                    reason: "Could not parse Profile sheet",
                  });
                  continue;
                }

                // 7. Check if intake already exists for this customer
                const { data: existing } = await supabaseAdmin
                  .from("intake_submissions")
                  .select("id")
                  .ilike("business_name", data.business_name)
                  .limit(1)
                  .maybeSingle();

                if (existing) {
                  results.push({
                    folder: folderName,
                    status: "skipped",
                    reason: "Intake already exists",
                    data,
                  });
                  continue;
                }

                // 8. Look up last clean date from job history
                // (sheet data is stale — calendar import has accurate history)
                let lastCleanDate: string | null = data.last_cleaning || null;
                try {
                  const firstWord = data.business_name.split(" ")[0].replace(/'/g, "''");
                  const { data: lastJob } = await supabaseAdmin
                    .from("jobs")
                    .select("scheduled_at")
                    .ilike("customer_name", `%${firstWord}%`)
                    .eq("status", "completed")
                    .order("scheduled_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (lastJob?.scheduled_at) {
                    lastCleanDate = new Date(lastJob.scheduled_at).toISOString().slice(0, 10);
                  }
                } catch {
                  // keep sheet date as fallback
                }

                // 9. Insert intake submission
                const { error } = await supabaseAdmin
                  .from("intake_submissions")
                  .insert({
                    business_name: data.business_name,
                    contact_name: data.contact_name || data.business_name,
                    phone: data.phone || "",
                    text_phone: data.text_phone || null,
                    email: data.email || "",
                    service_address: data.service_address || "",
                    city: data.city || "",
                    state: data.state || "",
                    zip: data.zip || "",
                    hours: data.hours || null,
                    access_time: data.access_time || null,
                    last_cleaning: lastCleanDate,
                    frequency: data.frequency || null,
                    hoods: data.hoods,
                    fans: data.fans,
                    problem_areas: data.master_notes || null,
                    // Map filters_raw as a note since format varies
                    service_issues: data.filters_raw
                      ? `Filters: ${data.filters_raw}`
                      : null,
                  });

                if (error) {
                  results.push({
                    folder: folderName,
                    status: "error",
                    reason: error.message,
                    data,
                  });
                } else {
                  results.push({
                    folder: folderName,
                    status: "imported",
                    data,
                  });
                }
              } catch (err: any) {
                results.push({
                  folder: folderName,
                  status: "error",
                  reason: err.message ?? "Unknown error",
                });
              }
            }
          }
        } catch (err: any) {
          return new Response(`Import failed: ${err.message}`, { status: 500 });
        }

        const imported = results.filter((r) => r.status === "imported").length;
        const skipped = results.filter((r) => r.status === "skipped").length;
        const errors = results.filter((r) => r.status === "error").length;

        return Response.json({
          ok: true,
          summary: { imported, skipped, errors, total: results.length },
          results,
        });
      },
    },
  },
});
