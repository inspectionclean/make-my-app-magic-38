import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldCheck, User as UserIcon, Briefcase } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({ component: UsersPage });

type AppRole = "admin" | "employee" | "office";
type RoleRow = { user_id: string; role: AppRole };
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

  const toggleRole = useMutation({
    mutationFn: async ({ userId, r, on }: { userId: string; r: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: r });
        if (error && !String(error.message).includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", r);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Roles updated");
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["employees-list"] });
      qc.invalidateQueries({ queryKey: ["employees-map"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update role"),
  });

  const rolesFor = (uid: string): AppRole[] =>
    (roles ?? []).filter((r) => r.user_id === uid).map((r) => r.role);

  return (
    <AppShell>
      <div className="flex items-center gap-2 mb-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-2xl font-semibold">Team & admins</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Toggle any combination of roles. Only <strong>Field employees</strong> appear in the job assignment list. <strong>Admin</strong> grants full access; <strong>Office</strong> is staff who don't go into the field.
      </p>
      <div className="space-y-3">
        {profiles?.map((p) => {
          const current = rolesFor(p.id);
          const isSelf = p.id === user?.id;
          return (
            <Card key={p.id} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate flex-1">{p.full_name || "Unnamed"}</p>
                <div className="flex flex-wrap gap-1 justify-end">
                  {current.includes("admin") && (
                    <Badge className="gap-1"><ShieldCheck className="h-3 w-3" />Admin</Badge>
                  )}
                  {current.includes("employee") && (
                    <Badge variant="secondary" className="gap-1"><UserIcon className="h-3 w-3" />Field</Badge>
                  )}
                  {current.includes("office") && (
                    <Badge variant="outline" className="gap-1"><Briefcase className="h-3 w-3" />Office</Badge>
                  )}
                  {current.length === 0 && (
                    <Badge variant="outline">No role</Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["admin", "employee", "office"] as AppRole[]).map((r) => {
                  const on = current.includes(r);
                  const disableSelfAdmin = isSelf && r === "admin" && on;
                  return (
                    <Button
                      key={r}
                      size="sm"
                      variant={on ? "default" : "outline"}
                      disabled={toggleRole.isPending || disableSelfAdmin}
                      onClick={() => toggleRole.mutate({ userId: p.id, r, on: !on })}
                    >
                      {on ? "✓ " : ""}
                      {r === "admin" ? "Admin" : r === "employee" ? "Field" : "Office"}
                    </Button>
                  );
                })}
              </div>
              {isSelf && current.includes("admin") && (
                <p className="text-xs text-muted-foreground">You can't change your own admin role.</p>
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