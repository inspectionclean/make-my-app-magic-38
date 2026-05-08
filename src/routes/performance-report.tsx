import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/performance-report")({
  head: () => ({
    meta: [
      { title: "Hood Cleaning Performance Report" },
      {
        name: "description",
        content: "Submit a hood cleaning performance report.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    jobId: typeof search.jobId === "string" ? search.jobId : undefined,
  }),
  component: PerformanceReportPage,
});

const AREAS = [
  ["hood_interior", "Hood Interior"],
  ["hood_exterior", "Hood Exterior"],
  ["filters", "Filters"],
  ["plenum", "Plenum"],
  ["ductwork", "Ductwork"],
  ["exhaust_fan", "Exhaust Fan"],
  ["grease_trays", "Grease Cups / Trays"],
  ["fire_nozzles", "Fire Suppression Nozzles"],
  ["light_fixtures", "Light Fixtures"],
] as const;

const RECOMMENDATIONS = [
  ["next_cleaning", "Schedule next cleaning on time"],
  ["repair_panels", "Repair access panels"],
  ["replace_filters", "Replace damaged filters"],
  ["service_fan", "Service exhaust fan"],
  ["inspect_suppression", "Inspect fire suppression system"],
] as const;

const PHOTO_OPTS = [
  ["before", "Before Photos Taken"],
  ["after", "After Photos Taken"],
  ["deficiency", "Deficiency Photos Taken"],
] as const;

const schema = z.object({
  business_name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  zip: z.string().trim().min(1).max(20),
  contact_name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
});

