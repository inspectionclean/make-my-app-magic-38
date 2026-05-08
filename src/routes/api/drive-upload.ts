import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOrCreateCustomerFolder, uploadFile } from "@/lib/drive.server";
import { buildSimplePdf } from "@/lib/pdf.server";

export const Route = createFileRoute("/api/drive-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });

        let body: {
          kind: "intake" | "report" | "note";
          customerName: string;
          data: Record<string, unknown>;
          baseName?: string;
        };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body?.customerName || !body?.kind || !body?.data) {
          return new Response("Missing fields", { status: 400 });
        }

        try {
          const folderId = await getOrCreateCustomerFolder(body.customerName);
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const base = body.baseName?.trim() || `${body.kind}-${ts}`;

          const sections = sectionsFor(body.kind, body.data);
          const pdfBytes = await buildSimplePdf({
            title: titleFor(body.kind, body.data),
            subtitle: new Date().toLocaleString(),
            sections,
          });

          await uploadFile({
            folderId,
            name: `${base}.pdf`,
            mimeType: "application/pdf",
            content: pdfBytes,
          });
          await uploadFile({
            folderId,
            name: `${base}.json`,
            mimeType: "application/json",
            content: JSON.stringify(body.data, null, 2),
          });
          // Also upload note as plain text so "previous notes" can show inline
          if (body.kind === "note" && typeof body.data.body === "string") {
            await uploadFile({
              folderId,
              name: `${base}.txt`,
              mimeType: "text/plain",
              content: String(body.data.body),
            });
          }
          return Response.json({ ok: true });
        } catch (e: any) {
          return new Response(`Drive upload failed: ${e.message}`, { status: 500 });
        }
      },
    },
  },
});

function titleFor(kind: string, d: Record<string, unknown>) {
  if (kind === "intake") return "Customer Intake Form";
  if (kind === "report") return "Hood Cleaning Performance Report";
  if (kind === "note") return "Job Note";
  return "Form";
}

function sectionsFor(kind: string, d: Record<string, unknown>) {
  const rows = (obj: Record<string, unknown>): [string, string][] =>
    Object.entries(obj)
      .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => [
        k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v),
      ]);
  return [{ heading: "Details", rows: rows(d) }];
}