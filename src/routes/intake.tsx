import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, X, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "Kitchen Exhaust Cleaning Intake" },
      {
        name: "description",
        content: "Submit your kitchen exhaust cleaning intake form to request service.",
      },
    ],
  }),
  component: IntakePage,
});

const EQUIPMENT_OPTIONS = [
  { value: "hood", label: "Hood" },
  { value: "duct", label: "Duct" },
  { value: "exhaust_fan", label: "Exhaust Fan" },
  { value: "grease_cup", label: "Grease Cup / Tray" },
  { value: "filters", label: "Filters" },
  { value: "fire_nozzles", label: "Fire Suppression Nozzles" },
];

const FREQUENCY_OPTIONS = [
  "Monthly",
  "Quarterly",
  "Semi-Annually",
  "Annually",
  "As Needed",
];

const schema = z.object({
  business_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional().or(z.literal("")),
  phone: z.string().trim().min(1).max(50),
  text_phone: z.string().trim().max(50).optional().or(z.literal("")),
  email: z.string().trim().email().max(255),
  website: z.string().trim().max(500).url().optional().or(z.literal("")),
  service_address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  zip: z.string().trim().min(1).max(20),
  business_type: z.string().trim().max(200).optional().or(z.literal("")),
  kitchen_type: z.string().trim().max(200).optional().or(z.literal("")),
  hours: z.string().trim().max(200).optional().or(z.literal("")),
  access_time: z.string().trim().max(200).optional().or(z.literal("")),
  onsite_name: z.string().trim().max(200).optional().or(z.literal("")),
  onsite_phone: z.string().trim().max(50).optional().or(z.literal("")),
  emergency_contact_name: z.string().trim().max(200).optional().or(z.literal("")),
  emergency_contact_phone: z.string().trim().max(50).optional().or(z.literal("")),
  problem_areas: z.string().trim().max(2000).optional().or(z.literal("")),
  other_equipment: z.string().trim().max(300).optional().or(z.literal("")),
  previous_company: z.string().trim().max(200).optional().or(z.literal("")),
  service_issues: z.string().trim().max(2000).optional().or(z.literal("")),
});

