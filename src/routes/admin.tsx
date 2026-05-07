import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Users } from "lucide-react";
import { format } from "date-fns";
import { useEffect } from "react";

export const Route = createFileRoute("/admin")({ component: AdminHome });

function AdminHome() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && role && role !== "admin") navigate({ to: "/" });
  }, [role, loading, navigate]);

  const { data: jobs } = useQuery({
    queryKey: ["admin-jobs"],
    enabled: role === "admin",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: employees } = useQuery({
    queryKey: ["employees-map"],
    enabled: role === "admin",
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      const map: Record<string, string> = {};
      (data ?? []).forEach((p) => (map[p.id] = p.full_name || "Unknown"));
      return map;
    },
  });

  if (location.pathname !== "/admin") {
    return <Outlet />;
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">All jobs</h1>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/users"><Users className="h-4 w-4 mr-1" />Team</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/admin/new"><Plus className="h-4 w-4 mr-1" />New</Link>
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {jobs?.map((j) => (
          <Link key={j.id} to="/jobs/$id" params={{ id: j.id }}>
            <Card className="p-4 hover:shadow-md transition cursor-pointer">
              <div className="flex items-center justify-between mb-1">
                <Badge className="capitalize">{j.status.replace("_"," ")}</Badge>
                <span className="text-xs text-muted-foreground">{format(new Date(j.scheduled_at), "MMM d, h:mm a")}</span>
              </div>
              <p className="font-semibold">{j.customer_name}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-3.5 w-3.5" />{j.address}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Assigned to: {j.assigned_to ? employees?.[j.assigned_to] ?? "…" : "Unassigned"}
              </p>
            </Card>
          </Link>
        ))}
        {jobs?.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet. Create one to get started.</p>}
      </div>
    </AppShell>
  );
}