import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Navigation, Phone, Mail, Send, User, ClipboardCheck } from "lucide-react";
import { format } from "date-fns";
import { JobPhotos } from "@/components/JobPhotos";
import { TimeTracker } from "@/components/TimeTracker";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/jobs/$id")({ component: JobDetail });

function JobDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["job", id],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: job }, { data: photos }, { data: notes }, { data: times }, { data: reports }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
        supabase.from("job_photos").select("*").eq("job_id", id).order("taken_at"),
        supabase.from("job_notes").select("*").eq("job_id", id).order("created_at"),
        supabase.from("time_entries").select("*").eq("job_id", id).order("arrived_at"),
        supabase.from("performance_reports").select("id").eq("job_id", id).limit(1),
      ]);
      return { job, photos: photos ?? [], notes: notes ?? [], times: times ?? [], hasReport: (reports ?? []).length > 0 };
    },
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from("job_notes").insert({ job_id: id, body, author_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setNoteText("");
      qc.invalidateQueries({ queryKey: ["job", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setStatus = async (status: "scheduled" | "in_progress" | "completed") => {
    const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["job", id] });
  };

  const sendReport = async () => {
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/send-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ jobId: id }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Report sent");
      await supabase.from("jobs").update({ report_sent_at: new Date().toISOString() }).eq("id", id);
      qc.invalidateQueries({ queryKey: ["job", id] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  if (isLoading || !data) {
    return (
      <AppShell>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </AppShell>
    );
  }
  const j = data.job;
  if (!j) {
    return (
      <AppShell>
        <p>Job not found.</p>
      </AppShell>
    );
  }

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address)}`;
  const before = data.photos.filter((p) => p.type === "before");
  const after = data.photos.filter((p) => p.type === "after");

  return (
    <AppShell>
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-3">
        <ArrowLeft className="h-4 w-4" /> Schedule
      </Link>

      <Card className="p-4 mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h1 className="text-xl font-semibold">{j.customer_name}</h1>
          <Badge variant={j.status === "completed" ? "secondary" : "default"} className="capitalize">
            {j.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{format(new Date(j.scheduled_at), "EEE, MMM d • h:mm a")}</p>
        {j.description && <p className="text-sm mt-2">{j.description}</p>}
        <div className="space-y-2 mt-3 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span>{j.address}</span>
          </div>
          {j.customer_phone && (
            <a href={`tel:${j.customer_phone}`} className="flex items-center gap-2 text-primary">
              <Phone className="h-4 w-4" /> {j.customer_phone}
            </a>
          )}
          {j.customer_email && (
            <a href={`mailto:${j.customer_email}`} className="flex items-center gap-2 text-primary">
              <Mail className="h-4 w-4" /> {j.customer_email}
            </a>
          )}
        </div>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="block mt-3">
          <Button className="w-full" size="lg">
            <Navigation className="h-4 w-4 mr-2" /> Open in Google Maps
          </Button>
        </a>
        {j.status !== "completed" && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {j.status === "scheduled" && (
              <Button variant="outline" className="col-span-2" onClick={() => setStatus("in_progress")}>Start job</Button>
            )}
            {j.status === "in_progress" && (
              <>
                <Button asChild variant="outline">
                  <Link to="/performance-report" search={{ jobId: j.id }}>
                    <ClipboardCheck className="h-4 w-4 mr-1" />
                    {data.hasReport ? "Report submitted" : "Performance report"}
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!data.hasReport) {
                      toast.error("Performance report must be completed to mark job complete!");
                      return;
                    }
                    setStatus("completed");
                  }}
                  title={!data.hasReport ? "Submit performance report first" : undefined}
                >
                  Mark complete
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <TimeTracker
        jobId={j.id}
        userId={user!.id}
        jobLat={j.lat}
        jobLng={j.lng}
        entries={data.times}
      />

      <div className="mt-4">
        <h2 className="font-semibold mb-2">Before</h2>
        <JobPhotos jobId={j.id} type="before" photos={before} userId={user!.id} />
      </div>
      <div className="mt-4">
        <h2 className="font-semibold mb-2">After</h2>
        <JobPhotos jobId={j.id} type="after" photos={after} userId={user!.id} />
      </div>

      <div className="mt-5">
        <h2 className="font-semibold mb-2">Notes</h2>
        <Card className="p-3 space-y-2 mb-2">
          {data.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
          {data.notes.map((n) => (
            <div key={n.id} className="text-sm border-b last:border-0 pb-2 last:pb-0">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <User className="h-3 w-3" />
                {format(new Date(n.created_at), "MMM d, h:mm a")}
              </p>
            </div>
          ))}
        </Card>
        <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note…" />
        <Button
          className="mt-2 w-full"
          variant="secondary"
          disabled={!noteText.trim() || addNote.isPending}
          onClick={() => addNote.mutate(noteText.trim())}
        >
          Add note
        </Button>
      </div>

      <div className="mt-5">
        <Button className="w-full" size="lg" onClick={sendReport} disabled={sending}>
          <Send className="h-4 w-4 mr-2" />
          {sending ? "Sending…" : j.report_sent_at ? "Resend report" : "Send report"}
        </Button>
        {j.report_sent_at && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Last sent {format(new Date(j.report_sent_at), "MMM d, h:mm a")}
          </p>
        )}
      </div>
    </AppShell>
  );
}