function PerformanceReportPage() {
  const { user, loading } = useAuth();
  const { jobId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [recItems, setRecItems] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [fireSuppression, setFireSuppression] = useState("");
  const [accessPanels, setAccessPanels] = useState("");
  const [roofAccess, setRoofAccess] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [greaseLevel, setGreaseLevel] = useState("");
  const [airflowCheck, setAirflowCheck] = useState("");
  const [fanCheck, setFanCheck] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [accessPanelCondition, setAccessPanelCondition] = useState("");

  if (loading) return null;
  if (!user) return <Navigate to="/login" />;

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
    checked: boolean
  ) => {
    setter((prev) => (checked ? [...prev, value] : prev.filter((v) => v !== value)));
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

    const num = (k: string) => {
      const v = raw[k];
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const txt = (k: string) => (raw[k]?.trim() ? raw[k].trim() : null);

    setSubmitting(true);
    const { error } = await supabase.from("performance_reports").insert({
      submitted_by: user.id,
      job_id: jobId ?? null,
      business_name: parsed.data.business_name,
      address: parsed.data.address,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      contact_name: parsed.data.contact_name,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      service_date: raw.service_date,
      arrival_time: txt("arrival_time"),
      completion_time: txt("completion_time"),
      technicians: txt("technicians"),
      previous_cleaning_date: raw.previous_cleaning_date || null,
      service_type: serviceType || null,
      hoods: num("hoods"),
      fans: num("fans"),
      duct_runs: num("duct_runs"),
      fire_suppression: fireSuppression ? fireSuppression === "yes" : null,
      access_panels: accessPanels ? accessPanels === "yes" : null,
      roof_access: roofAccess ? roofAccess === "yes" : null,
      areas_cleaned: areas.length ? areas : null,
      other_cleaned: txt("other_cleaned"),
      condition_before: txt("condition_before"),
      condition_after: txt("condition_after"),
      grease_level: greaseLevel || null,
      airflow_check: airflowCheck || null,
      fan_check: fanCheck || null,
      filter_condition: filterCondition || null,
      access_panel_condition: accessPanelCondition || null,
      findings: txt("findings"),
      recommendations: txt("recommendations"),
      recommendation_items: recItems.length ? recItems : null,
      photos: photos.length ? photos : null,
      technician_name: txt("technician_name"),
      technician_signature: txt("technician_signature"),
      customer_rep: txt("customer_rep"),
      customer_signature: txt("customer_signature"),
      signature_date: raw.signature_date,
    });
    setSubmitting(false);

    if (error) {
      toast.error("Could not submit report. Please try again.");
      return;
    }
    setSubmitted(true);
    toast.success("Performance report submitted.");
    if (jobId) {
      setTimeout(() => navigate({ to: "/jobs/$id", params: { id: jobId } }), 800);
    }
  };

  if (submitted) {
    return (
      <AppShell>
        <main className="mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-2xl font-semibold text-foreground">Report submitted</h1>
          <p className="mt-2 text-muted-foreground">Thanks — your performance report has been recorded.</p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-foreground">
          Hood Cleaning Performance Report
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium">*</span> Required fields
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-10">
          <Section title="Customer Information">
            <Field label="Business Name *" id="business_name">
              <Input id="business_name" name="business_name" required autoComplete="organization" />
            </Field>
            <Field label="Address *" id="address">
              <Input id="address" name="address" required autoComplete="street-address" />
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
            <Field label="Contact Name *" id="contact_name">
              <Input id="contact_name" name="contact_name" required autoComplete="name" />
            </Field>
            <Field label="Phone *" id="phone">
              <Input id="phone" name="phone" type="tel" required autoComplete="tel" />
            </Field>
            <Field label="Email" id="email">
              <Input id="email" name="email" type="email" autoComplete="email" />
            </Field>
          </Section>

          <Section title="Service Information">
            <Field label="Service Date *" id="service_date">
              <Input id="service_date" name="service_date" type="date" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Arrival Time" id="arrival_time">
                <Input id="arrival_time" name="arrival_time" type="time" />
              </Field>
              <Field label="Completion Time" id="completion_time">
                <Input id="completion_time" name="completion_time" type="time" />
              </Field>
            </div>
            <Field label="Technicians" id="technicians">
              <Input id="technicians" name="technicians" />
            </Field>
            <Field label="Previous Cleaning Date" id="previous_cleaning_date">
              <Input id="previous_cleaning_date" name="previous_cleaning_date" type="date" />
            </Field>
            <Field label="Service Type" id="service_type">
              <SimpleSelect
                value={serviceType}
                onChange={setServiceType}
                placeholder="Select one"
                options={[
                  ["one-time", "One-Time"],
                  ["monthly", "Monthly"],
                  ["quarterly", "Quarterly"],
                  ["semi-annual", "Semi-Annual"],
                  ["annual", "Annual"],
                ]}
              />
            </Field>
          </Section>

          <Section title="System Details">
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
            <YesNo label="Fire Suppression System?" value={fireSuppression} onChange={setFireSuppression} name="fire_suppression" />
            <YesNo label="Access Panels Present?" value={accessPanels} onChange={setAccessPanels} name="access_panels" />
            <YesNo label="Roof Access?" value={roofAccess} onChange={setRoofAccess} name="roof_access" />
          </Section>

          <Section title="Areas Cleaned">
            <CheckboxGrid options={AREAS} selected={areas} onToggle={(v, c) => toggle(setAreas, v, c)} />
            <Field label="Other" id="other_cleaned">
              <Input id="other_cleaned" name="other_cleaned" />
            </Field>
          </Section>

          <Section title="Performance Results">
            <Field label="Condition Before Cleaning" id="condition_before">
              <Textarea id="condition_before" name="condition_before" rows={3} />
            </Field>
            <Field label="Condition After Cleaning" id="condition_after">
              <Textarea id="condition_after" name="condition_after" rows={3} />
            </Field>
            <Field label="Grease Buildup Level" id="grease_level">
              <SimpleSelect
                value={greaseLevel}
                onChange={setGreaseLevel}
                placeholder="Select one"
                options={[["light", "Light"], ["moderate", "Moderate"], ["heavy", "Heavy"]]}
              />
            </Field>
            <Field label="Airflow Check After Service" id="airflow_check">
              <SimpleSelect
                value={airflowCheck}
                onChange={setAirflowCheck}
                placeholder="Select one"
                options={[["pass", "Pass"], ["needs_attention", "Needs Attention"]]}
              />
            </Field>
            <Field label="Fan Operation Check" id="fan_check">
              <SimpleSelect
                value={fanCheck}
                onChange={setFanCheck}
                placeholder="Select one"
                options={[["pass", "Pass"], ["needs_attention", "Needs Attention"]]}
              />
            </Field>
            <Field label="Filter Condition" id="filter_condition">
              <SimpleSelect
                value={filterCondition}
                onChange={setFilterCondition}
                placeholder="Select one"
                options={[["good", "Good"], ["damaged", "Damaged"], ["needs_replacement", "Needs Replacement"]]}
              />
            </Field>
            <Field label="Access Panel Condition" id="access_panel_condition">
              <SimpleSelect
                value={accessPanelCondition}
                onChange={setAccessPanelCondition}
                placeholder="Select one"
                options={[["good", "Good"], ["damaged", "Damaged"], ["missing", "Missing"]]}
              />
            </Field>
          </Section>

          <Section title="Findings and Recommendations">
            <Field label="Findings / Deficiencies" id="findings">
              <Textarea id="findings" name="findings" rows={4} />
            </Field>
            <Field label="Recommendations" id="recommendations">
              <Textarea id="recommendations" name="recommendations" rows={4} />
            </Field>
            <CheckboxGrid options={RECOMMENDATIONS} selected={recItems} onToggle={(v, c) => toggle(setRecItems, v, c)} />
          </Section>

          <Section title="Photo Documentation">
            <CheckboxGrid options={PHOTO_OPTS} selected={photos} onToggle={(v, c) => toggle(setPhotos, v, c)} />
          </Section>

          <Section title="Service Verification">
            <Field label="Technician Name" id="technician_name">
              <Input id="technician_name" name="technician_name" autoComplete="name" />
            </Field>
            <Field label="Technician Signature" id="technician_signature">
              <Input id="technician_signature" name="technician_signature" />
            </Field>
            <Field label="Customer Representative" id="customer_rep">
              <Input id="customer_rep" name="customer_rep" autoComplete="name" />
            </Field>
            <Field label="Customer Signature" id="customer_signature">
              <Input id="customer_signature" name="customer_signature" />
            </Field>
            <Field label="Date *" id="signature_date">
              <Input id="signature_date" name="signature_date" type="date" required />
            </Field>
          </Section>

          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Submitting..." : "Submit Report"}
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

function CheckboxGrid({
  options,
  selected,
  onToggle,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  selected: string[];
  onToggle: (value: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selected.includes(value)}
            onCheckedChange={(c) => onToggle(value, Boolean(c))}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function SimpleSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}