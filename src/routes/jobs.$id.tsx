import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Navigation, Phone, Mail, Send, User, ClipboardCheck, MapPinned, FileText, ExternalLink, Ban } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { JobPhotos } from "@/components/JobPhotos";
import { TimeTracker } from "@/components/TimeTracker";
import { useState } from "react";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/geocode";

export const Route = createFileRoute("/jobs/$id")({ component: JobDetail });

function JobDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [sending, setSending] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

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

  const customerName = data?.job?.customer_name;
  const driveFiles = useQuery({
    queryKey: ["drive-files", id, customerName],
    enabled: !!user && !!customerName,
    queryFn: async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(
        `/api/drive-customer-files?customer=${encodeURIComponent(customerName!)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) return { files: [] as any[] };
      return (await res.json()) as { files: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string; text?: string }> };
    },
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from("job_notes").insert({ job_id: id, body, author_id: user!.id });
      if (error) throw error;
      // Mirror to Drive (fire and forget)
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const customer = data?.job?.customer_name;
        if (customer && token) {
          void fetch("/api/drive-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              kind: "note",
              customerName: customer,
              data: { body, job_id: id, author_id: user!.id, created_at: new Date().toISOString() },
              baseName: `note-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            }),
          }).catch(() => {});
        }
      } catch {}
    },
    onSuccess: () => {
      setNoteText("");
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["drive-files", id] });
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

  const submitCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please enter a reason");
      return;
    }
    setCancelling(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/cancel-job", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ jobId: id, reason: cancelReason.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Job cancelled — service team notified");
      setCancelOpen(false);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["job", id] });
      qc.invalidateQueries({ queryKey: ["my-jobs"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const fixCoordinates = async () => {
    if (!data?.job) return;
    setGeocoding(true);
    const coords = await geocodeAddress(data.job.address);
    setGeocoding(false);
    if (!coords) {
      toast.error("Could not find coordinates for this address");
      return;
    }
    const { error } = await supabase.from("jobs").update({ lat: coords.lat, lng: coords.lng }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Coordinates saved — auto-tracking enabled");
    qc.invalidateQueries({ queryKey: ["job", id] });
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

  const addrEnc = encodeURIComponent(j.address);
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${addrEnc}`;
  const appleMapsUrl = `https://maps.apple.com/?daddr=${addrEnc}`;
  const wazeUrl =
    j.lat != null && j.lng != null
      ? `https://waze.com/ul?ll=${j.lat},${j.lng}&navigate=yes`
      : `https://waze.com/ul?q=${addrEnc}&navigate=yes`;
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
        {(j as any).po_number && (
          <p className="text-sm mt-2"><span className="font-medium">PO:</span> {(j as any).po_number}</p>
        )}
        {Array.isArray((j as any).filters) && (j as any).filters.length > 0 && (
          <div className="text-sm mt-2">
            <p className="font-medium mb-1">Filters</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              {((j as any).filters as Array<{ size: string; qty: string }>).map((f, i) => (
                <li key={i}>{f.size}{f.qty ? ` × ${f.qty}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
        {j.status === "cancelled" && (j as any).cancellation_reason && (
          <div className="text-sm mt-3 p-2 rounded border border-destructive/40 bg-destructive/10">
            <p className="font-medium text-destructive mb-1">Cancelled</p>
            <p className="whitespace-pre-wrap">{(j as any).cancellation_reason}</p>
          </div>
        )}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="w-full mt-3" size="lg">
              <Navigation className="h-4 w-4 mr-2" /> Navigate
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
            <DropdownMenuItem asChild>
              <a href={googleMapsUrl} target="_blank" rel="noreferrer">Google Maps</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={appleMapsUrl} target="_blank" rel="noreferrer">Apple Maps</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={wazeUrl} target="_blank" rel="noreferrer">Waze</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      {(j.lat == null || j.lng == null) && (
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={fixCoordinates} disabled={geocoding}>
          <MapPinned className="h-4 w-4 mr-2" />
          {geocoding ? "Locating…" : "Geocode address for auto-tracking"}
        </Button>
      )}

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
        <h2 className="font-semibold mb-2">Previous notes &amp; files</h2>
        <Card className="p-3 space-y-2">
          {driveFiles.isLoading && <p className="text-sm text-muted-foreground">Loading from customer file…</p>}
          {!driveFiles.isLoading && (driveFiles.data?.files?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No previous files found for this customer.</p>
          )}
          {driveFiles.data?.files?.map((f) => (
            <div key={f.id} className="text-sm border-b last:border-0 pb-2 last:pb-0">
              {f.text ? (
                <>
                  <p className="whitespace-pre-wrap">{f.text}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {f.name} · {f.modifiedTime ? format(new Date(f.modifiedTime), "MMM d, yyyy h:mm a") : ""}
                  </p>
                </>
              ) : (
                <a
                  href={f.webViewLink ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.modifiedTime ? format(new Date(f.modifiedTime), "MMM d, yyyy") : ""}
                  </span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </Card>
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

      {j.status !== "cancelled" && j.status !== "completed" && (
        <div className="mt-4">
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full text-destructive border-destructive/40 hover:bg-destructive/10">
                <Ban className="h-4 w-4 mr-2" /> Unable to perform job
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel job &amp; request reschedule</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This will cancel the job and email service@inspectionclean.com so it can be rescheduled.
              </p>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation (required)"
                rows={4}
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>Back</Button>
                <Button variant="destructive" onClick={submitCancel} disabled={cancelling || !cancelReason.trim()}>
                  {cancelling ? "Cancelling…" : "Cancel job & notify"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </AppShell>
  );
}