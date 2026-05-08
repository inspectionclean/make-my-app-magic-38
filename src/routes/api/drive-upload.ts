import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOrCreateCustomerFolder, uploadFile } from "@/lib/drive.server";
import { buildSimplePdf, type PdfSection } from "@/lib/pdf.server";

export const Route = createFileRoute("/api/drive-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          kind: "intake" | "report" | "note";
          customerName: string;
          data: Record<string, unknown>;
          baseName?: string;
        };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!body?.customerName || !body?.kind || !body?.data) {
          return new Response("Missing fields", { status: 400 });
        }

        // Intake forms are public; everything else requires an authenticated user
        if (body.kind !== "intake") {
          const auth = request.headers.get("authorization");
          if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
          const token = auth.slice(7);
          const { data: claims } = await supabaseAdmin.auth.getClaims(token);
          if (!claims?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        }

        try {
          const folderId = await getOrCreateCustomerFolder(body.customerName);
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const base = body.baseName?.trim() || `${body.kind}-${ts}`;

          const sections = sectionsFor(body.kind, body.data);
          const pdfBytes = await buildSimplePdf({
            title: titleFor(body.kind, body.data),
            subtitle: subtitleFor(body.kind, body.data),
            sections,
            footer: "Inspection Clean  •  service@inspectionclean.com",
          });

          await uploadFile({
            folderId,
            name: `${base}.pdf`,
            mimeType: "application/pdf",
            content: pdfBytes,
          });
          await uploadFile({
            folderId,
            name: `${base}.json`,
            mimeType: "application/json",
            content: JSON.stringify(body.data, null, 2),
          });
          // Also upload note as plain text so "previous notes" can show inline
          if (body.kind === "note" && typeof body.data.body === "string") {
            await uploadFile({
              folderId,
              name: `${base}.txt`,
              mimeType: "text/plain",
              content: String(body.data.body),
            });
          }
          return Response.json({ ok: true });
        } catch (e: any) {
          return new Response(`Drive upload failed: ${e.message}`, { status: 500 });
        }
      },
    },
  },
});

function titleFor(kind: string, d: Record<string, unknown>) {
  if (kind === "intake") return "Customer Intake Form";
  if (kind === "report") return "Hood Cleaning Performance Report";
  if (kind === "note") return "Job Note";
  return "Form";
}

function subtitleFor(kind: string, d: Record<string, unknown>): string {
  const name = (d.business_name as string) || (d.customerName as string) || "";
  const date =
    (d.service_date as string) ||
    (d.signature_date as string) ||
    new Date().toLocaleDateString();
  return [name, date].filter(Boolean).join("  •  ");
}

