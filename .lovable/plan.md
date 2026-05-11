This is a large multi-part request. Here's how I plan to tackle each item before I start changing files.

## 1. Prefill address & customer info on the job form
The admin "New job" form already has a customer-name autocomplete, but it only fills name / email / phone / address / mgmt_email / service_type. I'll extend that to:
- Pull from the most recent matching `intake_submissions` row for that customer.
- Prefill: full address (street + city + state + zip), customer email, phone, mgmt/contact email, service type, hoods, fans, duct runs, fire suppression, access panels, and filter sizes/quantities (see #5).

## 2. Prefill "last clean date"
- First check `performance_reports` for the most recent `service_date` where business_name matches.
- Fall back to the most recent past `jobs` row for that customer (`scheduled_at`).
- Optionally check Google Calendar via the existing connector for past events whose title matches the customer name. **Question:** the calendar connector authenticates as you (the developer) — that's fine here. I'll pull the most recent past event with a matching customer-name title and use it if it's more recent than the DB results.

## 3. Add "PO number" to the job form
- New `po_number` text column on `jobs`.
- Field on the admin "New job" form.
- Display on job detail page.
- Include in the emailed report PDF.

## 4. Make week view the default schedule
The current schedule is a single chronological list, not a multi-view component. I'll change it to group jobs by day for the **next 7 days** (Mon–Sun of the current week), with a clear header per day, and drop anything before today (see #6). If you wanted a literal calendar grid instead of a grouped agenda, tell me and I'll switch.

## 5. Filter size & quantity on the job page
- New `filters` jsonb column on `jobs` (same shape as intake: `[{size, qty}]`).
- Add an editable filter list section to the job detail page.
- Prefill from the matching intake submission on first view if the job has none yet.

## 6. Hide past jobs from the schedule
- Filter the schedule query to `scheduled_at >= start of today` regardless of status. Past jobs (even incomplete) won't show.
- Admin page keeps full history.

## 7. Cancel job + email service@
- New "Unable to perform job" button on the job detail page.
- Opens a small form: required "Reason for cancellation" textarea.
- On submit: set job status to a new `cancelled` value (extend the `job_status` enum), save the reason in a `cancellation_reason` column, and send an email through the existing app-email queue to `service@inspectionclean.com` with job details + reason.

## 8. Emailed forms must be PDFs with the logo
The existing `/api/send-report` route currently sends the report data inline as HTML. I'll switch it to:
- Generate a branded PDF using the existing `buildSimplePdf` helper (which already renders the logo header).
- Attach the PDF to the queued email.
- This is the same PDF used for #9 (Drive upload).

## 9. Save the report PDF to the customer's Google Drive folder
- After PDF generation, call the existing `drive-upload` helper (the same path used today for notes) to save the PDF into the customer's folder, named like `report-<service-date>.pdf`.

## Database changes (one migration)
- `jobs.po_number text`
- `jobs.filters jsonb`
- `jobs.cancellation_reason text`
- Extend `job_status` enum with `'cancelled'`

## Confirmation needed
- For #4, "week view" = grouped 7-day agenda (Mon–Sun, today onward). OK?
- For #2, do you want me to actually query Google Calendar for last-clean detection, or skip that and rely only on past jobs + performance reports?
- For #7, on cancel should the job stay visible (with a "cancelled" badge) or disappear from your schedule entirely?