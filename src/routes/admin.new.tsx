import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/new")({ component: NewJobPage });

function NewJobPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    address: "",
    description: "",
    scheduled_at: "",
    assigned_to: "",
    mgmt_email: "",
  });

  useEffect(() => {
    if (!loading && role && role !== "admin") navigate({ to: "/" });
  }, [role, loading, navigate]);

  const { data: employees } = useQuery({
    queryKey: ["employees-list"],
    enabled: role === "admin",
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_name || !form.address || !form.scheduled_at) {
      toast.error("Please fill name, address, and scheduled time");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        customer_name: form.customer_name,
        customer_email: form.customer_email || null,
        customer_phone: form.customer_phone || null,
        address: form.address,
        description: form.description || null,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        assigned_to: form.assigned_to || null,
        mgmt_email: form.mgmt_email || null,
        created_by: user?.id,
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Job created");
    navigate({ to: "/jobs/$id", params: { id: data!.id } });
  };

  return (
    <AppShell>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/admin"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-semibold">New job</h1>
      </div>
      <Card className="p-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="customer_name">Customer name *</Label>
            <Input id="customer_name" value={form.customer_name} onChange={update("customer_name")} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customer_email">Customer email</Label>
              <Input id="customer_email" type="email" value={form.customer_email} onChange={update("customer_email")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer_phone">Customer phone</Label>
              <Input id="customer_phone" value={form.customer_phone} onChange={update("customer_phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address *</Label>
            <Input id="address" value={form.address} onChange={update("address")} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduled_at">Scheduled time *</Label>
            <Input id="scheduled_at" type="datetime-local" value={form.scheduled_at} onChange={update("scheduled_at")} required />
          </div>
          <div className="space-y-1.5">
            <Label>Assign to</Label>
            <Select value={form.assigned_to} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v }))}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {employees?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name || "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mgmt_email">Management email (for report)</Label>
            <Input id="mgmt_email" type="email" value={form.mgmt_email} onChange={update("mgmt_email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description / notes</Label>
            <Textarea id="description" rows={3} value={form.description} onChange={update("description")} />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating…" : "Create job"}
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}