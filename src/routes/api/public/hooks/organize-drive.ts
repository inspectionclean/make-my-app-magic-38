import { createFileRoute } from "@tanstack/react-router";
import { organizeActiveCustomers } from "@/lib/drive.server";

export const Route = createFileRoute("/api/public/hooks/organize-drive")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await organizeActiveCustomers();
          return Response.json(result);
        } catch (e: any) {
          return new Response(`Organize failed: ${e?.message ?? "error"}`, { status: 500 });
        }
      },
      GET: async () => {
        try {
          const result = await organizeActiveCustomers();
          return Response.json(result);
        } catch (e: any) {
          return new Response(`Organize failed: ${e?.message ?? "error"}`, { status: 500 });
        }
      },
    },
  },
});