import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listCustomerFiles, downloadFileText } from "@/lib/drive.server";

export const Route = createFileRoute("/api/drive-customer-files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        const { data: claims } = await supabaseAdmin.auth.getClaims(token);
        if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const customer = url.searchParams.get("customer")?.trim();
        if (!customer) return new Response("Missing customer", { status: 400 });

        try {
          const files = await listCustomerFiles(customer);
          // Inline content for text/note files
          const enriched = await Promise.all(
            files.map(async (f) => {
              if (f.mimeType === "text/plain" && f.name.startsWith("note-")) {
                try {
                  const text = await downloadFileText(f.id);
                  return { ...f, text };
                } catch {
                  return f;
                }
              }
              return f;
            }),
          );
          return Response.json({ files: enriched });
        } catch (e: any) {
          return new Response(`Drive list failed: ${e.message}`, { status: 500 });
        }
      },
    },
  },
});