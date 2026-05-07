import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldCheck, User as UserIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({ component: UsersPage });

type RoleRow = { user_id: string; role: "admin" | "employee" };
type ProfileRow = { id: string; full_name: string | null };

function UsersPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && role && role !== "admin") navigate({ to: "/" });
  }, [role, loading, navigate]);

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    enabled: role === "admin",
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: roles } = useQuery({
    queryKey: ["all-roles"],
    enabled: role === "admin",
    queryFn: async (): Promise<RoleRow[]> => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
  });

  const promote = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Promoted to admin");
      qc.invalidateQueries({ queryKey: ["all-roles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to promote"),
  });

  const demote = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed admin role");
      qc.invalidateQueries({ queryKey: ["all-roles"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to remove admin"),
  });

  const isAdmin = (uid: string) =>
    (roles ?? []).some((r) => r.user_id === uid && r.role === "admin");

  return (
    <AppShell>
      <div className="flex items-center gap-2 mb-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-2xl font-semibold">Team & admins</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Promote any team member to admin. They must have signed up at least once.
      </p>
      <div className="space-y-3">
        {profiles?.map((p) => {
          const admin = isAdmin(p.id);
          const isSelf = p.id === user?.id;
          return (
            <Card key={p.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{p.full_name || "Unnamed"}</p>
                  {admin ? (
                    <Badge className="gap-1"><ShieldCheck className="h-3 w-3" />Admin</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1"><UserIcon className="h-3 w-3" />Employee</Badge>
                  )}
                </div>
              </div>
              {admin ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSelf || demote.isPending}
                  onClick={() => demote.mutate(p.id)}
                >
                  {isSelf ? "You" : "Remove admin"}
                </Button>
              ) : (
                <Button size="sm" disabled={promote.isPending} onClick={() => promote.mutate(p.id)}>
                  Make admin
                </Button>
              )}
            </Card>
          );
        })}
        {profiles?.length === 0 && (
          <p className="text-sm text-muted-foreground">No users yet.</p>
        )}
      </div>
    </AppShell>
  );
}