// Parse "840 Main St, Greenville SC 29601" into parts
function parseAddress(addr: string): { street: string; city: string; state: string; zip: string } {
  const m = addr.match(/^(.+?),\s*([^,]+?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { street: m[1].trim(), city: m[2].trim(), state: m[3].trim(), zip: m[4].trim() };
  return { street: addr, city: "", state: "", zip: "" };
}

// Strip phone tags and prefixes from calendar-imported job names
function cleanJobName(name: string): string {
  return name
    .replace(/#\+?[\d\s\-().]{7,}#/g, "")
    .replace(/^(confirmed|pending|maybe)\s*:?\s*/i, "")
    .split(/\s*\/\s*/)[0]
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[-–—,:.]+$/, "")
    .trim();
}

type FormState = {
  business_name: string;
  contact_name: string;
  title: string;
  phone: string;
  text_phone: string;
  email: string;
  website: string;
  service_address: string;
  city: string;
  state: string;
  zip: string;
  business_type: string;
  kitchen_type: string;
  hours: string;
  access_time: string;
  onsite_name: string;
  onsite_phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  problem_areas: string;
  other_equipment: string;
  previous_company: string;
  service_issues: string;
  hoods: string;
  fans: string;
  duct_runs: string;
  last_cleaning: string;
};

const EMPTY_FORM: FormState = {
  business_name: "", contact_name: "", title: "", phone: "", text_phone: "",
  email: "", website: "", service_address: "", city: "", state: "", zip: "",
  business_type: "", kitchen_type: "", hours: "", access_time: "",
  onsite_name: "", onsite_phone: "", emergency_contact_name: "",
  emergency_contact_phone: "", problem_areas: "", other_equipment: "",
  previous_company: "", service_issues: "", hoods: "", fans: "",
  duct_runs: "", last_cleaning: "",
};

function IntakePage() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [fireSuppression, setFireSuppression] = useState("");
  const [accessPanels, setAccessPanels] = useState("");
  const [roofAccess, setRoofAccess] = useState("");
  const [frequency, setFrequency] = useState("");
  const [filters, setFilters] = useState<{ size: string; qty: string }[]>([{ size: "", qty: "" }]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Load existing jobs for autofill
  const { data: existingJobs } = useQuery({
    queryKey: ["jobs-for-intake-autofill"],
    enabled: !!user,
    queryFn: async () => {
      const [{ data: jobs }, { data: intakes }] = await Promise.all([
        supabase
          .from("jobs")
          .select("customer_name, customer_email, customer_phone, address, scheduled_at")
          .order("scheduled_at", { ascending: false }),
        supabase
          .from("intake_submissions")
          .select("business_name, contact_name, phone, text_phone, email, service_address, city, state, zip, access_time, hours, frequency, hoods, fans, duct_runs, fire_suppression, access_panels, roof_access, filters, equipment, problem_areas")
          .order("created_at", { ascending: false }),
      ]);

      // Deduplicate by cleaned customer name, prefer most recent
      const map = new Map<string, any>();
      (jobs ?? []).forEach((j) => {
        const clean = cleanJobName(j.customer_name ?? "");
        if (!clean || map.has(clean)) return;
        const parsed = j.address ? parseAddress(j.address) : null;
        map.set(clean, {
          business_name: clean,
          customer_email: j.customer_email ?? "",
          customer_phone: j.customer_phone ?? "",
          address: j.address ?? "",
          parsed,
          source: "job",
        });
      });

      // Also include intake submissions as autofill sources
      (intakes ?? []).forEach((i) => {
        const key = (i.business_name ?? "").trim().toLowerCase();
        if (!key) return;
        // intakes override jobs since they have more detail
        map.set(i.business_name ?? key, {
          business_name: i.business_name,
          customer_email: i.email,
          customer_phone: i.phone,
          text_phone: i.text_phone,
          address: i.service_address,
          city: i.city,
          state: i.state,
          zip: i.zip,
          access_time: i.access_time,
          hours: i.hours,
          frequency: i.frequency,
          hoods: i.hoods,
          fans: i.fans,
          duct_runs: i.duct_runs,
          fire_suppression: i.fire_suppression,
          access_panels: i.access_panels,
          roof_access: i.roof_access,
          filters: i.filters,
          equipment: i.equipment,
          problem_areas: i.problem_areas,
          contact_name: i.contact_name,
          source: "intake",
        });
      });

      return Array.from(map.values());
    },
  });

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return existingJobs?.slice(0, 10) ?? [];
    const q = searchQuery.toLowerCase();
    return (existingJobs ?? [])
      .filter((j) => j.business_name?.toLowerCase().includes(q))
      .slice(0, 10);
  }, [searchQuery, existingJobs]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const applyAutofill = (customer: any) => {
    const parsed = customer.parsed ?? (customer.address ? parseAddress(customer.address) : null);
    setForm((f) => ({
      ...f,
      business_name: customer.business_name ?? f.business_name,
      contact_name: customer.contact_name ?? f.contact_name,
      phone: customer.customer_phone ?? customer.phone ?? f.phone,
      text_phone: customer.text_phone ?? f.text_phone,
      email: customer.customer_email ?? customer.email ?? f.email,
      service_address: customer.address ?? customer.service_address ?? f.service_address,
      city: customer.city ?? parsed?.city ?? f.city,
      state: customer.state ?? parsed?.state ?? f.state,
      zip: customer.zip ?? parsed?.zip ?? f.zip,
      access_time: customer.access_time ?? f.access_time,
      hours: customer.hours ?? f.hours,
      hoods: customer.hoods != null ? String(customer.hoods) : f.hoods,
      fans: customer.fans != null ? String(customer.fans) : f.fans,
      duct_runs: customer.duct_runs != null ? String(customer.duct_runs) : f.duct_runs,
      problem_areas: customer.problem_areas ?? f.problem_areas,
    }));

    // Populate radio/select fields
    if (customer.fire_suppression != null)
      setFireSuppression(customer.fire_suppression ? "yes" : "no");
    if (customer.access_panels != null)
      setAccessPanels(customer.access_panels ? "yes" : "no");
    if (customer.roof_access != null)
      setRoofAccess(customer.roof_access ? "yes" : "no");
    if (customer.frequency)
      setFrequency(customer.frequency);
    if (Array.isArray(customer.equipment) && customer.equipment.length)
      setEquipment(customer.equipment);
    if (Array.isArray(customer.filters) && customer.filters.length)
      setFilters(customer.filters.map((f: any) => ({ size: String(f.size ?? ""), qty: String(f.qty ?? "") })));

    setSearchQuery("");
    setShowSuggestions(false);
    toast.success(`Prefilled from ${customer.source === "intake" ? "previous intake" : "job history"} — review and update as needed`);
  };

  const updateFilter = (i: number, key: "size" | "qty", value: string) =>
    setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const addFilter = () => setFilters((prev) => [...prev, { size: "", qty: "" }]);
  const removeFilter = (i: number) =>
    setFilters((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  const toggleEquipment = (value: string, checked: boolean) =>
    setEquipment((prev) => checked ? [...prev, value] : prev.filter((v) => v !== value));

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries()) as Record<string, string>;

    // Merge controlled form state into raw (controlled inputs don't appear in FormData)
    const merged = { ...raw, ...form };

    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your inputs");
      return;
    }

    const numField = (key: string) => {
      const v = (merged as any)[key];
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    setSubmitting(true);
    const { error } = await supabase.from("intake_submissions").insert({
      ...parsed.data,
      title: parsed.data.title || null,
      text_phone: parsed.data.text_phone || null,
      website: parsed.data.website || null,
      business_type: parsed.data.business_type || null,
      kitchen_type: parsed.data.kitchen_type || null,
      hours: parsed.data.hours || null,
      access_time: parsed.data.access_time || null,
      onsite_name: parsed.data.onsite_name || null,
      onsite_phone: parsed.data.onsite_phone || null,
      emergency_contact_name: parsed.data.emergency_contact_name || null,
      emergency_contact_phone: parsed.data.emergency_contact_phone || null,
      problem_areas: parsed.data.problem_areas || null,
      other_equipment: parsed.data.other_equipment || null,
      previous_company: parsed.data.previous_company || null,
      service_issues: parsed.data.service_issues || null,
      hoods: numField("hoods"),
      fans: numField("fans"),
      duct_runs: numField("duct_runs"),
      fire_suppression: fireSuppression ? fireSuppression === "yes" : null,
      access_panels: accessPanels ? accessPanels === "yes" : null,
      roof_access: roofAccess ? roofAccess === "yes" : null,
      equipment: equipment.length ? equipment : null,
      last_cleaning: (merged as any).last_cleaning || null,
      frequency: frequency || null,
      filters: (() => {
        const cleaned = filters
          .map((f) => ({ size: f.size.trim(), qty: f.qty.trim() }))
          .filter((f) => f.size || f.qty);
        return cleaned.length ? cleaned : null;
      })(),
    });
    setSubmitting(false);

    if (error) {
      toast.error("Could not submit form. Please try again.");
      return;
    }

    // Upload to Drive
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      void fetch("/api/drive-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          kind: "intake",
          customerName: parsed.data.business_name,
          data: parsed.data,
          baseName: `intake-${new Date().toISOString().slice(0, 10)}`,
        }),
      }).catch(() => {});
    } catch {}

    setSubmitted(true);
    toast.success("Intake submitted successfully.");
  };

  if (submitted) {
    return (
      <AppShell>
        <main className="mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-2xl font-semibold text-foreground">Submitted!</h1>
          <p className="mt-2 text-muted-foreground">Intake form saved successfully.</p>
          <Button className="mt-6" onClick={() => { setSubmitted(false); setForm(EMPTY_FORM); setEquipment([]); setFireSuppression(""); setAccessPanels(""); setRoofAccess(""); setFrequency(""); setFilters([{ size: "", qty: "" }]); }}>
            Add another customer
          </Button>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-foreground">
          Customer Intake Form
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium">*</span> Required fields
        </p>

        {/* ── Autofill search ── */}
        {user && (
          <div className="mt-6 p-4 rounded-lg border border-dashed border-border bg-muted/30" ref={searchRef}>
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Search className="h-4 w-4" />
              Autofill from existing customer
            </p>
            <div className="relative">
              <Input
                placeholder="Search by customer name…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                  {suggestions.map((c) => (
                    <li key={c.business_name}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyAutofill(c)}
                        className="w-full text-left px-3 py-2.5 hover:bg-accent hover:text-accent-foreground border-b last:border-0"
                      >
                        <div className="font-medium text-sm">{c.business_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.address || c.service_address || "No address on file"}
                          {c.source === "intake" && " · has intake"}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Select a customer to prefill address, phone, and other details. Review and update before submitting.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-10">
          <Section title="Business Information">
            <Field label="Business Name *" id="business_name">
              <Input
                id="business_name" name="business_name" required
                autoComplete="organization"
                value={form.business_name}
                onChange={setField("business_name")}
              />
            </Field>
            <Field label="Contact Name *" id="contact_name">
              <Input
                id="contact_name" name="contact_name" required
                autoComplete="name"
                value={form.contact_name}
                onChange={setField("contact_name")}
              />
            </Field>
            <Field label="Title" id="title">
              <Input
                id="title" name="title"
                autoComplete="organization-title"
                value={form.title}
                onChange={setField("title")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone *" id="phone">
                <Input
                  id="phone" name="phone" type="tel" required
                  autoComplete="tel"
                  value={form.phone}
                  onChange={setField("phone")}
                />
              </Field>
              <Field label="Text Phone (for SMS reminders)" id="text_phone">
                <Input
                  id="text_phone" name="text_phone" type="tel"
                  autoComplete="tel"
                  value={form.text_phone}
                  onChange={setField("text_phone")}
                  placeholder="If different from main phone"
                />
              </Field>
            </div>
            <Field label="Email *" id="email">
              <Input
                id="email" name="email" type="email" required
                autoComplete="email"
                value={form.email}
                onChange={setField("email")}
              />
            </Field>
            <Field label="Service Address *" id="service_address">
              <Input
                id="service_address" name="service_address" required
                autoComplete="street-address"
                value={form.service_address}
                onChange={setField("service_address")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City *" id="city">
                <Input
                  id="city" name="city" required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={setField("city")}
                />
              </Field>
              <Field label="State *" id="state">
                <Input
                  id="state" name="state" required
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={setField("state")}
                />
              </Field>
              <Field label="Zip *" id="zip">
                <Input
                  id="zip" name="zip" required
                  autoComplete="postal-code"
                  value={form.zip}
                  onChange={setField("zip")}
                />
              </Field>
            </div>
          </Section>

          <Section title="Property Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hours of Operation" id="hours">
                <Input id="hours" name="hours" value={form.hours} onChange={setField("hours")} placeholder="e.g. Mon–Fri 7am–10pm" />
              </Field>
              <Field label="Best Time to Access Site" id="access_time">
                <Input id="access_time" name="access_time" value={form.access_time} onChange={setField("access_time")} placeholder="e.g. After 11pm" />
              </Field>
            </div>
            <Field label="On-Site Contact Name" id="onsite_name">
              <Input id="onsite_name" name="onsite_name" value={form.onsite_name} onChange={setField("onsite_name")} />
            </Field>
            <Field label="On-Site Contact Phone" id="onsite_phone">
              <Input id="onsite_phone" name="onsite_phone" type="tel" value={form.onsite_phone} onChange={setField("onsite_phone")} />
            </Field>
            <Field label="Emergency Contact Name" id="emergency_contact_name">
              <Input id="emergency_contact_name" name="emergency_contact_name" value={form.emergency_contact_name} onChange={setField("emergency_contact_name")} />
            </Field>
            <Field label="Emergency Contact Phone" id="emergency_contact_phone">
              <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" value={form.emergency_contact_phone} onChange={setField("emergency_contact_phone")} />
            </Field>
          </Section>

          <Section title="System Information">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Number of Hoods" id="hoods">
                <Input id="hoods" name="hoods" type="number" min={0} value={form.hoods} onChange={setField("hoods")} />
              </Field>
              <Field label="Number of Exhaust Fans" id="fans">
                <Input id="fans" name="fans" type="number" min={0} value={form.fans} onChange={setField("fans")} />
              </Field>
              <Field label="Number of Duct Runs" id="duct_runs">
                <Input id="duct_runs" name="duct_runs" type="number" min={0} value={form.duct_runs} onChange={setField("duct_runs")} />
              </Field>
            </div>
            <Field label="Known Problem Areas" id="problem_areas">
              <Textarea id="problem_areas" name="problem_areas" rows={3} value={form.problem_areas} onChange={setField("problem_areas")} />
            </Field>
            <YesNo label="Fire Suppression System Present?" value={fireSuppression} onChange={setFireSuppression} name="fire_suppression" />
            <YesNo label="Access Panels Present?" value={accessPanels} onChange={setAccessPanels} name="access_panels" />
            <YesNo label="Roof Access Available?" value={roofAccess} onChange={setRoofAccess} name="roof_access" />
          </Section>

          <Section title="Equipment List">
            <div className="grid gap-3 sm:grid-cols-2">
              {EQUIPMENT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={equipment.includes(opt.value)}
                    onCheckedChange={(c) => toggleEquipment(opt.value, Boolean(c))}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <Field label="Other" id="other_equipment">
              <Input id="other_equipment" name="other_equipment" value={form.other_equipment} onChange={setField("other_equipment")} />
            </Field>
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Filter Sizes</p>
              {filters.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-end sm:grid-cols-[1fr_140px_auto]">
                  <div className="space-y-1">
                    {i === 0 && <Label htmlFor={`filter_size_${i}`} className="text-xs">Filter size</Label>}
                    <Input
                      id={`filter_size_${i}`}
                      placeholder='e.g. 20" x 20"'
                      value={f.size}
                      onChange={(e) => updateFilter(i, "size", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label htmlFor={`filter_qty_${i}`} className="text-xs">Qty</Label>}
                    <Input
                      id={`filter_qty_${i}`}
                      type="number" min={0} placeholder="Qty"
                      value={f.qty}
                      onChange={(e) => updateFilter(i, "qty", e.target.value)}
                    />
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon"
                    onClick={() => removeFilter(i)}
                    disabled={filters.length === 1}
                    className={i === 0 ? "self-end" : ""}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addFilter}>
                <Plus className="h-4 w-4 mr-1" /> Add another size
              </Button>
            </div>
          </Section>

          <Section title="Service Preferences">
            <Field label="Preferred Cleaning Frequency" id="frequency">
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="frequency">
                  <SelectValue placeholder="Select one" />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Last Cleaning Date" id="last_cleaning">
              <Input id="last_cleaning" name="last_cleaning" type="date" value={form.last_cleaning} onChange={setField("last_cleaning")} />
            </Field>
            <Field label="Known Service Issues / Notes" id="service_issues">
              <Textarea id="service_issues" name="service_issues" rows={3} value={form.service_issues} onChange={setField("service_issues")} />
            </Field>
          </Section>

          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Submitting..." : "Submit Intake"}
          </Button>
        </form>
      </main>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-6">
      <legend className="px-2 text-sm font-semibold text-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function YesNo({ label, value, onChange, name }: {
  label: string; value: string; onChange: (v: string) => void; name: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="yes" id={`${name}_yes`} /> Yes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="no" id={`${name}_no`} /> No
        </label>
      </RadioGroup>
    </div>
  );
}
