# Web Application — Workflow / Progress Tracker

**This is a living document.** Claude Code must amend this same file after every step is completed (not create a new file) — updating status, completion date, what was actually built, and a link to that step's QA Test Case and Security Checklist documents. This is the single place the user checks to see overall progress.

Status values: `Not started` / `In progress` / `Awaiting user go-ahead` / `Complete`.

---

## Step 1 — Application, App Service and Database Environment Setup
- **Status:** Awaiting user go-ahead
- **Includes:** Azure kickoff questions answered, App Service, MySQL (Managed Identity auth), full DB schema, authentication/roles, Storage Account Managed Identity connectivity.
- **Completed on:** 2026-09-16 (build complete; blocked items below need resolution before final sign-off)
- **What was built:**
  - **Repo:** New standalone git repo at `Applications/web`, remote `github.com/vatsansg/websportspres`, branch `step-1-appservice-mysql-setup` off `main`. Not yet pushed/merged — waiting for go-ahead per the Solution Implementation Plan.
  - **Azure resources** (subscription `b239d404-c0c0-4098-a287-f9983f71d56b`, RG `rgsportspresentationsource`, region `southeastasia`):
    - App Service Plan `asp-sportspres-assetmgmt` (Linux, Standard S1)
    - App Service `app-sportspres-assetmgmt` (production) + `dev` deployment slot, Node 24-lts runtime, each with its own system-assigned Managed Identity (prod `33a4e55a-eeb0-46a2-bd58-81ec7ed80c16`, dev `375425bf-bec2-4d1c-8b53-a5852174095c`)
    - Both identities granted **Storage Blob Data Contributor**, scoped to `sasportspresentation` only
    - MySQL Flexible Server `mysql-sportspres-assetmgmt` (General Purpose, `Standard_D2ds_v4`, MySQL 8.4.9 — upgraded from 8.0.21 on 2026-09-16, see below), firewall-based network access (per your choice over VNet/private endpoint) with the standard "allow Azure services" rule plus the developer's own IP for admin scripts
    - Two databases on that one server: `assetmgmt` (prod) and `assetmgmt_dev` (dev) — satisfies BRD Section 2.2's "dev database" requirement without a second server, per your "one server for now" answer
    - AAD Administrator on the MySQL server set to `vatsan@worldtabletennis.com`; a user-assigned managed identity `uami-mysql-sportspres-assetmgmt` attached to the server (required by Azure for AAD auth) — **see blocker below**
    - TLS 1.2 minimum + FTP disabled on both App Service slots; HTTPS-only already on by default
    - App Service Application Settings set directly (not via chat) for both slots: `MYSQL_HOST`, `MYSQL_AAD_USER`, `MYSQL_DATABASE`, `STORAGE_ACCOUNT_URL`, `STORAGE_TEMPLATES_CONTAINER`, `SESSION_JWT_SECRET` (generated per slot, never shown/committed), `MAX_VIDEO_UPLOAD_MB=100`, `CHANGE_LOG_EMAIL_RECIPIENT`
  - **Database schema** (applied to both `assetmgmt` and `assetmgmt_dev`): `users`, `events`, `event_tables`, `schema_migrations`. See "Deviation" note below for why LED config lives on `event_tables`, not `events`.
  - **Backend** (`server/`, Node.js/Express, ESM): Managed-Identity-only MySQL pool (`src/db/pool.js`) and Blob client (`src/storage/blobClient.js`) — both use `DefaultAzureCredential`, no passwords/keys anywhere in code or config. Super Admin local login + change-password (bcrypt). Azure AD token-validation scaffold (`src/auth/azureAdAuth.js`) and session-exchange endpoint, ready but **not yet testable** (see blocker below). Server-side RBAC middleware. Audit logging for failed auth attempts. Health-check endpoints proving DB/Storage connectivity. Runtime `/api/config` endpoint so the SPA doesn't need per-environment rebuilds for AAD tenant/client IDs.
  - **Frontend** (`client/`, Angular 20 — deliberately not the newest v21, see Security Checklist H1): Login page (local + "Sign In With Microsoft," MSAL public-client/PKCE, no client secret), Change Password page, a minimal authenticated dashboard shell (proves the auth framework end-to-end; the real Dashboard/Event List is Step 6's job), all styled via the `wtt-brand` skill (black/white/orange/blue/teal tokens, Roboto Bold headlines). `ralph-loop` polish pass **not yet run** — see note below.
  - **Operator scripts** (`server/scripts/`, run by hand, not part of the running app): `create-databases.mjs`, `migrate.mjs`, `bootstrap-mysql-aad.mjs` (the last one blocked, see below).
- **QA Test Case doc:** `docs/QA_Web_Step1_AppServiceMySQLSetup.md`
- **Security Checklist:** `docs/Security_Web_Step1_AppServiceMySQLSetup.md`
- **Deviations from plan (if any):**
  1. **LED configuration schema placement — confirmed by user 2026-09-16.** BRD Section 5 lists Inner/Outer/Main LED as columns on the `Events` table. Sections 3.1, 6, 9, 10, 11.1, and — decisively — Section 25.4's export JSON spec ("each `tables` entry contains the table number **and** the Inner/Outer/Main LED booleans configured for **that table**") all show LED config is actually per-**table**. Built `event_tables` (one row per table, with `event_id`, Inner/Outer/Main LED booleans, and per-LED-type resolution) instead of putting LED columns on `events` — user confirmed this reading is correct and confirmed `events` should **not** carry the LED boolean columns. Schema re-verified against `002_create_events.sql`/`003_create_event_tables.sql` and matches exactly; no changes needed.
  2. **Implementation Sequence Step 1.4 table vs. BRD Section 2.1.** The Step 1.4 table lists "Admin: login, change password, logout" — implying an app-level password for Administrator. BRD Section 2.1 explicitly requires Administrator to authenticate via Azure AD only, with no app-level password. Built on the BRD's version (authoritative, most recent): only the local Super Admin account has an app-level password; Administrator and Normal User are pure Azure AD.
  3. **App Service architecture.** Used one App Service Plan + one App Service with a `dev` deployment slot (rather than two separate App Service Plans/Apps) to satisfy BRD Section 2.2's "dev server/environment" requirement — approved by you as part of the naming/architecture sign-off.
- **Blockers resolved 2026-09-16:**
  1. **MySQL AAD auth for the App Service — RESOLVED.** User confirmed Directory Readers was granted to `uami-mysql-sportspres-assetmgmt` by a WTT tenant directory admin. `server/scripts/bootstrap-mysql-aad.mjs` was then run successfully (created the AAD-mapped MySQL users for both App Service identities). **Confirmed live:** `https://app-sportspres-assetmgmt-dev.azurewebsites.net/api/health/db` now returns `{"ok":true}` — full Managed-Identity MySQL connectivity proven end-to-end, no password/connection string anywhere. Super Admin login also confirmed working live: `POST /api/auth/login` with `first_time_admin`/`Admin@123` issues a session, `/api/auth/me` confirms it.
  2. **MySQL bootstrap admin password rotated.** The original `sqlbootstrapadmin` password appeared in this session's tool output; rotated it via `az mysql flexible-server update` before handing the new one to the user (given directly in chat, not stored in this repo or any file).
  3. **Azure AD app registration received and partially wired.** App `sportspresweb` created in the tenant (client ID `500d7462-f71f-4bed-98e1-27a03b32f999`, tenant ID `5bfafc67-078e-46b0-bc4f-4309032e4464`, supported account types "Multiple organizations" — more permissive than the single-tenant I asked for, but the backend's issuer check (`azureAdAuth.js`) already only accepts tokens issued by this specific tenant, so cross-tenant sign-in is rejected regardless; recommend switching to single-tenant when convenient, not blocking). Set `AZURE_AD_TENANT_ID`/`AZURE_AD_CLIENT_ID` as App Service settings on both slots — confirmed live via `/api/config` (`configured: true`).
  4. **Found and fixed a real bug while wiring this up:** the frontend was requesting a Microsoft Graph access token (`scopes: ['User.Read']`) and sending it to a backend that validates the token's audience against our own client ID — those would never have matched (Graph tokens are audienced to Graph, not to our app). Fixed `login.component.ts` to use the ID token instead (audienced to our own client ID by construction, and carries the `roles` claim from this app's own App Roles) — rebuilt and redeployed to `dev`, reverified `/api/config`/`/api/health` still serve correctly.
- **Still open:**
  1. **Redirect URI platform type — RESOLVED.** User moved the redirect URI from "Web" to "Single-page application" and added both prod and dev callback URLs. Verified via browser automation (see below): navigating Microsoft's real `/authorize` endpoint with this client ID + redirect URI shows the genuine "Pick an account" screen with no `AADSTS` redirect-URI-mismatch error, and a manually-constructed request without PKCE parameters correctly gets rejected with `AADSTS9002325` (PKCE required for cross-origin code redemption) — this specific rejection only happens for the SPA platform type, confirming the platform switch is correctly in effect (the real MSAL popup flow always supplies PKCE itself, so this error is specific to my manual bypass test, not something a real user would hit).
  2. **App Roles — user reports created and assigned**, not yet independently verified (can't be, until a real interactive sign-in completes — see below).
  3. **`ralph-loop` polish pass not yet run.** The plan calls for a second `wtt-brand` + `ralph-loop` pass after the feature works, purely for visual/UX fine-tuning. Have not run this yet — flagging so it isn't silently skipped. Recommend running it once the user has had a chance to look at the login/change-password screens, in case they want to redirect the visual direction first.
  4. **MySQL major version upgrade (8.0 → 8.4) — DONE 2026-09-16.** User confirmed doing this now. `az mysql flexible-server upgrade --version 8.4` completed successfully (`fullVersion: 8.4.9`, `state: Ready`). Re-verified `/api/health/db` still returns `{"ok":true}` post-upgrade.
  5. **Browser-automated sign-in test, 2026-09-16.** Clicked "Sign In With Microsoft" on the live dev slot via Chrome automation. The popup opened for real (confirmed by the opener tab losing responsiveness to screenshot capture while it had focus) but the automated click can't complete the interactive steps inside it (account picker, possible MFA) — MSAL's own `loginPopup` timed out waiting (`BrowserAuthError: timed_out`), which is expected/correct behavior for an unattended click, not a bug. To get a real diagnostic without needing to complete a login, navigated Microsoft's `/authorize` endpoint directly in a separate tracked tab with the same client ID/redirect URI/tenant: got the genuine account picker (no config error), and confirmed PKCE enforcement as described in item 1. **A real interactive sign-in by the user themselves is the only way to fully confirm the round trip (App Roles → `roles` claim → backend validation → session cookie → dashboard) — asked the user to try it live.**
  6. **Found and fixed a debugging gap while testing:** `login.component.ts`'s AAD sign-in error handler was swallowing the actual exception behind a generic "Microsoft sign-in failed." message, making this kind of diagnosis impossible from the UI alone. Now logs the full error to the console and shows the specific error message/detail. **Revert to a generic user-facing message before Step 1's final sign-off** — the verbose detail is deliberately temporary for this debugging phase (Security Checklist E5 — don't leak internal library details to end users long-term).
- **Deployed and verified live** on the `dev` slot (`https://app-sportspres-assetmgmt-dev.azurewebsites.net`) — production slot deliberately left untouched (Claude Code's own safety layer correctly declined a direct production deploy before your review). Confirmed via live HTTP calls: `/api/health` ok, `/api/config` correctly shows AAD unconfigured, `/api/health/storage` ok **using the App Service's own Managed Identity** (not the developer's), `/api/health/db` fails with exactly the expected Directory-Readers-blocked error, and the Angular frontend serves correctly. One deployment-time issue found and fixed along the way: a failed DB seed at startup was crashing the *entire* process rather than just the DB-dependent routes — `server/src/index.js` now degrades gracefully instead (see QA doc D-05).

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