const fmt = (v: unknown): string => {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const pickRows = (
  d: Record<string, unknown>,
  spec: [string, string][],
): [string, string][] =>
  spec.map(([k, label]) => [label, fmt(d[k])] as [string, string]).filter(([, v]) => v !== "");

function sectionsFor(kind: string, d: Record<string, unknown>): PdfSection[] {
  if (kind === "report") return reportSections(d);
  if (kind === "intake") return intakeSections(d);
  if (kind === "note") return noteSections(d);
  return [{ heading: "Details", rows: genericRows(d) }];
}

function reportSections(d: Record<string, unknown>): PdfSection[] {
  const address = [d.address, [d.city, d.state].filter(Boolean).join(", "), d.zip]
    .map((x) => fmt(x)).filter(Boolean).join("  ");
  const customer = pickRows(d, [
    ["business_name", "Business"],
    ["contact_name", "Contact"],
    ["phone", "Phone"],
    ["email", "Email"],
  ]);
  if (address) customer.push(["Address", address]);

  const service = pickRows(d, [
    ["service_date", "Service Date"],
    ["arrival_time", "Arrival"],
    ["completion_time", "Completion"],
    ["technicians", "Technicians"],
    ["service_type", "Service Type"],
    ["previous_cleaning_date", "Previous Cleaning"],
  ]);

  const system = pickRows(d, [
    ["hoods", "Hoods"],
    ["fans", "Exhaust Fans"],
    ["duct_runs", "Duct Runs"],
    ["fire_suppression", "Fire Suppression"],
    ["access_panels", "Access Panels"],
    ["roof_access", "Roof Access"],
  ]);

  const areas = pickRows(d, [
    ["areas_cleaned", "Areas Cleaned"],
    ["other_cleaned", "Other"],
  ]);

  const results = pickRows(d, [
    ["condition_before", "Condition Before"],
    ["condition_after", "Condition After"],
    ["grease_level", "Grease Level"],
    ["airflow_check", "Airflow Check"],
    ["fan_check", "Fan Check"],
    ["filter_condition", "Filter Condition"],
    ["access_panel_condition", "Access Panel Condition"],
  ]);

  const findings = pickRows(d, [
    ["recommendation_items", "Recommended Items"],
    ["photos", "Photos Taken"],
  ]);
  const findingParas = [fmt(d.findings), fmt(d.recommendations)].filter(Boolean);

  const signoff = pickRows(d, [
    ["technician_name", "Technician"],
    ["technician_signature", "Technician Signature"],
    ["customer_rep", "Customer Representative"],
    ["customer_signature", "Customer Signature"],
    ["signature_date", "Signed"],
  ]);

  return [
    { heading: "Customer", rows: customer },
    { heading: "Service", rows: service },
    { heading: "System Overview", rows: system },
    { heading: "Areas Cleaned", rows: areas },
    { heading: "Performance Results", rows: results },
    { heading: "Findings & Recommendations", paragraphs: findingParas, rows: findings },
    { heading: "Sign-Off", rows: signoff },
  ];
}

function intakeSections(d: Record<string, unknown>): PdfSection[] {
  const address = [d.service_address, [d.city, d.state].filter(Boolean).join(", "), d.zip]
    .map((x) => fmt(x)).filter(Boolean).join("  ");
  const business = pickRows(d, [
    ["business_name", "Business"],
    ["business_type", "Business Type"],
    ["kitchen_type", "Kitchen Type"],
    ["website", "Website"],
    ["hours", "Hours"],
  ]);
  if (address) business.push(["Address", address]);

  const contacts = pickRows(d, [
    ["contact_name", "Primary Contact"],
    ["title", "Title"],
    ["phone", "Phone"],
    ["text_phone", "Text"],
    ["email", "Email"],
    ["onsite_name", "On-site Contact"],
    ["onsite_phone", "On-site Phone"],
    ["emergency_contact_name", "Emergency Contact"],
    ["emergency_contact_phone", "Emergency Phone"],
    ["access_time", "Access Time"],
  ]);

  const system = pickRows(d, [
    ["hoods", "Hoods"],
    ["fans", "Exhaust Fans"],
    ["duct_runs", "Duct Runs"],
    ["fire_suppression", "Fire Suppression"],
    ["access_panels", "Access Panels"],
    ["roof_access", "Roof Access"],
    ["equipment", "Equipment"],
    ["other_equipment", "Other Equipment"],
    ["filters", "Filters"],
  ]);

  const history = pickRows(d, [
    ["previous_company", "Previous Company"],
    ["last_cleaning", "Last Cleaning"],
    ["frequency", "Cleaning Frequency"],
  ]);
  const notes = [fmt(d.problem_areas), fmt(d.service_issues)].filter(Boolean);

  return [
    { heading: "Business", rows: business },
    { heading: "Contacts", rows: contacts },
    { heading: "System & Equipment", rows: system },
    { heading: "Service History", rows: history },
    { heading: "Notes", paragraphs: notes },
  ];
}

function noteSections(d: Record<string, unknown>): PdfSection[] {
  const meta = pickRows(d, [
    ["author", "Author"],
    ["created_at", "Date"],
  ]);
  return [
    { heading: "Note", rows: meta, paragraphs: [fmt(d.body)].filter(Boolean) },
  ];
}

function genericRows(d: Record<string, unknown>): [string, string][] {
  return Object.entries(d)
    .map(([k, v]) => [k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), fmt(v)] as [string, string])
    .filter(([, v]) => v !== "");
}