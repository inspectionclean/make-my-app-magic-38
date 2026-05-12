## Change

Replace the entire contents of `src/routes/api/import-calendar.ts` with the version you provided. No other files are touched.

## What's new vs. the current file

- **`cleanCustomerName()`** — strips SMS phone tags (`#+18645551234#`), status prefixes (`Confirmed:`, `Pending:`, `MAYBE`), collapses whitespace, trims trailing punctuation.
- **`parseSummary()` now returns an array** — one entry per location. Splits on ` / ` so `"Burger King #10569 / #170 / #5852"` becomes 3 separate jobs, with the brand name re-prepended to bare-`#number` segments.
- **Stable per-location IDs** — first split keeps `ev.id`, additional splits use `ev.id__1`, `ev.id__2`, etc., so dedup against existing `jobs.google_event_id` still works and re-running the import is idempotent.
- **Service-type tag parsing** preserved (`[Hood Clean] ...`).
- Auth, admin gate, gateway pagination window (−30d to +180d), and insert path are unchanged.

## Notes / things to be aware of

- `sync-calendar.ts` writes back to Google using `job.google_event_id` as the event ID. For split jobs after the first, that ID will be `ev.id__1` etc., which Google won't recognize — push-back edits/deletes from those split jobs to Calendar will 404. Import-only flow is fine; if you later want two-way sync on split jobs, we'd need a separate field for "source event id" vs. "synced event id". Out of scope for this change.
- Existing already-imported events keep their original `google_event_id`, so no duplicates will be created on the next import run.

Approve to apply the replacement.