import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "Kitchen Exhaust Cleaning Intake" },
      {
        name: "description",
        content:
          "Submit your kitchen exhaust cleaning intake form to request service.",
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
  website: z
    .string()
    .trim()
    .max(500)
    .url()
    .optional()
    .or(z.literal("")),
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

function IntakePage() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [fireSuppression, setFireSuppression] = useState<string>("");
  const [accessPanels, setAccessPanels] = useState<string>("");
  const [roofAccess, setRoofAccess] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [filters, setFilters] = useState<{ size: string; qty: string }[]>([
    { size: "", qty: "" },
  ]);

  const updateFilter = (i: number, key: "size" | "qty", value: string) =>
    setFilters((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const addFilter = () => setFilters((prev) => [...prev, { size: "", qty: "" }]);
  const removeFilter = (i: number) =>
    setFilters((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const toggleEquipment = (value: string, checked: boolean) => {
    setEquipment((prev) =>
      checked ? [...prev, value] : prev.filter((v) => v !== value)
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries()) as Record<string, string>;

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check your inputs");
      return;
    }

    const numField = (key: string) => {
      const v = raw[key];
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
      last_cleaning: raw.last_cleaning || null,
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
    toast.success("Intake submitted. We'll be in touch shortly.");
  };

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-2xl font-semibold text-foreground">Thank you!</h1>
        <p className="mt-2 text-muted-foreground">
          Your intake form has been received. Our team will reach out shortly.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">
        Kitchen Exhaust Cleaning Intake Form
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium">*</span> Required fields
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-10">
        <Section title="Business Information">
          <Field label="Business Name *" id="business_name">
            <Input id="business_name" name="business_name" required autoComplete="organization" />
          </Field>
          <Field label="Contact Name *" id="contact_name">
            <Input id="contact_name" name="contact_name" required autoComplete="name" />
          </Field>
          <Field label="Title" id="title">
            <Input id="title" name="title" autoComplete="organization-title" />
          </Field>
          <Field label="Phone *" id="phone">
            <Input id="phone" name="phone" type="tel" required autoComplete="tel" />
          </Field>
          <Field label="Text Phone" id="text_phone">
            <Input id="text_phone" name="text_phone" type="tel" autoComplete="tel" />
          </Field>
          <Field label="Email *" id="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Website" id="website">
            <Input id="website" name="website" type="url" autoComplete="url" placeholder="https://" />
          </Field>
          <Field label="Service Address *" id="service_address">
            <Input id="service_address" name="service_address" required autoComplete="street-address" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City *" id="city">
              <Input id="city" name="city" required autoComplete="address-level2" />
            </Field>
            <Field label="State *" id="state">
              <Input id="state" name="state" required autoComplete="address-level1" />
            </Field>
            <Field label="Zip *" id="zip">
              <Input id="zip" name="zip" required autoComplete="postal-code" />
            </Field>
          </div>
        </Section>

        <Section title="Property Details">
          <Field label="Type of Business" id="business_type">
            <Input id="business_type" name="business_type" />
          </Field>
          <Field label="Kitchen Type" id="kitchen_type">
            <Input id="kitchen_type" name="kitchen_type" />
          </Field>
          <Field label="Hours of Operation" id="hours">
            <Input id="hours" name="hours" />
          </Field>
          <Field label="Best Time to Access Site" id="access_time">
            <Input id="access_time" name="access_time" />
          </Field>
          <Field label="On-Site Contact Name" id="onsite_name">
            <Input id="onsite_name" name="onsite_name" />
          </Field>
          <Field label="On-Site Contact Phone" id="onsite_phone">
            <Input id="onsite_phone" name="onsite_phone" type="tel" autoComplete="tel" />
          </Field>
          <Field label="Emergency Contact Name" id="emergency_contact_name">
            <Input id="emergency_contact_name" name="emergency_contact_name" />
          </Field>
          <Field label="Emergency Contact Phone" id="emergency_contact_phone">
            <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" autoComplete="tel" />
          </Field>
        </Section>

        <Section title="System Information">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Number of Hoods" id="hoods">
              <Input id="hoods" name="hoods" type="number" min={0} />
            </Field>
            <Field label="Number of Exhaust Fans" id="fans">
              <Input id="fans" name="fans" type="number" min={0} />
            </Field>
            <Field label="Number of Duct Runs" id="duct_runs">
              <Input id="duct_runs" name="duct_runs" type="number" min={0} />
            </Field>
          </div>
          <Field label="Known Problem Areas" id="problem_areas">
            <Textarea id="problem_areas" name="problem_areas" rows={4} />
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
            <Input id="other_equipment" name="other_equipment" />
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
                  {i === 0 && <Label htmlFor={`filter_qty_${i}`} className="text-xs">Filter qty</Label>}
                  <Input
                    id={`filter_qty_${i}`}
                    type="number"
                    min={0}
                    placeholder="Qty"
                    value={f.qty}
                    onChange={(e) => updateFilter(i, "qty", e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFilter(i)}
                  disabled={filters.length === 1}
                  aria-label="Remove filter size"
                  className={i === 0 ? "self-end" : ""}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addFilter}>
              <Plus className="h-4 w-4 mr-1" />Add another size
            </Button>
          </div>
        </Section>

        <Section title="Service History">
          <Field label="Last Cleaning Date" id="last_cleaning">
            <Input id="last_cleaning" name="last_cleaning" type="date" />
          </Field>
          <Field label="Previous Cleaning Company" id="previous_company">
            <Input id="previous_company" name="previous_company" />
          </Field>
          <Field label="Known Service Issues" id="service_issues">
            <Textarea id="service_issues" name="service_issues" rows={4} />
          </Field>
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
        </Section>

        <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
          {submitting ? "Submitting..." : "Submit Intake"}
        </Button>
      </form>
    </main>
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

function YesNo({
  label,
  value,
  onChange,
  name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  name: string;
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