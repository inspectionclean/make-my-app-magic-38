import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Clock, MapPinned, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { distanceMeters, ARRIVAL_RADIUS_M } from "@/lib/geo";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

interface Entry {
  id: string;
  arrived_at: string;
  left_at: string | null;
  source: string;
}

function formatDuration(start: string, end: string | null) {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((e - s) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function TimeTracker({
  jobId,
  userId,
  jobLat,
  jobLng,
  entries,
}: {
  jobId: string;
  userId: string;
  jobLat: number | null;
  jobLng: number | null;
  entries: Entry[];
}) {
  const qc = useQueryClient();
  const [, tick] = useState(0);
  const [geoState, setGeoState] = useState<"idle" | "watching" | "denied">("idle");
  const [distance, setDistance] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const open = entries.find((e) => !e.left_at);

  // Live timer ticking
  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(i);
  }, [open]);

  const clockIn = async (source: "auto" | "manual") => {
    const { error } = await supabase.from("time_entries").insert({ job_id: jobId, user_id: userId, source });
    if (error) return toast.error(error.message);
    toast.success("Clocked in");
    qc.invalidateQueries({ queryKey: ["job", jobId] });
  };
  const clockOut = async () => {
    if (!open) return;
    const { error } = await supabase.from("time_entries").update({ left_at: new Date().toISOString() }).eq("id", open.id);
    if (error) return toast.error(error.message);
    toast.success("Clocked out");
    qc.invalidateQueries({ queryKey: ["job", jobId] });
  };

  // Auto geolocation watcher
  useEffect(() => {
    if (jobLat == null || jobLng == null) return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoState("watching");
        const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, jobLat, jobLng);
        setDistance(d);
        if (d <= ARRIVAL_RADIUS_M && !open) {
          clockIn("auto");
        } else if (d > ARRIVAL_RADIUS_M * 2 && open && open.source === "auto") {
          clockOut();
        }
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    watchId.current = id;
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobLat, jobLng, open?.id]);

  const totalMinutes = entries.reduce((acc, e) => {
    const s = new Date(e.arrived_at).getTime();
    const en = e.left_at ? new Date(e.left_at).getTime() : Date.now();
    return acc + Math.max(0, Math.floor((en - s) / 60000));
  }, 0);
  const totalH = Math.floor(totalMinutes / 60);
  const totalM = totalMinutes % 60;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Total time on site</p>
          <p className="text-2xl font-semibold tabular-nums">
            {totalH > 0 ? `${totalH}h ` : ""}{totalM}m
          </p>
        </div>
        {open ? (
          <Button variant="destructive" onClick={clockOut}>
            <Square className="h-4 w-4 mr-1" /> Clock out
          </Button>
        ) : (
          <Button onClick={() => clockIn("manual")}>
            <Play className="h-4 w-4 mr-1" /> Clock in
          </Button>
        )}
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <MapPinned className="h-3.5 w-3.5" />
        {jobLat == null || jobLng == null
          ? "No coordinates — auto-tracking disabled"
          : geoState === "denied"
            ? "Location denied — use manual buttons"
            : distance == null
              ? "Acquiring location…"
              : distance <= ARRIVAL_RADIUS_M
                ? "On site (auto-tracking)"
                : `${Math.round(distance)} m away`}
      </div>
      {entries.length > 0 && (
        <div className="border-t pt-2 space-y-1">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(new Date(e.arrived_at), "h:mm a")} – {e.left_at ? format(new Date(e.left_at), "h:mm a") : "now"}
              </span>
              <span>{formatDuration(e.arrived_at, e.left_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}