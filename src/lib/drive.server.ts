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
  const safe = customerName.trim();
  if (!safe) return null;

  // 1) Search globally for a folder with this name, then keep ones whose
  //    parent is a month folder directly under "Active Customers".
  const q = [
    `name='${escapeQ(safe)}'`,
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
  const match = candidates.find((c) => c.parents?.some((p) => monthIds.has(p)));
  return match?.id ?? null;
}

export async function getOrCreateCustomerFolder(customerName: string): Promise<string> {
  const safe = customerName.trim() || "Unknown Customer";

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
  const safe = customerName.trim() || "Unknown Customer";
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