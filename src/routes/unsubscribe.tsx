import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/unsubscribe")({
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const [status, setStatus] = useState<"loading" | "valid" | "already" | "invalid" | "done" | "error">("loading");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    if (!t) { setStatus("invalid"); return; }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) setStatus("valid");
        else if (d.reason === "already_unsubscribed") setStatus("already");
        else setStatus("invalid");
      })
      .catch(() => setStatus("error"));
  }, []);

  const confirm = async () => {
    if (!token) return;
    setStatus("loading");
    const r = await fetch("/email/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (d.success) setStatus("done");
    else if (d.reason === "already_unsubscribed") setStatus("already");
    else setStatus("error");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-lg border bg-card">
        <h1 className="text-2xl font-semibold">Unsubscribe</h1>
        {status === "loading" && <p className="text-muted-foreground">Loading…</p>}
        {status === "valid" && (
          <>
            <p className="text-muted-foreground">Click below to stop receiving emails from Inspection Clean.</p>
            <Button onClick={confirm}>Confirm unsubscribe</Button>
          </>
        )}
        {status === "already" && <p className="text-muted-foreground">You are already unsubscribed.</p>}
        {status === "invalid" && <p className="text-destructive">This unsubscribe link is invalid or expired.</p>}
        {status === "done" && <p className="text-foreground">You've been unsubscribed. We'll stop sending emails to this address.</p>}
        {status === "error" && <p className="text-destructive">Something went wrong. Please try again.</p>}
      </div>
    </div>
  );
}
