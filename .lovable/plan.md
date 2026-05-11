I reproduced the report-send failure in the browser.

**Exact error observed**
- I opened a real job, started it, filled/submitted the performance report, returned to the job page, and clicked **Send report**.
- Browser network request: `POST /api/send-report`
- Result: `500`
- Response body: `Failed to send report: Email API error: 400 {"type":"missing_unsubscribe","message":"Transactional emails must include an unsubscribe_token","details":""}`
- Server log confirms the same `missing_unsubscribe` error.

**What this means**
- The current `/api/send-report` route is still sending directly through the low-level email API.
- The email API now requires app emails to include an unsubscribe token.
- This project already has the scaffolded app-email route that handles unsubscribe tokens, suppression checks, logging, and queueing, but the direct job-report route is bypassing that safer path.
- I also checked the backend email pieces: the unsubscribe/log tables exist, but the queue helper function `enqueue_email` is currently missing, so the app-email infrastructure needs to be repaired before switching the report send to it.

**Plan**
1. Re-run the built-in app email infrastructure setup so the missing queue helper is restored safely.
2. Add a proper `service-report` app email template for the hood-cleaning performance report.
3. Register that template in the existing email template registry.
4. Change the job **Send report** flow so it uses the existing app-email route instead of direct email API calls.
5. Preserve the current recipients: customer email, management email, and `service@inspectionclean.com`, with one safe send per recipient.
6. Re-test in the browser by submitting/sending a report again and verifying the failing request is gone or replaced by a successful queued/sent response.

This avoids more guessing: the fix targets the reproduced `missing_unsubscribe` failure and the confirmed missing queue helper.