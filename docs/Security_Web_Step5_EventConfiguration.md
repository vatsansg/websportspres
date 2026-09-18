# Security Checklist — Step 5/6: Event Configuration, Dashboard/Event List, Asset Management Settings Edit, User Management

Backend and frontend completed 2026-09-18. No independent Solution Architect review has been run on this step yet. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`/`assetmgmt`), `sasportspresentation` (`2026`/`2027` containers), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Event edit (`PUT /api/events/:eventId`) requires an authenticated session | Pass | `requireSession` first in the middleware chain, same pattern as every other events route. Confirmed live (QA TC-01). |
| A2 | Asset Management Settings edit (`GET`/`PUT /api/asset-rules/raw`) restricted to SuperAdmin/Administrator | Pass | `requireRole("SuperAdmin", "Administrator")` on both routes. The view-only curated summary at `GET /api/asset-rules` remains available to every authenticated role, unchanged from Step 4. Confirmed live for the unauthenticated case (401); role-level rejection not re-exercised live this session (no NormalUser test account — see QA TC-10). |
| A3 | User Management (`/api/users/*`) restricted to SuperAdmin/Administrator | Pass | `usersRouter.use(requireSession, requireRole("SuperAdmin", "Administrator"))` gates the entire router, not per-route. Confirmed live for the unauthenticated case (401). |
| A4 | Administrator-vs-SuperAdmin permission matrix (who can grant which role) is enforced server-side, not just hidden in the UI | Pass, as designed — **not independently live-tested from the Administrator side** | `assertRoleAllowed()` is called identically at create/edit/delete; the client (`user-management.component.ts`'s `assignableRoles` getter) only mirrors it for UX, exactly the same pattern as `adminGuard` elsewhere in this app. See QA TC-22 for why the Administrator-side negative path couldn't be exercised live this session (no real Administrator-role test credentials available) — flagged for the user's own pass. |
| A5 | **Architecture change**: Azure AD login is no longer self-provisioning — a `users` row must already exist (added via User Management) before an Azure AD sign-in is accepted | Pass, as designed — **not independently live-tested end-to-end (interactive Microsoft login) this session** | Previously, `POST /api/auth/aad/session` upserted a `users` row for *any* successfully-authenticated Azure AD token, deriving role from the token's `roles` claim — meaning anyone in the tenant with either App Role assigned could sign in and get access automatically. Now: `verifyAzureAdToken()` only proves identity (no `roles` claim read at all); the session handler looks up `users` by `azure_ad_object_id` then `username`, and returns `403` if no row exists. This is the single most safety-critical change in this step. See QA TC-23/TC-24. |
| A6 | Directory search is scoped to the `worldtabletennis.com` domain only, even though the underlying Graph permission is tenant-wide | Pass | `graphClient.js`'s `$filter` hardcodes `endswith(mail,'@worldtabletennis.com')`; `POST /api/users` additionally validates the submitted email against the same domain pattern server-side (`EMAIL_DOMAIN_PATTERN`), so the domain restriction isn't only a search-UI convenience. |
| A7 | The seeded local SuperAdmin account cannot be modified or deleted through the new User Management endpoints | Pass | Both `PUT`/`DELETE /api/users/:id` explicitly reject `auth_provider !== 'azuread'` rows with 403. Confirmed live (QA TC-21). Prevents an Admin/SuperAdmin from accidentally locking the organization out of its one break-glass local account. |
| A8 | A user cannot edit or remove their own row through User Management | Pass | Both `PUT`/`DELETE /api/users/:id` compare `target.username === req.user.username` and reject with 400. Not independently live-tested under the `vatsan` identity specifically (would require signing in as that account), but the same code path was exercised under the `first_time_admin` identity implicitly by A7's test. |
| A9 | Client-side route guard (`adminGuard`) for `/asset-rules` and `/users` is UX-only, not the real access boundary | Pass, by design | Documented explicitly in `auth.guard.ts`'s own comment — the real enforcement is server-side `requireRole` (A2/A3). Consistent with how every other role-based UI affordance in this app already works. |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new inbound network exposure introduced in this step | Pass | No new ports, CORS rules, or CSP changes. |
| C2 | New outbound call to Microsoft Graph (`graphClient.js`) uses HTTPS only, with a Managed-Identity-issued bearer token | Pass | `fetch("https://graph.microsoft.com/v1.0/users?...")` — no custom TLS handling, no credential ever placed in a URL or log statement. |
| C3 | The new Graph API permission grant is the minimum needed, not broader | Pass | Only `User.Read.All` (application, read-only) was granted to the Managed Identity — not `User.ReadWrite.All`, not `Directory.ReadWrite.All`, and not `AppRoleAssignment.ReadWrite.All` (which would have let this app assign Azure AD App Roles directly; deliberately not requested, since role authorization was moved into this app's own `users` table instead — see A5). Granted identically to both the prod and dev slot's Managed Identities, since both will eventually need it; only the `dev` slot's grant has been exercised live so far. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Event rename's cross-container storage move (year change) never leaves data only partially moved without a trace | Pass | `renameEventStorage()` copies each blob to the new location and only deletes the old copy after the new one lands successfully — a mid-operation failure leaves duplicates under both locations rather than losing anything, consistent with the same-container rename logic this generalizes. Not independently fault-injection-tested (e.g. killing the process mid-copy) this session — same caveat as this pattern already carried before this step. |
| D2 | A storage-sync failure partway through an event edit is surfaced, not swallowed | Pass, with a documented asymmetry | Unlike event *creation* (full DB+storage rollback on failure), an edit's storage-side failure after the DB commit is **not** automatically rolled back — logged loudly (`console.error`) and returned as a 500 telling the operator the DB and storage may be out of sync. Deliberate, documented scope decision (see workflow.md) given how much harder a safe partial-rollback would be for a combined rename/add/delete/toggle operation; not a silent-failure gap. |
| D3 | The Asset Management Settings config (drives every OVR Trigger upload's validation across the whole app) can't be corrupted by a malformed save | Pass | Both defense-in-depth layers: the structured editor's own client-side `validate()` blocks obviously-incomplete submissions before they're even sent, and the server's `validateShape()` independently re-validates the full shape (non-empty arrays, valid destinations, required-filename-when-needed) before writing to blob storage or refreshing the in-memory cache — confirmed live with a deliberately malformed payload (QA TC-12). |
| D4 | The `users` table's `added_by` audit column is populated from the authenticated session, never client input | Pass | `POST /api/users` sets `added_by = req.user.username` server-side; the request body has no `addedBy` field the client could forge. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | All new/changed queries (`events/routes.js`'s edit transaction, `users/routes.js`) are parameterised via `mysql2` placeholders, including the `event_id IN (?)` array-expansion form used by the Dashboard listing. |
| E2 | The edit endpoint independently re-derives which changes are destructive, rather than trusting a client-supplied "already confirmed" list | Pass | `PUT /api/events/:eventId` recomputes the full diff (rename/table-delete/LED-disable) and the real-file counts on every call, including the confirmed resubmission — a caller cannot skip a confirmation by simply setting `confirmed: true` on a request whose actual destructive content differs from what a legitimate UI flow would have shown the user. The `confirmed` flag only ever suppresses the 409 gate, never the diff computation itself. |
| E3 | Directory search cannot be used to enumerate the full tenant directory (only WTT-domain, query-matched results, capped) | Pass | `$top=15`, domain-filtered, and requires `q.length >= 2` (both client- and server-enforced) — not a general-purpose directory browser. |
| E4 | Error messages returned to the client do not leak internal details | Pass | Reuses the existing `errorHandler.js` pattern; Graph API failures are caught and rewritten to a generic "Directory search is temporarily unavailable" 502 rather than surfacing Graph's own raw error body to the client (the raw body is only `console.error`-logged server-side). |
| E5 | Rate limiting on the new/changed mutating routes | Pass | `PUT /api/events/:eventId` reuses the same rate-limiter shape as event creation (`eventEditLimiter`, 30/15min per username). **Found missing on `POST`/`PUT`/`DELETE /api/users` while writing this checklist, fixed same day**: added `userMutationLimiter` (30/15min per username, same shape) to all three routes. |
| E6 | Business-rule validation (Outer-requires-Inner, Table 1 mandatory, Event ID numeric/uniqueness) is re-enforced on every edit, not just at creation | Pass | `PUT /api/events/:eventId` reuses the exact same `validateTables()` function creation already uses. Confirmed live indirectly (QA TC-02 through TC-08 all passed through this validation without issue on legitimate edits). |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced — Graph API access uses the existing Managed Identity credential chain | Pass | `graphClient.js` reuses `DefaultAzureCredential`, same pattern as `db/pool.js`/`blobClient.js`. No client secret, API key, or connection string added anywhere in this step. |
| F2 | `npm audit` clean; no new npm dependencies introduced | Pass | Graph API calls use the platform's native `fetch`, not a new SDK package (e.g. `@microsoft/microsoft-graph-client` was deliberately not added). `npm audit` in `server/` still reports 0 vulnerabilities. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Every file actually deleted as a side effect of an event edit (table deletion, LED-destination disable) is recorded in the change log | Pass | Both paths call `listRealFiles()` before deleting, then `appendChangeLogEntry()` (status `Deleted`) for each real file found, reusing the same ETag-conditional-write helper from Step 3. Confirmed live indirectly (the TC-03 destination-disable scenario was previewed via the confirmation modal but not actually applied, so the change-log write itself wasn't re-inspected this session — the code path is identical to the already-verified `deleteTableStorage` case in TC-07, which *was* applied live). |
| G2 | Every AAD sign-in attempt against a not-yet-provisioned account is logged for audit | Pass | `logAuthFailure("aad_login_not_provisioned", { username })` on the new 403 path, same `auditLogger`/`logAuthFailure` infrastructure Step 1 built for local-login failures and role-based 403s. |
| G3 | Who added/removed a User Management entry is attributable | Pass | `added_by` column (D4) plus the existing `users.created_at`/`last_login_at` gives a full provisioning history per account; there's no separate "removed by" record once a row is deleted (a hard delete, not a soft-delete/audit-log row) — acceptable for this feature's low volume and matches how the rest of the app already handles deletion (e.g. table deletion has no separate "who deleted this table" record beyond the change log's file-level entries), but noted here as a real limitation if a fuller audit trail is ever needed. |

## Summary of gaps carried forward (not blocking, all explicitly flagged above)

1. **A4/QA TC-22**: Administrator-side permission-matrix negative path not live-tested (no real Administrator test credentials this session).
2. **A5/QA TC-23**: The core login-gating change not exercised via an actual interactive Microsoft sign-in this session (verified by code review and the unauthenticated/role-based cases only).
3. **G3**: No "removed by" record for deleted User Management entries (hard delete).
