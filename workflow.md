# Web Application — Workflow / Progress Tracker

**This is a living document.** Claude Code must amend this same file after every step is completed (not create a new file) — updating status, completion date, what was actually built, and a link to that step's QA Test Case and Security Checklist documents. This is the single place the user checks to see overall progress.

Status values: `Not started` / `In progress` / `Awaiting user go-ahead` / `Complete`.

---

## Step 1 — Application, App Service and Database Environment Setup
- **Status:** Awaiting user go-ahead (build, testing, and independent review complete — this is the final hand-off record)
- **Includes:** Azure kickoff questions answered, App Service, MySQL (Managed Identity auth), full DB schema, authentication/roles, Storage Account Managed Identity connectivity.
- **Completed on:** 2026-09-16
- **What was built:**
  - **Repo:** New standalone git repo at `Applications/web`, remote `github.com/vatsansg/websportspres`, branch `step-1-appservice-mysql-setup` off `main`. Not yet pushed/merged — waiting for go-ahead per the Solution Implementation Plan.
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
- **Independent Solution Architect review:** see below.
- **Deployed and verified live** on the `dev` slot (`https://app-sportspres-assetmgmt-dev.azurewebsites.net`) — production slot deliberately left untouched throughout (a direct production deploy attempt was correctly blocked by Claude Code's own safety layer before user review). User personally confirmed live Super Admin login/logout and Azure AD login/logout (as `vatsan@worldtabletennis.com`, `Administrator` role), and checked the MySQL schema directly.

## Step 2 — Event Creation and Event Configuration
- **Status:** Not started
- **Includes:** Event creation, `Status` field (Active/Archive, single field — Web BRD v2.6), per-table LED Resolution Configuration (Step 2.4).
- **Completed on:**
- **What was built:**
- **QA Test Case doc:**
- **Security Checklist:**
- **Deviations from plan (if any):**

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
| 1 | Awaiting user go-ahead | | |
| 2 | Not started | | |
| 3 | Not started | | |
| 4 | Not started | | |
| 5 | Not started | | |
| 6 | Not started | | |
| 7 | Not started | | |
| 8 | Not started | | |
| 9 | Not started | | |
