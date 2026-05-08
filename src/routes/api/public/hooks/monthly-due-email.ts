import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { render } from "@react-email/components";
import { createClient } from "@supabase/supabase-js";
import { listCustomersDueForMonth } from "@/lib/drive.server";
import { TEMPLATES } from "@/lib/email-templates/registry";

const TEMPLATE_NAME = "customers-due-next-month";
const SITE_NAME = "Inspection Clean";
const SENDER_DOMAIN = "notify.inspectionclean.com";
const FROM_DOMAIN = "inspectionclean.com";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nextMonthDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const Route = createFileRoute("/api/public/hooks/monthly-due-email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Sample/test mode: GET ?month=5&year=2026&to=someone@example.com
        const url = new URL(request.url);
        const monthParam = parseInt(url.searchParams.get("month") || "", 10);
        const yearParam = parseInt(url.searchParams.get("year") || "", 10);
        const toParam = url.searchParams.get("to") || "";
        if (!monthParam || !yearParam || !toParam) {
          return Response.json({ error: "Provide month, year, to" }, { status: 400 });
        }
        const target = new Date(Date.UTC(yearParam, monthParam - 1, 1));
        return await runAndEnqueue(target, toParam);
      },
      POST: async () => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: "Server not configured" }, { status: 500 });
        }
        const target = nextMonthDate();
        return await runAndEnqueue(target, null);
      },
    },
  },
});

async function runAndEnqueue(target: Date, recipientOverride: string | null) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const label = monthLabel(target);

        // 1. Pull the list of customer folders due next month from Drive
        let customersFromDrive: { name: string }[] = [];
        try {
          const r = await listCustomersDueForMonth(target);
          customersFromDrive = r.customers;
        } catch (e) {
          console.error("Drive lookup failed", e);
          return Response.json({ error: "Drive lookup failed" }, { status: 500 });
        }

        // 2. For each folder, find the most recent matching contact info
        //    from performance_reports, then fall back to intake_submissions.
        const customers: { business: string; contact: string; phone: string; email: string }[] = [];
        for (const folder of customersFromDrive) {
          const folderName = folder.name;
          let business = folderName;
          let contact = "";
          let phone = "";
          let email = "";

          // Try performance_reports: folder name typically contains business name
          const { data: reports } = await supabase
            .from("performance_reports")
            .select("business_name,contact_name,phone,email,created_at")
            .order("created_at", { ascending: false })
            .limit(500);
          const matchReport = (reports ?? []).find((r) =>
            folderName.toLowerCase().includes((r.business_name ?? "").toLowerCase()) &&
            (r.business_name ?? "").length > 1,
          );
          if (matchReport) {
            business = matchReport.business_name || folderName;
            contact = matchReport.contact_name || "";
            phone = matchReport.phone || "";
            email = matchReport.email || "";
          }

          if (!contact || !phone || !email) {
            const { data: intakes } = await supabase
              .from("intake_submissions")
              .select("business_name,contact_name,phone,email,created_at")
              .order("created_at", { ascending: false })
              .limit(500);
            const matchIntake = (intakes ?? []).find((r) =>
              folderName.toLowerCase().includes((r.business_name ?? "").toLowerCase()) &&
              (r.business_name ?? "").length > 1,
            );
            if (matchIntake) {
              business = business === folderName ? (matchIntake.business_name || folderName) : business;
              contact = contact || matchIntake.contact_name || "";
              phone = phone || matchIntake.phone || "";
              email = email || matchIntake.email || "";
            }
          }

          customers.push({ business, contact, phone, email });
        }
        customers.sort((a, b) => a.business.localeCompare(b.business));

        // 3. Render template
        const tpl = TEMPLATES[TEMPLATE_NAME];
        if (!tpl) return Response.json({ error: "Template missing" }, { status: 500 });
        const data = { monthLabel: label, customers };
        const element = React.createElement(tpl.component, data);
        const html = await render(element);
        const text = await render(element, { plainText: true });
        const subject = typeof tpl.subject === "function" ? tpl.subject(data) : tpl.subject;

        const recipient = recipientOverride || tpl.to!;
        const messageId = crypto.randomUUID();
        const idempotencyKey = recipientOverride
          ? `monthly-due-sample-${target.getUTCFullYear()}-${target.getUTCMonth() + 1}-${recipient}-${messageId}`
          : `monthly-due-${target.getUTCFullYear()}-${target.getUTCMonth() + 1}`;

        // 4. Get/create unsubscribe token (required by send pipeline)
        let unsubscribeToken: string | null = null;
        const { data: existingToken } = await supabase
          .from("email_unsubscribe_tokens")
          .select("token,used_at")
          .eq("email", recipient.toLowerCase())
          .maybeSingle();
        if (existingToken && !existingToken.used_at) {
          unsubscribeToken = existingToken.token;
        } else if (!existingToken) {
          unsubscribeToken = generateToken();
          await supabase
            .from("email_unsubscribe_tokens")
            .upsert({ token: unsubscribeToken, email: recipient.toLowerCase() }, { onConflict: "email", ignoreDuplicates: true });
          const { data: stored } = await supabase
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", recipient.toLowerCase())
            .maybeSingle();
          unsubscribeToken = stored?.token ?? unsubscribeToken;
        }

        // 5. Log + enqueue
        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: TEMPLATE_NAME,
          recipient_email: recipient,
          status: "pending",
        });

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: recipient,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject,
            html,
            text,
            purpose: "transactional",
            label: TEMPLATE_NAME,
            idempotency_key: idempotencyKey,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          console.error("enqueue failed", enqueueError);
          return Response.json({ error: "enqueue failed" }, { status: 500 });
        }

        return Response.json({ success: true, month: label, count: customers.length });
}
