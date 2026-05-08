const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const ROOT_FOLDER_NAME = "Inspection Clean Forms";

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

export async function getOrCreateRootFolder(): Promise<string> {
  const existing = await findFolder(ROOT_FOLDER_NAME);
  if (existing) return existing;
  return createFolder(ROOT_FOLDER_NAME);
}

export async function getOrCreateCustomerFolder(customerName: string): Promise<string> {
  const root = await getOrCreateRootFolder();
  const safe = customerName.trim() || "Unknown Customer";
  const existing = await findFolder(safe, root);
  if (existing) return existing;
  return createFolder(safe, root);
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
  const root = await findFolder(ROOT_FOLDER_NAME);
  if (!root) return [] as DriveFile[];
  const folder = await findFolder(customerName.trim() || "Unknown Customer", root);
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

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
};