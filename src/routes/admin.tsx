import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Users, CalendarArrowDown, ChevronLeft, ChevronRight, List, CalendarDays, FolderInput, FolderTree } from "lucide-react";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, isSameDay, isSameWeek } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({ component: AdminHome });

function AdminHome() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [importingDrive, setImportingDrive] = useState(false);
  const [rebuildingFolders, setRebuildingFolders] = useState(false);
  const [view, setView] = useState<"list" | "week">("list");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));

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
        .order("scheduled_at", { ascending: true });
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

  const importFromCalendar = async () => {
    setImporting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/import-calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { inserted: number; skipped: number; total: number };
      toast.success(`Imported ${json.inserted} new event${json.inserted === 1 ? "" : "s"} (skipped ${json.skipped})`);
      qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const importFromDrive = async () => {
    setImportingDrive(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/import-drive-customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const s = json.summary ?? json;
      toast.success(`Drive import: ${s.imported ?? 0} imported, ${s.skipped ?? 0} skipped, ${s.errors ?? 0} errors`);
      qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    } catch (e: any) {
      toast.error(e.message ?? "Drive import failed");
    } finally {
      setImportingDrive(false);
    }
  };

  const rebuildDriveFolders = async () => {
    setRebuildingFolders(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/rebuild-drive-folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const s = json.summary ?? json;
      toast.success(
        `Folders rebuilt: ${s.active ?? 0} active, ${s.they_will_call ?? 0} will call, ${s.old_customers ?? 0} old, ${s.skipped ?? 0} skipped`
      );
    } catch (e: any) {
      toast.error(e.message ?? "Rebuild failed");
    } finally {
      setRebuildingFolders(false);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">All jobs</h1>
        <div className="flex gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} className="rounded-none" onClick={() => setView("list")}>
              <List className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={view === "week" ? "secondary" : "ghost"} className="rounded-none" onClick={() => setView("week")}>
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={importFromCalendar} disabled={importing}>
            <CalendarArrowDown className="h-4 w-4 mr-1" />
            {importing ? "Importing…" : "Import"}
          </Button>
          <Button size="sm" variant="outline" onClick={importFromDrive} disabled={importingDrive}>
            <FolderInput className="h-4 w-4 mr-1" />
            {importingDrive ? "Importing…" : "Import Drive"}
          </Button>
          <Button size="sm" variant="outline" onClick={rebuildDriveFolders} disabled={rebuildingFolders}>
            <FolderTree className="h-4 w-4 mr-1" />
            {rebuildingFolders ? "Rebuilding…" : "Rebuild Drive Folders"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/users"><Users className="h-4 w-4 mr-1" />Team</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/admin/new"><Plus className="h-4 w-4 mr-1" />New</Link>
          </Button>
        </div>
      </div>
      {view === "week" ? (
        <WeekView
          jobs={jobs ?? []}
          employees={employees ?? {}}
          weekStart={weekStart}
          onPrev={() => setWeekStart((d) => addWeeks(d, -1))}
          onNext={() => setWeekStart((d) => addWeeks(d, 1))}
          onToday={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}
        />
      ) : (
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
      )}
    </AppShell>
  );
}

function WeekView({
  jobs,
  employees,
  weekStart,
  onPrev,
  onNext,
  onToday,
}: {
  jobs: any[];
  employees: Record<string, string>;
  weekStart: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const isCurrentWeek = isSameWeek(new Date(), weekStart, { weekStartsOn: 0 });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onPrev}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={onToday} disabled={isCurrentWeek}>Today</Button>
          <Button size="sm" variant="ghost" onClick={onNext}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
        </p>
      </div>
      <div className="space-y-2">
        {days.map((day) => {
          const dayJobs = jobs.filter((j) => isSameDay(new Date(j.scheduled_at), day));
          const isToday = isSameDay(day, new Date());
          return (
            <Card key={day.toISOString()} className={`p-3 ${isToday ? "border-primary" : ""}`}>
              <div className="flex items-baseline justify-between mb-2">
                <p className={`font-semibold text-sm ${isToday ? "text-primary" : ""}`}>
                  {format(day, "EEEE")} <span className="text-muted-foreground font-normal">{format(day, "MMM d")}</span>
                </p>
                <span className="text-xs text-muted-foreground">{dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}</span>
              </div>
              {dayJobs.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                <div className="space-y-1.5">
                  {dayJobs.map((j) => (
                    <Link key={j.id} to="/jobs/$id" params={{ id: j.id }} className="block">
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-muted transition text-sm">
                        <span className="text-xs text-muted-foreground tabular-nums w-16">{format(new Date(j.scheduled_at), "h:mm a")}</span>
                        <Badge variant="secondary" className="capitalize text-xs">{j.status.replace("_", " ")}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{j.customer_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{j.address}</p>
                        </div>
                        <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">
                          {j.assigned_to ? employees[j.assigned_to] ?? "…" : "Unassigned"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}