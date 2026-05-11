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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/geocode";

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
    service_type: "",
    po_number: "",
  });
  const [filters, setFilters] = useState<{ size: string; qty: string }[]>([]);
  const [lastCleanDate, setLastCleanDate] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && role && role !== "admin") navigate({ to: "/" });
  }, [role, loading, navigate]);

  const { data: employees } = useQuery({
    queryKey: ["employees-list"],
    enabled: role === "admin",
    queryFn: async () => {
      const [{ data: profiles, error: pErr }, { data: roleRows, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      const employeeIds = new Set(
        (roleRows ?? []).filter((r) => r.role === "employee").map((r) => r.user_id),
      );
      return (profiles ?? []).filter((p) => employeeIds.has(p.id));
    },
  });

  // Predictive-text source: dedupe customers from previous jobs + intake submissions.
  const { data: customerSuggestions } = useQuery({
    queryKey: ["customer-suggestions"],
    enabled: role === "admin",
    queryFn: async () => {
      const [{ data: jobs }, { data: intakes }] = await Promise.all([
        supabase
          .from("jobs")
          .select("customer_name, customer_email, customer_phone, address, mgmt_email, service_type")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("intake_submissions")
          .select("business_name, contact_name, email, phone, service_address, city, state, zip, filters, hoods, fans, duct_runs")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      type Sug = {
        name: string;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        mgmt_email?: string | null;
        service_type?: string | null;
      };
      const map = new Map<string, Sug>();
      (jobs ?? []).forEach((j) => {
        const key = (j.customer_name || "").trim().toLowerCase();
        if (!key || map.has(key)) return;
        map.set(key, {
          name: j.customer_name,
          email: j.customer_email,
          phone: j.customer_phone,
          address: j.address,
          mgmt_email: j.mgmt_email,
          service_type: j.service_type,
        });
      });
      (intakes ?? []).forEach((i) => {
        const name = (i.business_name || i.contact_name || "").trim();
        const key = name.toLowerCase();
        if (!key || map.has(key)) return;
        const addr = [i.service_address, i.city, i.state, i.zip].filter(Boolean).join(", ");
        map.set(key, { name, email: i.email, phone: i.phone, address: addr });
      });
      return Array.from(map.values());
    },
  });

  const addressSuggestions = useMemo(() => {
    const set = new Set<string>();
    (customerSuggestions ?? []).forEach((c) => c.address && set.add(c.address));
    return Array.from(set);
  }, [customerSuggestions]);

  const emailSuggestions = useMemo(() => {
    const set = new Set<string>();
    (customerSuggestions ?? []).forEach((c) => c.email && set.add(c.email));
    return Array.from(set);
  }, [customerSuggestions]);

  const [openField, setOpenField] = useState<null | "name" | "email" | "address">(null);

  const applyCustomer = async (match: NonNullable<typeof customerSuggestions>[number]) => {
    setForm((f) => ({
      ...f,
      customer_name: match.name,
      customer_email: match.email || f.customer_email,
      customer_phone: match.phone || f.customer_phone,
      address: match.address || f.address,
      mgmt_email: match.mgmt_email || f.mgmt_email,
      service_type: match.service_type || f.service_type,
    }));
    setOpenField(null);
    // Fetch enriched details from server: intake fields + last clean date (incl. Google Calendar)
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`/api/customer-prefill?customer=${encodeURIComponent(match.name)}`, {
        headers: { Authorization: `Bearer ${sess.session?.access_token ?? ""}` },
      });
      if (!res.ok) return;
      const json = await res.json() as {
        intake: any;
        lastCleanDate: string | null;
      };
      setLastCleanDate(json.lastCleanDate);
      const intake = json.intake;
      if (intake) {
        const addr = [intake.service_address, intake.city, intake.state, intake.zip].filter(Boolean).join(", ");
        setForm((f) => ({
          ...f,
          customer_email: f.customer_email || intake.email || "",
          customer_phone: f.customer_phone || intake.phone || "",
          address: f.address || addr,
          mgmt_email: f.mgmt_email || intake.email || "",
        }));
        if (Array.isArray(intake.filters) && intake.filters.length) {
          setFilters(intake.filters.map((x: any) => ({ size: String(x.size ?? ""), qty: String(x.qty ?? "") })));
        }
      }
    } catch (e) {
      console.error("customer-prefill failed", e);
    }
  };

  const updateFilter = (i: number, key: "size" | "qty", value: string) => {
    setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  };
  const addFilterRow = () => setFilters((prev) => [...prev, { size: "", qty: "" }]);
  const removeFilterRow = (i: number) => setFilters((prev) => prev.filter((_, idx) => idx !== i));

  const _legacyApplyShim = () => {};
  void _legacyApplyShim;
  // (the legacy one-shot applyCustomer was replaced above; nothing else to do)

  const filteredByName = useMemo(() => {
    const q = form.customer_name.trim().toLowerCase();
    const list = customerSuggestions ?? [];
    if (!q) return list.slice(0, 8);
    return list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [form.customer_name, customerSuggestions]);

  const filteredByEmail = useMemo(() => {
    const q = form.customer_email.trim().toLowerCase();
    if (!q) return emailSuggestions.slice(0, 8);
    return emailSuggestions.filter((e) => e.toLowerCase().includes(q)).slice(0, 8);
  }, [form.customer_email, emailSuggestions]);

  const filteredByAddress = useMemo(() => {
    const q = form.address.trim().toLowerCase();
    if (!q) return addressSuggestions.slice(0, 8);
    return addressSuggestions.filter((a) => a.toLowerCase().includes(q)).slice(0, 8);
  }, [form.address, addressSuggestions]);


  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_name || !form.address || !form.scheduled_at) {
      toast.error("Please fill name, address, and scheduled time");
      return;
    }
    setSubmitting(true);
    const coords = await geocodeAddress(form.address);
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        customer_name: form.customer_name,
        customer_email: form.customer_email || null,
        customer_phone: form.customer_phone || null,
        address: form.address,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        description: form.description || null,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        assigned_to: form.assigned_to || null,
        mgmt_email: form.mgmt_email || null,
        service_type: form.service_type || null,
        po_number: form.po_number || null,
        filters: filters.filter((f) => f.size || f.qty).length
          ? filters.filter((f) => f.size || f.qty)
          : null,
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
    // Sync to Google Calendar (best-effort)
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch("/api/sync-calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ jobId: data!.id, action: "upsert" }),
      });
      if (!res.ok) toast.warning("Job saved, but calendar sync failed");
    } catch {
      toast.warning("Job saved, but calendar sync failed");
    }
    navigate({ to: "/jobs/$id", params: { id: data!.id } });
  };

  return (
    <AppShell>
      <div className="flex items-center gap-2 mb-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-2xl font-semibold">New job</h1>
      </div>
      <Card className="p-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="customer_name">Customer name *</Label>
            <div className="relative">
              <Input
                id="customer_name"
                autoComplete="off"
                value={form.customer_name}
                onChange={update("customer_name")}
                onFocus={() => setOpenField("name")}
                onBlur={() => setTimeout(() => setOpenField((o) => (o === "name" ? null : o)), 150)}
                required
              />
              {openField === "name" && filteredByName.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                  {filteredByName.map((c) => (
                    <li key={c.name}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyCustomer(c)}
                        className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground"
                      >
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.address && <div className="text-xs text-muted-foreground truncate">{c.address}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {customerSuggestions?.length ? (
              <p className="text-xs text-muted-foreground">
                Pick an existing customer to auto-fill email, phone, and address.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customer_email">Customer email</Label>
              <div className="relative">
                <Input
                  id="customer_email"
                  type="email"
                  autoComplete="off"
                  value={form.customer_email}
                  onChange={update("customer_email")}
                  onFocus={() => setOpenField("email")}
                  onBlur={() => setTimeout(() => setOpenField((o) => (o === "email" ? null : o)), 150)}
                />
                {openField === "email" && filteredByEmail.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                    {filteredByEmail.map((e) => (
                      <li key={e}>
                        <button
                          type="button"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => { setForm((f) => ({ ...f, customer_email: e })); setOpenField(null); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground truncate"
                        >
                          {e}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer_phone">Customer phone</Label>
              <Input id="customer_phone" value={form.customer_phone} onChange={update("customer_phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address *</Label>
            <div className="relative">
              <Input
                id="address"
                autoComplete="off"
                value={form.address}
                onChange={update("address")}
                onFocus={() => setOpenField("address")}
                onBlur={() => setTimeout(() => setOpenField((o) => (o === "address" ? null : o)), 150)}
                required
              />
              {openField === "address" && filteredByAddress.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                  {filteredByAddress.map((a) => (
                    <li key={a}>
                      <button
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => { setForm((f) => ({ ...f, address: a })); setOpenField(null); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground truncate"
                      >
                        {a}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheduled_at">Scheduled time *</Label>
            <Input id="scheduled_at" type="datetime-local" value={form.scheduled_at} onChange={update("scheduled_at")} required />
          </div>
          <div className="space-y-1.5">
            <Label>Service type</Label>
            <Select value={form.service_type} onValueChange={(v) => setForm((f) => ({ ...f, service_type: v }))}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Hood Clean">Hood Clean</SelectItem>
                <SelectItem value="Repair">Repair</SelectItem>
                <SelectItem value="Call Back">Call Back</SelectItem>
                <SelectItem value="Estimate">Estimate</SelectItem>
              </SelectContent>
            </Select>
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
            <Label htmlFor="po_number">PO Number</Label>
            <Input id="po_number" value={form.po_number} onChange={update("po_number")} />
          </div>
          {lastCleanDate && (
            <div className="text-sm text-muted-foreground">
              Last clean on file: <span className="font-medium text-foreground">{lastCleanDate}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Filter sizes &amp; quantities</Label>
            {filters.length === 0 && (
              <p className="text-xs text-muted-foreground">None on file. Add rows below if needed.</p>
            )}
            {filters.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                <Input placeholder="Size (e.g. 20x25)" value={f.size} onChange={(e) => updateFilter(i, "size", e.target.value)} />
                <Input placeholder="Qty" value={f.qty} onChange={(e) => updateFilter(i, "qty", e.target.value)} />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFilterRow(i)}>×</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addFilterRow}>+ Add filter</Button>
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