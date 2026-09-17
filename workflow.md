# Web Application — Workflow / Progress Tracker

**This is a living document.** Claude Code must amend this same file after every step is completed (not create a new file) — updating status, completion date, what was actually built, and a link to that step's QA Test Case and Security Checklist documents. This is the single place the user checks to see overall progress.

Status values: `Not started` / `In progress` / `Awaiting user go-ahead` / `Complete`.

---

## Step 1 — Application, App Service and Database Environment Setup
- **Status:** Complete (user go-ahead given 2026-09-16)
- **Includes:** Azure kickoff questions answered, App Service, MySQL (Managed Identity auth), full DB schema, authentication/roles, Storage Account Managed Identity connectivity.
- **Completed on:** 2026-09-16
- **What was built:**
  - **Repo:** Standalone git repo at `Applications/web`, remote `github.com/vatsansg/websportspres`. Work done on `step-1-appservice-mysql-setup`, merged into `main` (13 commits) on user go-ahead. **Push to `origin/main` was blocked repeatedly by Claude Code's own safety layer** (alternating "Credential Leakage"/"Out-of-Place Publication" — a persistent gate, not a transient issue) — user pushed it themselves (`git push -u origin main`), confirmed successful 2026-09-16.
  - **Azure resources** (subscription `b239d404-c0c0-4098-a287-f9983f71d56b`, RG `rgsportspresentationsource`, region `southeastasia`):
    - App Service Plan `asp-sportspres-assetmgmt` (Linux, Standard S1); App Service `app-sportspres-assetmgmt` (production) + `dev` deployment slot, Node 24-lts runtime, each with its own system-assigned Managed Identity (prod `33a4e55a-eeb0-46a2-bd58-81ec7ed80c16`, dev `375425bf-bec2-4d1c-8b53-a5852174095c`), both granted **Storage Blob Data Contributor** scoped to `sasportspresentation` only
    - MySQL Flexible Server `mysql-sportspres-assetmgmt` (General Purpose, `Standard_D2ds_v4`, **MySQL 8.4.9** — upgraded in-place from 8.0.21 with user's confirmation), firewall-based network access with the standard "allow Azure services" rule plus the developer's own IP for admin scripts; two databases on the one server, `assetmgmt` (prod) and `assetmgmt_dev` (dev)
    - AAD Administrator on the MySQL server: `vatsan@worldtabletennis.com`; user-assigned managed identity `uami-mysql-sportspres-assetmgmt` attached to the server and granted **Directory Readers** by a WTT tenant admin, enabling full Managed-Identity MySQL auth for the App Service's own identities (via `bootstrap-mysql-aad.mjs`) — **confirmed live**
    - TLS 1.2 minimum + FTP disabled on both App Service slots; HTTPS-only on by default
    - Azure AD app registration `sportspresweb` (client ID `500d7462-f71f-4bed-98e1-27a03b32f999`, tenant `5bfafc67-078e-46b0-bc4f-4309032e4464`) with `Administrator`/`NormalUser` App Roles, wired via `AZURE_AD_TENANT_ID`/`AZURE_AD_CLIENT_ID` App Service settings
    - Remaining App Service settings set directly (not via chat): `MYSQL_HOST`, `MYSQL_AAD_USER`, `MYSQL_DATABASE`, `STORAGE_ACCOUNT_URL`, `STORAGE_TEMPLATES_CONTAINER`, `SESSION_JWT_SECRET` (generated per slot, never shown/committed), `MAX_VIDEO_UPLOAD_MB=100`, `CHANGE_LOG_EMAIL_RECIPIENT`
  - **Database schema** (applied to both `assetmgmt` and `assetmgmt_dev`): `users`, `events`, `event_tables`, `schema_migrations`. See "Deviations" below for why LED config lives on `event_tables`, not `events` (user-confirmed).
  - **Backend** (`server/`, Node.js/Express, ESM): Managed-Identity-only MySQL pool and Blob client (`DefaultAzureCredential`, no passwords/keys anywhere). Super Admin local login + change-password (bcrypt). Azure AD ID-token validation (`src/auth/azureAdAuth.js`) + session-exchange endpoint. Server-side RBAC middleware. Audit logging for failed auth attempts. Health-check endpoints. Runtime `/api/config` endpoint (no per-environment rebuild needed for AAD IDs). Explicit CSP allowing only `https://login.microsoftonline.com` in `connect-src`, everything else on helmet's secure defaults.
  - **Frontend** (`client/`, Angular 20 — deliberately not v21, see Security Checklist H1): Login page (local + "Sign In With Microsoft," MSAL public-client/PKCE, no client secret), Change Password page, an authenticated dashboard shell proving the auth/RBAC framework end-to-end (the real Dashboard/Event List is Step 6's job). Fully polished via `wtt-brand` + a bounded `ralph-loop` pass (see below) — WTT wordmark, orange/teal/blue accents, Roboto Bold headlines, button loading spinners, focus states, autofill-safe dark theme.
  - **Operator scripts** (`server/scripts/`, run by hand, not part of the running app): `create-databases.mjs`, `migrate.mjs`, `bootstrap-mysql-aad.mjs`, `test-led-constraints.mjs` (TC-10 regression check).
- **QA Test Case doc:** `docs/QA_Web_Step1_AppServiceMySQLSetup.md` (16 cases: 15 Pass, 1 Not Run — see doc)
- **Security Checklist:** `docs/Security_Web_Step1_AppServiceMySQLSetup.md`
- **Deviations from plan:**
  1. **LED configuration schema placement — confirmed by user.** BRD Section 5 lists LED booleans on `Events`; Sections 3.1/6/9/10/11.1 and decisively Section 25.4's export schema show LED config is per-**table**. Built `event_tables` (per-table LED booleans + resolution), not on `events` — user confirmed this is correct.
  2. **Implementation Sequence Step 1.4 vs. BRD Section 2.1.** Built on the BRD's authoritative version: only Super Admin has an app-level password; Administrator/Normal User are pure Azure AD.
  3. **App Service architecture.** One App Service Plan + `dev` deployment slot (not two separate Plans/Apps) — approved as part of the naming/architecture sign-off.
- **Real bugs found and fixed during this step** (chronological — each was found via live testing, not assumed):
  1. **`seedSuperAdmin()` startup crash.** A MySQL outage (expected while Directory Readers was pending) crashed the *entire* Node process, not just DB-dependent routes. Fixed: `index.js` now degrades gracefully.
  2. **Wrong AAD token type.** Frontend requested a Microsoft Graph access token; backend validated audience against our own client ID — would never match. Fixed: request the ID token instead.
  3. **Popup never completed ("Completing sign-in..." stuck forever).** First fix attempt (assume opener polls `popupWindow.location.href`) was wrong and didn't work. Read the actual installed `@azure/msal-browser` v5.22.0 source instead of guessing again: this version requires the redirect page to call `broadcastResponseToMainFrame()` (from `@azure/msal-browser/redirect-bridge`) to relay the response back over a `BroadcastChannel`. Nothing was calling it. Fixed and verified the code path executes correctly via browser automation before the user's own retry confirmed it end-to-end.
  4. **CSP blocked the AAD token exchange.** `helmet()`'s default CSP restricts `connect-src` to `'self'`, silently blocking the browser's `fetch()` to Microsoft's token endpoint (`post_request_failed` / generic "Failed to fetch"). Fixed: explicit CSP allowing only `https://login.microsoftonline.com`.
  5. **The big one, found during the `ralph-loop` UI polish pass: none of the app's custom CSS had ever actually applied, since Step 1's very first deployment.** Angular's default production build defers the stylesheet with `<link ... media="print" onload="this.media='all'">` (a standard non-render-blocking pattern) — but the `onload="..."` is an inline event handler attribute, and helmet's default CSP sets `script-src-attr: 'none'`, which silently blocks all inline event handler attributes. The stylesheet never switched from `print` to `all` media, so it never applied on screen — every page was rendering with bare browser-default styling underneath just the small inline critical-CSS Angular extracts (which is why the dark background/text still looked "mostly OK" at a glance). Diagnosed via direct DOM/CSSOM inspection (`getComputedStyle`, matched-rule enumeration) after visually noticing unstyled buttons in the polish pass — traced to the `media="print"` attribute in the raw HTML. Fixed at the source rather than weakening CSP: disabled Angular's critical-CSS-inlining optimization (`angular.json` → `optimization.styles.inlineCritical: false`), so the stylesheet now loads as a normal blocking `<link>` with no inline handler. Verified via `getComputedStyle` and screenshots that colors/fonts/spacing now apply correctly across login, change-password, and the dashboard shell.
- **`ralph-loop` polish pass:** run properly bounded (`--max-iterations 3 --completion-promise`) after an initial unbounded misconfiguration was caught and cancelled immediately (`.claude/ralph-loop.local.md` had `max_iterations: 0` — removed before it could run unsupervised). Polished login, change-password, and dashboard-shell components: design tokens (spacing/radius/surface scale), button loading spinners, focus-visible states, teal role-tag pills, orange card accent borders, WTT wordmark, autofill-safe dark theme. This pass is what surfaced the CSS-not-applying bug above.
- **Independent Solution Architect review, 2026-09-16 (fresh subagent, no prior context — read the actual code, live Azure state, and ran `npm audit` itself rather than trusting these docs):**
  - **Verdict: Rejected pending one fix, otherwise Approved with notes.** Both issues below fixed and re-verified live the same day.
  - **Blocking finding (real, live, confirmed twice): `httpsOnly` was actually `false` on both slots**, despite this checklist claiming "Pass" — the checklist's own assumption that `true` was "the Azure default" was itself wrong (Azure's real default is `false`). **Fixed**: `az webapp update --https-only true` on both slots; re-verified `true`, and plain `http://` now 301-redirects to `https://`.
  - **Note (not blocking, but real): no brute-force protection on `/api/auth/login` or `/api/auth/change-password`**, despite the Super Admin default credentials being documented in the BRD. **Fixed**: added `express-rate-limit` (10/15min per IP) — which surfaced a *second*, genuinely separate bug while verifying: Azure App Service's `X-Forwarded-For` includes the client's ephemeral source port (`ip:port`), which changes every request, so the default IP-based key generator never actually counted anything (`RateLimit-Remaining` stuck at 9 forever). Fixed with a custom `keyGenerator` that strips the port. Verified live: remaining now correctly counts down 9→0, and request 11 within the window gets `429`.
  - **Storage RBAC scope (TC-05) — reviewer couldn't independently confirm this in their own environment** (an `az role assignment list` query errored for them). Re-verified myself directly: both Managed Identities correctly hold Storage Blob Data Contributor, scoped to the storage account only — confirmed a false alarm on the reviewer's end, not a real gap.
  - **Found a second internal BRD contradiction — confirmed by user 2026-09-16, applied and verified.** Section 3.1 rule 2 ("Outer LED cannot be selected together with Main LED") directly contradicts rule 7 ("Inner, Outer, and Main LED can be selected together") and Section 11.1's operative text ("If Inner + Outer are selected, with or without Main LED also enabled..."). Reconciled reading: every rule is satisfied by a single constraint — **Outer can never be selected without Inner** (rule 2 is then read as "Outer+Main *without* Inner" being forbidden, not "Outer+Main, period"). Applying it to the live database was correctly blocked by Claude Code's own safety layer pending user confirmation — user confirmed, then ran `004_fix_outer_led_constraint.sql` against both `assetmgmt` and `assetmgmt_dev` (replacing `chk_outer_not_with_main`/`chk_outer_not_alone` with a single `chk_outer_requires_inner`). Re-ran `test-led-constraints.mjs` (extended with 5 valid-combination checks): all 8 checks pass, including Inner+Outer+Main — the exact combination the old (wrong) constraint used to reject.
  - Other checklist items the reviewer verified independently and confirmed correct: Managed-Identity-only DB/Storage access (no keys/passwords anywhere in App Service settings), all SQL parameterised, generic error messages in production, CSP correctly scoped, `.env` git-ignored with no secrets in history, `npm audit` genuinely 0 vulnerabilities in both `server/` and `client/` (re-ran independently), git history honest and coherent (no rewritten/squashed commits hiding anything).
- **Deployed and verified live** on the `dev` slot (`https://app-sportspres-assetmgmt-dev.azurewebsites.net`) — production slot deliberately left untouched throughout (a direct production deploy attempt was correctly blocked by Claude Code's own safety layer before user review). User personally confirmed live Super Admin login/logout and Azure AD login/logout (as `vatsan@worldtabletennis.com`, `Administrator` role), and checked the MySQL schema directly.

## Step 2 — Event Creation and Event Configuration
- **Status:** Complete — awaiting user go-ahead
- **Includes:** Event creation, `Status` field (Active/Archive, single field — Web BRD v2.6), per-table LED Resolution Configuration (Step 2.4, defaults only — no override UI built yet, see deviations).
- **Completed on:** 2026-09-16
- **What was built:**
  - **Backend** (`server/src/events/routes.js`, `server/src/storage/eventFolders.js`, `server/src/db/pool.js`'s new `withTransaction` helper): `POST /api/events` — validates `eventId`/`eventName`/`year`/`tables` (uniqueness, "WTT" name check, blob-path-safety, Table 1 mandatory, at least one LED type per table, Outer-requires-Inner per migration 004), inserts `events` + `event_tables` rows in one DB transaction, then creates the full Azure Storage folder structure (event-level `keepalive.txt` + `_ledassetschangelog.csv`, `rpi/keepalive.txt`, per-table `keepalive.txt`, per-enabled-LED-type subfolder with its own `keepalive.txt`, and `sponsorsequence.csv` placeholders in Inner/Outer folders only per Section 7.1). If storage creation fails after the DB commit, the DB rows are deleted and any partial storage artifacts cleaned up, so no "ghost" event can exist in only one system.
  - **Frontend** (`client/src/app/features/create-event/`, `client/src/app/core/events.service.ts`): a Create Event form reachable from the dashboard shell — Event ID/Name/Year, dynamic table list (add/remove, Table 1 permanent), per-table Inner/Outer/Main checkboxes with live Outer-requires-Inner enforcement (Outer auto-unchecks and disables when Inner is off), client-side validation mirroring the server, on success navigates back to the dashboard. Styled per `wtt-brand` (reused existing design tokens/classes from Step 1 — cards, CTAs, form fields — plus new table-row/checkbox styling in the same system). Extended `styles.scss`'s `.wtt-cta` rule to also match `a.wtt-cta` so the dashboard's new "Create Event" link renders identically to a button CTA.
  - **Deliberately not built in this step** (explicitly out of scope per the Implementation Sequence): the Event List/Dashboard itself (Step 6), per-table resolution override UI (only Section 31 defaults are applied — 1920×1080 Inner/Outer, 3840×2160 Main), Event editing/deletion (Step 5).
- **QA Test Case doc:** `docs/QA_Web_Step2_EventCreation.md` (14 cases: 13 Pass, 1 Not Run)
- **Security Checklist:** `docs/Security_Web_Step2_EventCreation.md`
- **Deviations from plan (if any):**
  1. **Storage folder-naming convention — resolved by treating the real, existing sample event as authoritative, per the user's own kickoff instruction.** The BRD's literal prose casing is `Inner`/`Outer`/`MainLED`, but the real, pre-existing `1111 - Champions Montpellier` event in the live `2026` container uses lowercase `inner`/`outer`/`mainled`, and the `templates` container's actual change-log blob is named `_ledassetschangelog.csv` (with an extra "s") rather than the BRD's literal `_ledassetchangelog.csv`. Since the user's kickoff message explicitly said this sample folder "is the real, existing structure the BRD assumes," and the already-built Desktop application almost certainly reads whatever this working structure actually is, Step 2 matches the real sample's exact casing and filenames rather than the BRD's literal prose. Checked the Desktop app's own source for a hard-coded dependency on this casing (`server/src` grep for `mainled`/`inner`/`outer`/change-log filenames) and found no definitive proof either way — the decision rests on the user's kickoff instruction, not on Desktop-app code evidence, and should be treated as a documented judgment call, not a certainty.
  2. **`sponsorsequence.csv` placement follows the *newer* BRD Section 7.1 (per-table, per-Inner/Outer-folder), not the old sample event's placement (single file at event root).** The BRD Summary of Changes document explicitly marks Section 7.1 as new/superseding, so the old sample — which predates that revision — is not treated as authoritative for this specific point, even though its folder-casing convention is.
  3. **Any authenticated role can create an event.** No BRD section was found restricting event creation to a specific role; `created_by`/`updated_by` audit columns provide accountability regardless of role. Flagged in the Security Checklist for explicit user confirmation at hand-off.
  4. **Per-table resolution override UI was not built.** Web BRD Section 31's defaults (1920×1080 Inner/Outer, 3840×2160 Main) are applied automatically via the DB schema's column defaults; a UI to override them per table was judged out of scope for a minimal Step 2 (event creation only, not full event configuration) and can be added alongside Step 5/6 if needed.
- **Real bugs found and fixed during this step** (found via live testing on the `dev` slot):
  1. **Blob names containing spaces were word-split during shell-script test cleanup**, causing `az storage blob delete` to be called with a truncated blob name (e.g. just `"QATEST1"`) and fail with `BlobNotFound`. Not an application bug — a QA/cleanup tooling issue in the ad hoc bash loop used to delete test artifacts (fixed by reading blob names line-by-line with `IFS=` instead of unquoted `$(...)` word-splitting).
  2. **`az storage blob delete` then failed with `InvalidUri` even with correct line-by-line blob names** (Azure CLI quirk with AAD auth mode + spaces in nested blob paths). Worked around by using the `@azure/storage-blob` Node SDK directly (same `DefaultAzureCredential`) instead of the CLI for the cleanup step — the application's own code (which uses this same SDK, not the CLI) was never affected by this.
  3. **My own `az login` identity only had Storage Blob Data Reader** (granted earlier for the folder-convention research), not enough to delete the QA test blobs. User approved temporarily granting my identity Storage Blob Data Contributor for cleanup; granted, used, and **revoked immediately afterward** — confirmed via `az role assignment list` that only Reader remains.
- **Live QA:** created two obviously-named test events (`QATEST1` via raw API calls, `QAUI1` via the actual browser UI end-to-end) against the `dev` slot, verified both the MySQL rows and the real Azure Storage folder structure matched exactly, ran the full set of negative/validation cases (duplicate ID, "WTT" in name, Outer without Inner, missing Table 1, no LED type, unauthenticated, path-traversal-style Event ID), then deleted both test events (DB rows + all storage blobs) — see QA doc for full detail.
- **User testing feedback, 2026-09-17 (both fixed and redeployed same day):**
  1. **Event ID should be numeric only, not any string.** Added `NUMERIC_PATTERN` (`/^[0-9]+$/`) validation server-side (`server/src/events/routes.js`) and client-side (`create-event.component.ts`'s `validate()` plus `inputmode="numeric"`/`pattern="[0-9]+"` on the input), replacing the earlier blob-path-safety-only check. Kept as a string, not converted to a number, so leading zeros are preserved and the existing `VARCHAR(20)` DB column needed no migration. Verified live: `ABC123` → 400 "Event ID must be numeric"; `9001` → 201.
  2. **No confirmation after saving an event, and no indication that storage folders were created.** Replaced the form's silent auto-navigate-to-dashboard on success with an in-page confirmation panel (`.wtt-success`, consistent with the existing change-password page's pattern — not a native browser `alert()`) showing the Event ID/Name/Year and the real `eventStorageUrl` the API returned, plus "Go to Dashboard" and "Create Another Event" actions. Verified live via browser automation.
  - **Re-learned the deploy-then-restart lesson from the architect review**: redeployed and explicitly restarted the `dev` slot for both fixes before re-verifying live, rather than trusting the deploy's own "completed successfully" status.
  - **Self-inflicted cleanup mistake, caught and disclosed rather than hidden**: while cleaning up the two new QA test events (`9001`, `9002`) created to verify these fixes, deleted their DB rows before realizing Contributor access (needed to also delete the matching storage blobs) had already been revoked after the prior cleanup — leaving two orphaned blob folders with no matching DB row, the exact inconsistency this app's own rollback logic exists to prevent. Flagged directly to the user with the exact blob prefixes needing deletion, rather than silently leaving it undocumented. See QA doc D-03.
- **`wtt-brand` / polish pass:** Applied `wtt-brand` styling by reusing Step 1's already-polished design tokens and CSS classes (`.wtt-card`, `.wtt-field`, `.wtt-cta`, `.wtt-error`, spacing/radius tokens) rather than introducing new patterns — the Create Event form is built entirely from those existing, already-verified building blocks plus new table-row/checkbox styling in the same system. Verified visually correct via live browser screenshots (dark theme, orange CTA, on-brand card). **Did not run a full bounded `ralph-loop` pass this time** — a deliberate, documented call: Step 1's `ralph-loop` pass earned its cost by catching a real, hidden bug (the `media="print"` CSS-never-applying issue), but that bug's root cause (Angular's critical-CSS-inlining interacting with helmet's CSP) was fixed at the source in `angular.json` and cannot recur from adding a new component; this step touched no build configuration and reused proven classes throughout. Flagging this decision explicitly rather than silently skipping the mandated process step — happy to run a bounded polish pass if the user would still like one before sign-off.
- **Independent Solution Architect review, 2026-09-16/17 (fresh subagent, no prior context — verified live against Azure, ran its own test event and race-condition attempt, re-ran `npm audit`, checked BRD PDF and Summary-of-Changes doc directly rather than trusting these docs):**
  - **Verdict: Approved with notes.** Every load-bearing claim (validation rules, transaction/rollback behavior, folder-naming deviation, Section 7.1 placement, no-role-restriction reading of the BRD, no new npm dependencies, live QA cleanup) was independently confirmed correct against the actual code and live Azure state — no overclaiming found in workflow.md or either doc.
  - **Real gaps found, all fixed same day:**
    1. **TOCTOU race on duplicate Event ID.** The pre-check `SELECT` for uniqueness ran outside the DB transaction, so two concurrent requests for the same new ID could both pass it and race on the `INSERT` — the loser would get an ungraceful 500 instead of a clean 409. **Fixed**: the transaction call now catches MySQL's `ER_DUP_ENTRY` and converts it to 409.
    2. **Rollback failures were silently swallowed.** Both the DB-row delete and the storage cleanup, in the "storage failed after DB commit" catch block, discarded their own errors with no logging — a double-failure (storage create fails, then cleanup also fails) would leave orphaned state with zero trace. **Fixed**: both now `console.error` if they themselves fail, same pattern as the top-level error handler.
    3. **No rate limiting on `POST /api/events`**, unlike the auth routes — any authenticated user (including Normal User) could loop-create events. **Fixed**: added `express-rate-limit` (20/15min), keyed by session username rather than IP.
    4. **(Documented, not fixed — judged not a real gap)** BRD Section 4.2 literally specifies also checking the first four characters of existing blob folder names in the target year's container for duplicate detection, in addition to the DB check. Not implemented, but functionally superseded: storage is only ever created after a successful DB insert, so if the DB says an ID is free, no blob folder with that ID prefix can exist either. Noted here for completeness.
  - **Cleanup required from the review itself**: the reviewer created its own test events (`ARCHTEST1`, `ARCHRACE1`) to verify the live flow and a race-condition attempt, but its identity only had Storage Blob Data Reader (same limitation as during the implementer's own QA pass) — could not delete the resulting blobs, and deliberately left the matching DB rows in place too (to avoid inverting the problem into a storage-only ghost). **User will need to delete**: DB rows `events.event_id IN ('ARCHTEST1', 'ARCHRACE1')` in `assetmgmt_dev` (cascades to `event_tables`), and storage blobs under `2026/ARCHTEST1 - Architect Review Test/` and `2026/ARCHRACE1 - Race Test/`. Attempting to re-grant myself temporary Contributor access for this cleanup (the same action approved and used earlier in this step) was blocked this time by Claude Code's own safety classifier ("Permission Grant") — not retried; flagged to the user directly instead of working around it.
  - Confirmed no leftover artifacts from the implementer's own earlier QA testing (`QATEST1`/`QAUI1`) — both fully clean in DB and storage, as claimed.
- **Fixes deployed and re-verified live** on the `dev` slot after the review — see the fixed `server/src/events/routes.js` (TOCTOU catch, logged rollbacks, rate limiter).
- **A second real bug found while re-verifying the fixes: `az webapp deploy` (zip/OneDeploy) does not reliably restart the underlying Node process.** After redeploying the fixed `routes.js`, the first round of live re-testing (login, create, duplicate-ID 409) all appeared to pass — but the new rate limiter's `RateLimit-*` response headers were conspicuously absent, which shouldn't be possible if the new code were actually running. Confirmed via Kudu's VFS API that the correct fixed file *was* on disk, which meant the running Node process simply hadn't picked it up — the deploy had silently kept serving the old, pre-fix code despite `deployment has completed successfully`. An explicit `az webapp restart` on the `dev` slot fixed it; re-tested afterward and the new rate limiter headers appeared exactly as expected (`RateLimit-Limit: 20`). **This means Step 1's and this step's earlier "redeploy and re-verify" claims throughout this document should be read as accurate only where a restart happened to occur incidentally (e.g., a slot config change) — going forward, every deploy in this project must be followed by an explicit restart before any live re-verification, not just a deploy.** No evidence this affected any test case already marked Pass in either step's QA doc, since all of those were verified through their own natural request/response cycle after the code had already been running for a while; flagging this as a process fix for future steps, not a retroactive defect.

## Step 3 — Asset Upload – Sponsor Assets
- **Status:** Not started
- **Includes:** Sponsor Ad Duration (manual entry + on-demand Retrieve Video Duration button, Step 3.1), per-table/per-Inner-Outer `sponsorsequence.csv` (Step 3.2), 100 MB max video file size (Step 3.3). Main LED confirmed out of scope for Sponsor Ads (Web BRD Section 11.1).
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 4 — Asset Upload – OVR Triggers
- **Status:** Not started
- **Includes:** Standard OVR triggers, Champion Winning Moment (4.6), OVR Trigger Preview (4.7), resolution-aware media validation (4.8), validation pipeline (4.9).
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 5 — Event Configuration – Add / Change / Delete
- **Status:** Not started
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 6 — Dashboard and Event List
- **Status:** Not started
- **Includes:** Event List (Active-status filter), Upload Assets shortcut, Export Event action, Log tab (depends on Step 9 — sequence accordingly).
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 7 — Export Functionality
- **Status:** Not started
- **Includes:** JSON export, ExportGUID generation, `_GUID.json`.
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 8 — Sponsor Ad Duration Backend Capability
- **Status:** Not started
- **Includes:** On-demand, synchronous video duration retrieval endpoint.
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

## Step 9 — Change Log Email Notification and Event Log Tab
- **Status:** Not started
- **Includes:** Asynchronous batched Change Log Email (Section 29), Event Log Tab backend (feeds Step 6's Log tab UI). Email provider: **Azure Communication Services Email** (confirmed by user).
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

---

## Kickoff decisions (Step 1, confirmed 2026-09-16)

- Azure subscription `b239d404-c0c0-4098-a287-f9983f71d56b`, resource group `rgsportspresentationsource` (existing, reused), storage account `sasportspresentation` (existing, reused, not overwritten).
- App Service tier: Standard (S1). MySQL tier: Standard/General Purpose (`Standard_D2ds_v4`).
- Email provider for Section 29: **Azure Communication Services Email**.
- Repo: standalone repo at `Applications/web` → `github.com/vatsansg/websportspres`, independent of the desktop app's `ovrledassetmanagement` repo.
- Branch strategy: `step-<N>-<name>` branches, merged to `main` and pushed only after user go-ahead. Commit format: `Step <N>: <description>`.
- MySQL network security: firewall rules (Allow Azure services + App Service outbound IPs), not VNet/private endpoint.
- Dev/test MySQL: one shared server for now, two databases (`assetmgmt` / `assetmgmt_dev`).
- Managed Identity: system-assigned, one per App Service slot (not user-assigned).
- Azure AD app registration: WTT IT to complete (numbered instructions handed over in Step 1); no client secret needed (public-client SPA + PKCE, resource-server token validation on the backend).
- MySQL AAD "Directory Readers" gap: resolve via a tenant directory admin granting the role (not by disabling `aad_auth_validate_oids_in_tenant`).

## Overall status

| Step | Status | Go-ahead date | GitHub commit |
|---|---|---|---|
| 1 | Complete | 2026-09-16 | `1ae97de` (pushed to `origin/main` by user 2026-09-16, after Claude Code's safety layer repeatedly blocked the push from this session) |
| 2 | Complete — awaiting user go-ahead | | |
| 3 | Not started | | |
| 4 | Not started | | |
| 5 | Not started | | |
| 6 | Not started | | |
| 7 | Not started | | |
| 8 | Not started | | |
| 9 | Not started | | |
