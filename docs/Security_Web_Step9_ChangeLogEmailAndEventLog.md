# Security Checklist — Step 9: Change Log Email Notification and Event Log Tab

Backend and frontend completed 2026-09-19, through an automatic-send design first, then redesigned to a manually-triggered, scope-selectable Send Mail across five rounds of live user feedback the same day (see workflow.md for the full history). No independent Solution Architect review has been run on this step yet. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` storage account, Azure Communication Services Email (`email-sportspres-assetmgmt`), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Event Log Tab (`GET /api/events/:eventId/log`) requires an authenticated session | Pass | `requireSession` first in the middleware chain. Confirmed live (QA TC-01). |
| A2 | Event Log Tab has no role restriction - open to every signed-in role | Pass, deliberate | Unlike Export/Archive, this is a per-event audit trail, not a destructive or list-level action - a Normal User who can upload assets to an event has an equally legitimate reason to see what changed on it. |
| A3 | Send Mail (`POST /api/events/:eventId/send-change-log-email`) requires an authenticated session, no role restriction | Pass, deliberate | Whoever made the change is the one who should be able to notify others of it - same reasoning as A2. Confirmed live (QA TC-03). |
| A4 | System Settings (`GET/PUT /api/system-settings`) - GET open to every signed-in role, PUT restricted to SuperAdmin/Administrator | Pass | GET must be readable by every role so the Asset Upload page (any role) knows whether to enforce exit-warnings; PUT is a global, app-wide behavior toggle, gated the same way as every other admin-level setting in this app. Role gate not independently exercised from the rejected side this session (QA TC-09) - same recurring gap as every prior step's RBAC testing, no Normal User test account available. |
| A5 | System Settings page is hidden from a Normal User's left nav, not just the API | Pass, as designed | `app.routes.ts`'s `/system-settings` route uses `adminGuard` (same guard as Asset Management Settings/User Management); the nav link in `app-shell.component.html` is behind the same `isAdmin` check. UX-only - the real boundary is A4. |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new network exposure introduced in this step | Pass | No new ports, CORS rules, or CSP changes. Azure Communication Services Email is called server-side only, via its SDK over HTTPS - never exposed to the browser. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Change Log Email content is HTML-escaped before being embedded in the email body | Pass | `escapeHtml()` in `changeLogEmail.js` applied to every field (filename, folder, status, timestamp) before interpolation into the HTML template - a filename containing `<`/`>`/`&`/`"` can't inject markup into the sent email. |
| D2 | The ACS connection string is never logged or returned to a client | Pass | Read once from the `ACS_EMAIL_CONNECTION_STRING` App Service setting into `config.email.connectionString`; used only to construct the `EmailClient` instance server-side. Not included in any API response, error message, or console log. |
| D3 | Change Log Email recipients are fixed by App Service configuration, never client-supplied | Pass | `config.email.recipients` (from the `CHANGE_LOG_EMAIL_RECIPIENT` setting) is the only recipient source `sendChangeLogEmail()` ever uses - the `send-change-log-email` route's request body only ever supplies `scope`, never an address list, so a caller cannot redirect notifications to an arbitrary address. |
| D4 | Force Email Send defaulting to `TRUE` (forced from day one) was an explicit user choice, not an oversight | Pass, deliberate | Confirmed via `AskUserQuestion` before building (see workflow.md's Step 9 kickoff) - the more conservative (nagging-by-default) option was chosen deliberately over a quieter opt-in default. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | Every new/modified query (`system_settings`, `events.email_pending`) uses `mysql2` parameterised placeholders, consistent with the rest of the codebase. |
| E2 | Rate limiting on every new mutating route | Pass | `sendMailLimiter` (30/15min per username) on Send Mail; `settingsUpdateLimiter` (30/15min per username) on `PUT /api/system-settings` - same shape as every other mutating-route limiter in this app. |
| E3 | Send Mail re-derives what to send server-side; never trusts a client-supplied entry list | Pass | The request body only ever supplies `scope` (`"session"`/`"24h"`/`"all"`, validated against a fixed enum, anything else silently falls back to `"all"`) - the actual change-log entries and their content always come from `readChangeLogEntries()`, reading the same storage-backed CSV Section 24 already writes, never from client input. |
| E4 | A failed Change Log Email send is surfaced as an error (502) rather than silently reported as success | Pass | `sendChangeLogEmail()`'s failure is caught, logged server-side, and re-thrown with a client-safe message; `email_pending` is left untouched on failure (see QA TC-08) so a retry remains possible and the UI's "unsent" indicator stays accurate. |
| E5 | The `beforeunload` native browser dialog is the one deliberate exception to this app's no-native-dialogs convention | Pass, documented | There is no custom-UI alternative for an actual browser tab close - every other exit path (in-app navigation, Sign Out) uses a custom modal via the `CanDeactivate` guard instead. Documented inline in `asset-upload.component.ts` and in workflow.md so a future reader doesn't mistake it for an accidental regression of the established convention. |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced in this step's own code beyond the ACS connection string (provisioned and documented in an earlier pass) | Pass | `@azure/communication-email` was already an installed dependency, unused until this step. `npm audit` in `server/` still reports 0 vulnerabilities. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Every change-log entry remains attributable to the user who made the change (Web BRD Section 24, unchanged by this step) | Pass | `username` continues to be populated from `req.user` at write time, not client-supplied - Step 9 only added a `send-change-log-email` *read* of this same data, it didn't change how entries are written. |
| G2 | *Sending* a Change Log Email is not itself attributed to a user (who clicked Send Mail, and when) | Gap, not yet addressed | Unlike Export Event (which records `exportedByUsername`/`exportedByRole` in the exported artifact itself), nothing records who triggered a given Send Mail action or which scope they chose - only that the event's `email_pending` flag was cleared. Flagged here as a deliberate scope note in case the user wants a "sent by / when / scope" audit trail added later; not required by Section 29/30's own text. |
| G3 | System Settings changes are attributable | Pass | `PUT /api/system-settings` records `updated_by` (from the authenticated session) alongside `updated_at` (auto-set by the column's `ON UPDATE CURRENT_TIMESTAMP`). |
