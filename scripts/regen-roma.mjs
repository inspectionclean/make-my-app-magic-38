import fs from "node:fs";
import { buildSimplePdf } from "../src/lib/pdf.server.ts";

const d = JSON.parse(fs.readFileSync("/tmp/roma.json", "utf8"));

const fmt = (v) => {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const pick = (spec) => spec.map(([k, l]) => [l, fmt(d[k])]).filter(([, v]) => v !== "");
const address = [d.address, [d.city, d.state].filter(Boolean).join(", "), d.zip].map(fmt).filter(Boolean).join("  ");
const customer = pick([["business_name","Business"],["contact_name","Contact"],["phone","Phone"],["email","Email"]]);
if (address) customer.push(["Address", address]);
const sections = [
  { heading: "Customer", rows: customer },
  { heading: "Service", rows: pick([["service_date","Service Date"],["arrival_time","Arrival"],["completion_time","Completion"],["technicians","Technicians"],["service_type","Service Type"],["previous_cleaning_date","Previous Cleaning"]]) },
  { heading: "System Overview", rows: pick([["hoods","Hoods"],["fans","Exhaust Fans"],["duct_runs","Duct Runs"],["fire_suppression","Fire Suppression"],["access_panels","Access Panels"],["roof_access","Roof Access"]]) },
  { heading: "Areas Cleaned", rows: pick([["areas_cleaned","Areas Cleaned"],["other_cleaned","Other"]]) },
  { heading: "Performance Results", rows: pick([["condition_before","Condition Before"],["condition_after","Condition After"],["grease_level","Grease Level"],["airflow_check","Airflow Check"],["fan_check","Fan Check"],["filter_condition","Filter Condition"],["access_panel_condition","Access Panel Condition"]]) },
  { heading: "Findings & Recommendations", paragraphs: [fmt(d.findings), fmt(d.recommendations)].filter(Boolean), rows: pick([["recommendation_items","Recommended Items"],["photos","Photos Taken"]]) },
  { heading: "Sign-Off", rows: pick([["technician_name","Technician"],["technician_signature","Technician Signature"],["customer_rep","Customer Representative"],["customer_signature","Customer Signature"],["signature_date","Signed"]]) },
];

const pdf = await buildSimplePdf({
  title: "Hood Cleaning Performance Report",
  subtitle: `${d.business_name}  •  ${d.service_date}`,
  sections,
  footer: "Inspection Clean  •  service@inspectionclean.com",
});
fs.writeFileSync("/tmp/roma-report.pdf", pdf);
console.log("wrote /tmp/roma-report.pdf", pdf.length);
