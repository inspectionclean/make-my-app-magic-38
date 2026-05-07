import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock, ChevronRight, CalendarDays, Settings, ClipboardList, FileCheck2 } from "lucide-react";
import { format, isToday, isTomorrow, isPast } from "date-fns";

export const Route = createFileRoute("/")({ component: SchedulePage });

function SchedulePage() {
  const { user, role } = useAuth();

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["my-jobs", user?.id, role],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from("jobs").select("*").order("scheduled_at", { ascending: true });
      if (role !== "admin") q = q.eq("assigned_to", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <div className="space-y-1 mb-5">
        <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMM d")}</p>
        <h1 className="text-2xl font-semibold tracking-tight">My schedule</h1>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {role === "admin" && (
          <Link to="/admin">
            <Card className="p-3 hover:shadow-md transition cursor-pointer h-full">
              <Settings className="h-5 w-5 text-primary mb-1" />
              <p className="font-medium text-sm">Admin</p>
              <p className="text-xs text-muted-foreground">Manage jobs</p>
            </Card>
          </Link>
        )}
        <Link to="/performance-report">
          <Card className="p-3 hover:shadow-md transition cursor-pointer h-full">
            <FileCheck2 className="h-5 w-5 text-primary mb-1" />
            <p className="font-medium text-sm">Performance Report</p>
            <p className="text-xs text-muted-foreground">Submit hood cleaning report</p>
          </Card>
        </Link>
        <Link to="/intake">
          <Card className="p-3 hover:shadow-md transition cursor-pointer h-full">
            <ClipboardList className="h-5 w-5 text-primary mb-1" />
            <p className="font-medium text-sm">Intake Form</p>
            <p className="text-xs text-muted-foreground">New customer (public)</p>
          </Card>
        </Link>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !jobs?.length ? (
        <Card className="p-8 text-center">
          <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium">No jobs scheduled</p>
          <p className="text-sm text-muted-foreground mt-1">
            {role === "admin" ? "Create a job from the Admin tab." : "Check back soon."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const dt = new Date(j.scheduled_at);
            const label = isToday(dt) ? "Today" : isTomorrow(dt) ? "Tomorrow" : format(dt, "EEE, MMM d");
            return (
              <Link key={j.id} to="/jobs/$id" params={{ id: j.id }}>
                <Card className="p-4 active:scale-[0.99] transition hover:shadow-md cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={j.status === "completed" ? "secondary" : "default"} className="capitalize">
                          {j.status.replace("_", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{label}</span>
                      </div>
                      <h3 className="font-semibold truncate">{j.customer_name}</h3>
                      <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="h-3.5 w-3.5" />
                        {format(dt, "h:mm a")}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-start gap-1 mt-1">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span className="truncate">{j.address}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
