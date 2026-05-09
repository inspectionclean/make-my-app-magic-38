import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Briefcase, Calendar, Settings, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { session, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [session, loading, navigate]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const isAdmin = role === "admin";
  const onAdmin = location.pathname.startsWith("/admin");

  return (
    <div className="min-h-screen flex flex-col bg-background pb-20">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 rounded-lg text-primary-foreground flex items-center justify-center shadow-sm"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              <Briefcase className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">FieldOps</span>
          </Link>
          <Button variant="ghost" size="icon" onClick={() => signOut().then(() => navigate({ to: "/login" }))}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4">{children}</main>
      {isAdmin && (
        <nav className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur">
          <div className="max-w-2xl mx-auto grid grid-cols-2">
            <Link
              to="/"
              className={`flex flex-col items-center gap-1 py-3 text-xs ${!onAdmin ? "text-primary" : "text-muted-foreground"}`}
            >
              <Calendar className="h-5 w-5" />
              Schedule
            </Link>
            <Link
              to="/admin"
              className={`flex flex-col items-center gap-1 py-3 text-xs ${onAdmin ? "text-primary" : "text-muted-foreground"}`}
            >
              <Settings className="h-5 w-5" />
              Admin
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}