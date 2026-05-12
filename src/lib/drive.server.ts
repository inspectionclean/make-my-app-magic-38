const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const ACTIVE_CUSTOMERS_FOLDER = "Active Customers";
const UNSORTED_FOLDER = "Unsorted";

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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res;
}

/**
 * Strip SMS-reminder phone tags from customer names before Drive lookups.
 * Job names like "Roma's Family Restaurant #+18645551234#" become "Roma's Family Restaurant".
 * Also strips trailing/leading whitespace and punctuation left behind.
 */
function normalizeName(name: string): string {
  return name
    .replace(/#\+?[\d\s\-().]{7,}#/g, "")
    .replace(/^(confirmed|pending|maybe)\s*:?\s*/i, "")
    .split(/\s*\/\s*/)[0]
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—,:.]+$/, "")
    .trim();
}

const CUSTOMER_NAME_MAP: Record<string, string> = {
  "mullen's irish pub": "Mullin's Irish Pub",
  "mullin's irish pub": "Mullin's Irish Pub",
};

function canonicalCustomerName(name: string): string {
  const cleaned = normalizeName(name);
  return CUSTOMER_NAME_MAP[cleaned.toLowerCase()] ?? cleaned;
}

function escapeQ(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const q = [
    `name='${escapeQ(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=1`;
  const res = await gfetch(url);
  const json = (await res.json()) as { files?: { id: string; name: string }[] };
  return json.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const res = await gfetch(`/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function findActiveCustomersFolder(): Promise<string | null> {
  return findFolder(ACTIVE_CUSTOMERS_FOLDER);
}

async function listChildFolders(parentId: string): Promise<{ id: string; name: string }[]> {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=200`;
  const res = await gfetch(url);
  const json = (await res.json()) as { files?: { id: string; name: string }[] };
  return json.files ?? [];
}

async function findCustomerFolderUnderActive(customerName: string): Promise<string | null> {
  const active = await findActiveCustomersFolder();
  if (!active) return null;
  // Strip phone tags before searching
  const safe = canonicalCustomerName(customerName);
  if (!safe) return null;

  // Search for folders whose name matches OR contains the customer name,
  // then keep ones whose parent is a month folder directly under "Active Customers".
  const q = [
    `(name='${escapeQ(safe)}' or name contains '${escapeQ(safe)}')`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ].join(" and ");
  const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,parents)")}&pageSize=50`;
  const res = await gfetch(url);
  const json = (await res.json()) as { files?: { id: string; name: string; parents?: string[] }[] };
  const candidates = json.files ?? [];
  if (!candidates.length) return null;

  const monthFolders = await listChildFolders(active);
  const monthIds = new Set(monthFolders.map((f) => f.id));
  const inMonth = candidates.filter((c) => c.parents?.some((p) => monthIds.has(p)));
  if (!inMonth.length) return null;

  // Prefer exact match, then shortest name (most specific match for the prefix).
  const exact = inMonth.find((c) => c.name.toLowerCase() === safe.toLowerCase());
  if (exact) return exact.id;
  inMonth.sort((a, b) => a.name.length - b.name.length);
  return inMonth[0].id;
}

export async function getOrCreateCustomerFolder(customerName: string): Promise<string> {
  // Strip phone tags so "Roma's #+18645551234#" finds "Roma's Family Restaurant - Woodruff"
  const safe = canonicalCustomerName(customerName) || "Unknown Customer";

  // Prefer existing folder under My Drive / Active Customers / {month} / {customer}
  const existing = await findCustomerFolderUnderActive(safe);
  if (existing) return existing;

  // Fallback: place new folders under Active Customers / Unsorted / {customer}
  const active = await findActiveCustomersFolder();
  if (!active) {
    throw new Error(
      `Google Drive folder "${ACTIVE_CUSTOMERS_FOLDER}" not found in My Drive. Create it, or move existing customer folders under it.`,
    );
  }
  let unsorted = await findFolder(UNSORTED_FOLDER, active);
  if (!unsorted) unsorted = await createFolder(UNSORTED_FOLDER, active);
  const inUnsorted = await findFolder(safe, unsorted);
  if (inUnsorted) return inUnsorted;
  return createFolder(safe, unsorted);
}

export async function uploadFile(opts: {
  folderId: string;
  name: string;
  mimeType: string;
  content: Uint8Array | string;
}): Promise<{ id: string; name: string }> {
  const boundary = "----lovable" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const bodyBytes =
    typeof opts.content === "string"
      ? new TextEncoder().encode(opts.content)
      : opts.content;

  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + bodyBytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(bodyBytes, head.byteLength);
  body.set(tail, head.byteLength + bodyBytes.byteLength);

  const res = await gfetch(`/upload/drive/v3/files?uploadType=multipart&fields=id,name`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as { id: string; name: string };
}

export async function listCustomerFiles(customerName: string) {
  // Strip phone tags before folder lookup
  const safe = canonicalCustomerName(customerName) || "Unknown Customer";
  let folder = await findCustomerFolderUnderActive(safe);
  if (!folder) {
    const active = await findActiveCustomersFolder();
    if (active) {
      const unsorted = await findFolder(UNSORTED_FOLDER, active);
      if (unsorted) folder = await findFolder(safe, unsorted);
    }
  }
  if (!folder) return [] as DriveFile[];
  const q = `'${folder}' in parents and trashed=false`;
  const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink,size)")}&orderBy=modifiedTime%20desc&pageSize=100`;
  const res = await gfetch(url);
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

export async function downloadFileText(fileId: string): Promise<string> {
  const res = await gfetch(`/drive/v3/files/${fileId}?alt=media`);
  return res.text();
}

export async function listLooseFilesInActiveCustomers(): Promise<
  { monthId: string; monthName: string; files: { id: string; name: string; mimeType: string }[] }[]
> {
  const active = await findFolder(ACTIVE_CUSTOMERS_FOLDER);
  if (!active) return [];
  const months = await listChildFolders(active);
  const out: { monthId: string; monthName: string; files: { id: string; name: string; mimeType: string }[] }[] = [];
  for (const m of months) {
    const q = `'${m.id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
    const url = `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,mimeType)")}&pageSize=1000`;
    const res = await gfetch(url);
    const json = (await res.json()) as { files?: { id: string; name: string; mimeType: string }[] };
    out.push({ monthId: m.id, monthName: m.name, files: json.files ?? [] });
  }
  return out;
}

export async function moveFile(fileId: string, addParentId: string, removeParentId: string): Promise<void> {
  await gfetch(
    `/drive/v3/files/${fileId}?addParents=${encodeURIComponent(addParentId)}&removeParents=${encodeURIComponent(removeParentId)}&fields=id,parents`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function cadenceMonths(serviceType?: string | null): number | null {
  const s = (serviceType ?? "").toLowerCase().trim();
  if (!s) return null;
  if (s.includes("month")) return 1;
  if (s.includes("quarter")) return 3;
  if (s.includes("semi") || s.includes("bi-annual") || s.includes("biannual") || s.includes("6 month")) return 6;
  if (s.includes("annual") || s.includes("year")) return 12;
  return null;
}

function monthFolderName(d: Date): string {
  const m = d.getUTCMonth();
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${m + 1}- ${MONTH_NAMES[m]} ${yy}`;
}

function parseMonthFolder(name: string): { month: number; year: number } | null {
  // Matches "5- May 26" or "12- December 26"
  const m = name.match(/^(\d{1,2})-\s*([A-Za-z]+)\s+(\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
  return { month, year };
}

async function getOrCreateMonthFolder(target: Date): Promise<string> {
  const active = await findActiveCustomersFolder();
  if (!active) throw new Error(`"${ACTIVE_CUSTOMERS_FOLDER}" folder not found`);
  const desiredName = monthFolderName(target);
  const months = await listChildFolders(active);
  const exact = months.find((f) => f.name.trim().toLowerCase() === desiredName.toLowerCase());
  if (exact) return exact.id;
  // Try to match by parsed month/year so slight name variants still resolve
  for (const f of months) {
    const p = parseMonthFolder(f.name.trim());
    if (p && p.month === target.getUTCMonth() + 1 && p.year === target.getUTCFullYear()) {
      return f.id;
    }
  }
  return createFolder(desiredName, active);
}

/**
 * Move a customer folder to the next due month based on the service cadence.
 * Returns info about the move, or null if it was skipped (no cadence, no parent month).
 */
export async function scheduleNextDueMonth(opts: {
  customerName: string;
  serviceType?: string | null;
  serviceDate?: string | null; // YYYY-MM-DD
}): Promise<{ folderId: string; from: string; to: string; toFolderId: string } | null> {
  const months = cadenceMonths(opts.serviceType);
  if (!months) return null;

  // Strip phone tags before folder lookup
  const folderId = await findCustomerFolderUnderActive(canonicalCustomerName(opts.customerName));
  if (!folderId) return null;

  // Look up the folder's current parent (a month folder under Active Customers)
  const meta = await gfetch(`/drive/v3/files/${folderId}?fields=parents,name`);
  const metaJson = (await meta.json()) as { parents?: string[]; name: string };
  const active = await findActiveCustomersFolder();
  if (!active) return null;
  const monthFolders = await listChildFolders(active);
  const monthIds = new Set(monthFolders.map((f) => f.id));
  const currentParentId = metaJson.parents?.find((p) => monthIds.has(p));
  if (!currentParentId) return null;
  const currentParent = monthFolders.find((f) => f.id === currentParentId)!;

  // Compute target month from service_date if provided, else current parent month, else today
  let base: Date;
  if (opts.serviceDate) {
    base = new Date(`${opts.serviceDate}T00:00:00Z`);
  } else {
    const parsed = parseMonthFolder(currentParent.name.trim());
    base = parsed
      ? new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
      : new Date();
  }
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));

  const toFolderId = await getOrCreateMonthFolder(target);
  if (toFolderId === currentParentId) {
    return { folderId, from: currentParent.name, to: currentParent.name, toFolderId };
  }

  await moveFile(folderId, toFolderId, currentParentId);
  return { folderId, from: currentParent.name, to: monthFolderName(target), toFolderId };
}

/**
 * List all customer subfolder names under the month folder for the given target date.
 * Returns [] if the month folder does not exist.
 */
export async function listCustomersDueForMonth(target: Date): Promise<{ monthName: string; customers: { id: string; name: string }[] }> {
  const active = await findActiveCustomersFolder();
  if (!active) return { monthName: monthFolderName(target), customers: [] };
  const months = await listChildFolders(active);
  const match = months.find((f) => {
    const p = parseMonthFolder(f.name.trim());
    return p && p.month === target.getUTCMonth() + 1 && p.year === target.getUTCFullYear();
  });
  if (!match) return { monthName: monthFolderName(target), customers: [] };
  const customers = await listChildFolders(match.id);
  return { monthName: match.name, customers };
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return name;
  return name.slice(0, i);
}

export async function organizeActiveCustomers(): Promise<{
  scanned: number;
  organized: number;
  skipped: number;
  details: { file: string; month: string; folder: string; action: "moved" | "skipped"; reason?: string }[];
}> {
  const months = await listLooseFilesInActiveCustomers();
  const details: { file: string; month: string; folder: string; action: "moved" | "skipped"; reason?: string }[] = [];
  let scanned = 0;
  let organized = 0;
  let skipped = 0;
  for (const m of months) {
    for (const f of m.files) {
      scanned++;
      const folderName = stripExt(f.name).trim();
      if (!folderName) {
        skipped++;
        details.push({ file: f.name, month: m.monthName, folder: "", action: "skipped", reason: "empty name" });
        continue;
      }
      try {
        let folderId = await findFolder(folderName, m.monthId);
        if (!folderId) folderId = await createFolder(folderName, m.monthId);
        await moveFile(f.id, folderId, m.monthId);
        organized++;
        details.push({ file: f.name, month: m.monthName, folder: folderName, action: "moved" });
      } catch (e: any) {
        skipped++;
        details.push({ file: f.name, month: m.monthName, folder: folderName, action: "skipped", reason: e?.message ?? "error" });
      }
    }
  }
  return { scanned, organized, skipped, details };
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
};
