# Security Checklist — Step 2: Event Creation and Event Configuration

Completed 2026-09-16. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` (`2026` container), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Storage folder creation uses the App Service's existing Managed Identity — no new keys/secrets introduced | Pass | `server/src/storage/eventFolders.js` reuses `storage/blobClient.js`'s existing `DefaultAzureCredential`-based clients; no new credential material added in this step. |
| A2 | `POST /api/events` requires an authenticated session | Pass | `requireSession` middleware on the route; confirmed live (TC-08 in QA doc) — no cookie returns 401. |
| A3 | Role restriction on event creation matches BRD intent | Pass, as designed | No BRD section found restricting event creation to a specific role (checked Section 2, 5, 9, and the Summary-of-Changes doc); any authenticated role (SuperAdmin/Administrator/NormalUser) can create an event, consistent with `created_by`/`updated_by` audit columns existing on `events` for accountability regardless of role. Flagging this assumption explicitly for user review at hand-off. |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new network exposure introduced in this step | Pass | No new endpoints, ports, or network rules added; reuses Step 1's App Service/CORS/CSP configuration unchanged. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Event storage folders are created under the existing, non-public storage account/containers | Pass | Reuses the existing `2026`/`templates` containers; `allowBlobPublicAccess: false` at the account level (verified in Step 1) still applies — nothing in this step changes that. |
| D2 | Event data (ID, name, year, LED config) is validated server-side before being persisted or used to construct storage paths | Pass | `express-validator` + `validateTables()` in `server/src/events/routes.js`; DB `CHECK` constraints (migration 004) are a second, independent enforcement layer for the LED rules. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | All queries in `server/src/events/routes.js` are parameterised via `mysql2` placeholders; no string concatenation into SQL anywhere. |
| E2 | Path traversal via user-controlled blob path segments | Pass | `eventId`/`eventName` are used directly to build blob folder names (`storage/eventFolders.js`'s `buildEventFolderName`). Both fields are validated against `BLOB_SAFE_PATTERN` (`/^[^/\\\x00-\x1f]+$/`), rejecting `/`, `\`, and control characters before they ever reach a storage call. Verified live with a `../evil` Event ID (TC-09 in QA doc) — rejected with 400 before any storage or DB write. | 
| E3 | Business-rule validation cannot be bypassed by calling the API directly (not just enforced in the Angular form) | Pass | All rules (Outer requires Inner, Table 1 mandatory, at least one LED type, Event Name "WTT" check, uniqueness) are enforced server-side in `routes.js`/`validateTables()`, independently of the Angular client's own `validate()` — confirmed by testing each rejection via raw `curl`, not just through the UI. |
| E4 | Partial-failure data integrity — a storage failure after the DB write does not leave an orphaned/ghost event | Pass, by design (not live-forced — see QA doc TC-14) | `routes.js` wraps the DB insert in `withTransaction`; if the subsequent `createEventStorageStructure` call throws, the `catch` block deletes the `events` row (cascades to `event_tables` via `ON DELETE CASCADE`) and attempts `deleteEventStorageStructure` before rethrowing a generic 500. |
| E5 | Error messages returned to the client do not leak internal details | Pass | Reuses Step 1's `errorHandler.js` (generic message in production); the one custom message set in the storage-failure catch block ("Event storage creation failed; event was not created") is itself generic — no storage account name, path, or stack trace included. |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced in this step | Pass | No new npm dependencies requiring API keys/secrets were added; reuses Step 1's Managed-Identity-only credential chain end to end. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Event creation is attributable to a user | Pass | `created_by`/`updated_by` columns on `events` are populated from `req.user.username` (the authenticated session), not client-supplied input. |
| G2 | Change Log / Event Log Tab | N/A at this stage | Built from Step 3/4/9 onward; this step only creates the (empty, templated) `_ledassetschangelog.csv` placeholder file itself. |

## H. Dependency & platform

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | No new npm dependencies added | Pass | This step reuses `express`, `express-validator`, `mysql2`, and `@azure/storage-blob` — all already present and already `npm audit`-clean from Step 1. No new dependency installs were required. |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | | | Pending |
| User (Vatsan) go-ahead | | | Pending |
