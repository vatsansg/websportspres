# Security Checklist — Step 7: Export Functionality

Backend and frontend completed 2026-09-18. No independent Solution Architect review has been run on this step yet. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` (`2027` container), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Export Event (`POST /api/events/:eventId/export`) requires an authenticated session | Pass | `requireSession` first in the middleware chain. Confirmed live (QA TC-01). |
| A2 | Export Event restricted to SuperAdmin/Administrator (Web BRD Section 25.3) | Pass | `requireRole("SuperAdmin", "Administrator")`, same helper already used by every other role-gated route in this app. Not live-tested from the rejected (Normal User) side this session — no such test account available (same limitation as Step 5's User Management testing). |
| A3 | The Export Event UI affordance is hidden entirely for a Normal User, not just disabled (Section 25.1's literal "must not be presented" wording) | Pass, as designed | `dashboard.component.html` wraps the button in `@if (canExport)`. The real access boundary is server-side (A2) - this is UX-only, same pattern as every other role-gated button in this app (documented explicitly in `auth.guard.ts`'s `adminGuard` comment for the analogous case). |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. `_GUID.json`'s consumer (the downstream LED Asset Download and Synchronisation Application) is out of scope here - see Web BRD Section 25.6's own text for how that application is expected to use this file. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new network exposure introduced in this step | Pass | No new ports, CORS rules, or CSP changes. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | The exported JSON contains no secrets or credentials | Pass | Field set is exactly Section 25.4's list (event ID/name/storage URL, table LED config, who/when exported, the GUID itself) — no connection strings, keys, or session tokens. `eventStorageUrl` is a public-shaped HTTPS URL to the container/folder, not a SAS token or access key — actual read access to that folder still requires the caller's own Managed Identity/AAD credentials, this URL alone grants nothing. |
| D2 | The ExportGUID is persisted to the database *before* the storage write is attempted, so a partial failure can't leave the DB and a stale/missing `_GUID.json` silently disagreeing forever | Pass | `UPDATE events SET export_guid = ?` runs first; if `writeExportGuidFile()` then fails, the error is surfaced as a 500 telling the caller to retry the export (which will generate a fresh GUID and try the storage write again) rather than silently reporting success with an inconsistent state. Not fault-injection-tested (e.g. simulating a storage outage mid-write) this session. |
| D3 | `_GUID.json`, like the change log, is correctly excluded from Step 5's "would this destroy real files" confirmation-flow check | Pass | Added to `listRealFiles()`'s exclusion list (basename match, same treatment as `_ledassetschangelog.csv`) — an event rename won't falsely warn about losing `_GUID.json` (it's app-generated metadata that moves with the rename anyway, not a real user-uploaded asset). See QA TC-08. |
| D4 | `_GUID.json` moves correctly on an event rename (ID/Name/Year), same as every other blob in the event's folder | Pass, by construction | `renameEventStorage()` (Step 5) copies every blob under the event's prefix indiscriminately - `_GUID.json` is not special-cased and therefore automatically included, same guarantee as the change log. Not independently re-exercised live this session as its own scenario (would require exporting, then renaming, then re-checking) — the underlying copy-everything-under-the-prefix mechanism was already live-verified in Step 5's own rename testing for other files. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | The new query (`UPDATE events SET export_guid = ? WHERE event_id = ?`) is parameterised via `mysql2` placeholders, consistent with every other query in the codebase. |
| E2 | ExportGUID is generated using a cryptographically-suitable random source | Pass | `node:crypto`'s `randomUUID()` (RFC 4122 v4 UUID, backed by the platform CSPRNG) — not `Math.random()` or any other non-cryptographic source. No new npm dependency needed. |
| E3 | Rate limiting on the export route | Pass | `eventExportLimiter` (30/15min per username), same shape as `eventEditLimiter`/`userMutationLimiter` from Step 5. |
| E4 | Error messages returned to the client do not leak internal details | Pass | Reuses the existing `errorHandler.js` pattern; the one export-specific error message ("the export GUID was recorded, but writing _GUID.json to storage failed") is informative to the caller without exposing storage account names, connection details, or stack traces. |
| E5 | The exported field names/casing exactly match the downstream consumer's expectation, not this codebase's usual convention | Pass, deliberate | `eventId`/`eventName`/`eventStorageUrl`/`tables[].tableNumber`/`innerLed`/`outerLed`/`mainLed`/`exportedByUsername`/`exportedByRole`/`exportTimestamp`/`exportGuid` — verified against Web BRD Section 25.4's literal field list, not translated into snake_case or otherwise "normalized," since a non-JS downstream application parses this file literally. |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced; no new npm dependencies | Pass | `node:crypto` is a Node.js built-in. `npm audit` in `server/` still reports 0 vulnerabilities. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Every export is attributable to a user | Pass | `exportedByUsername`/`exportedByRole` are populated from `req.user`, the authenticated session — never client-supplied input — and are part of the exported record itself (both the local download and `_GUID.json`), so the audit trail travels with the file, not just in a server-side log. |
| G2 | `_GUID.json` writes are not logged in `_ledassetschangelog.csv` | Pass, deliberate scope decision | Web BRD Section 24's change log covers asset files (images/videos an operator uploads); `_GUID.json` is app-generated export metadata, not an "asset" in that sense, and Section 24/25 don't call for a change-log entry on export. Consistent with the change log's own exclusion of `_GUID.json` in D3 above — if it were logged as a change, excluding it from the "real files" check would be inconsistent. Flagged here as a deliberate, documented choice rather than a silently-skipped requirement, in case the user wants export events tracked in that log too. |
