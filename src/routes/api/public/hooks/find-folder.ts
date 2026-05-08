import { createFileRoute } from "@tanstack/react-router";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

export const Route = createFileRoute("/api/public/hooks/find-folder")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.searchParams.get("name") ?? "Roma";
        const lk = process.env.LOVABLE_API_KEY!;
        const dk = process.env.GOOGLE_DRIVE_API_KEY!;
        const headers = { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk };
        const q = `name contains '${name.replace(/'/g, "\\'")}' and trashed=false`;
        const r = await fetch(
          `${GATEWAY}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name,mimeType,parents)")}&pageSize=50`,
          { headers },
        );
        const j = await r.json();
        return Response.json(j);
      },
    },
  },
});