# QA Test Case Document — Step 1: Application, App Service and Database Environment Setup

## Header

| Field | Value |
|---|---|
| Application | Web |
| Step / Phase | Step 1 — Application, App Service and Database Environment Setup |
| BRD reference(s) | Web BRD Sections 1, 2.1, 2.2, 5 |
| Implementation Sequence reference | Web Implementation Sequence Step 1.1–1.5 |
| Date | 2026-09-16 |
| Tested by | Claude Code (self-tested; independent architect review pending) |
| Environment | Azure: `app-sportspres-assetmgmt` (production) + `dev` slot, `mysql-sportspres-assetmgmt` (databases `assetmgmt` / `assetmgmt_dev`), `sasportspresentation` storage account. Local: `az login` session used in place of Managed Identity for developer-side smoke testing. |

## Summary

| Total cases | Passed | Failed | Blocked | Not yet run |
|---|---|---|---|---|
| 14 | 9 | 0 | 4 | 1 |

Any Failed or Blocked case must have a corresponding note in "Open defects / follow-ups" below.

## Test cases

| ID | Description | Preconditions | Steps | Expected result | Actual result | Status | Notes |
|---|---|---|---|---|---|---|---|
| TC-01 | App Service Plan provisioned, Linux, Standard tier | Azure access confirmed | 1. `az appservice plan show -n asp-sportspres-assetmgmt` | Plan exists, `reserved: true` (Linux), SKU S1 | Confirmed via `az appservice plan create` output: Linux, Standard, `provisioningState: Succeeded` | Pass | |
| TC-02 | Production App Service + dev deployment slot exist | TC-01 passed | 1. `az webapp list --resource-group rgsportspresentationsource` | `app-sportspres-assetmgmt` and its `dev` slot both exist and are `Running` | Both created; hostnames `app-sportspres-assetmgmt.azurewebsites.net` and `-dev.azurewebsites.net` | Pass | |
| TC-03 | HTTPS-only enforced, min TLS 1.2, FTP disabled | TC-02 passed | 1. `az webapp config show` on both prod and dev | `httpsOnly: true`, `minTlsVersion: 1.2`, `ftpsState: Disabled` | Confirmed on both slots | Pass | |
| TC-04 | System-assigned Managed Identity exists per slot | TC-02 passed | 1. `az webapp identity show` on prod and dev | Each slot has its own distinct `principalId` | Prod `33a4e55a-...`, dev `375425bf-...` — confirmed distinct | Pass | |
| TC-05 | Managed Identity has least-privilege Storage RBAC | TC-04 passed | 1. `az role assignment list --scope <storage account>` | Both identities hold **Storage Blob Data Contributor**, scoped to the storage account only (not subscription/RG) | Confirmed for both principals, scope = storage account resource ID | Pass | |
| TC-06 | App Service → Storage connectivity via Managed Identity, no keys anywhere | TC-05 passed | 1. Hit `/api/health/storage` running under the App Service's own identity | `{ ok: true }`, no `AZURE_STORAGE_KEY`/connection string present in App Service settings | **Not yet run against the deployed App Service** — deployment package build ran locally; local smoke test used the developer's own `az login` identity (which also has implicit data-plane access via subscription Owner), not the App Service's identity. See TC-06b. | Not run | Needs re-verification by curling the *deployed* `/api/health/storage` once the app is live, to prove the Storage RBAC granted to the Managed Identity is what's actually working, not the developer's broader Owner role. |
| TC-06b | Local dev proves the *code path* against Storage | — | 1. `node src/index.js` locally with `.env` pointing at real storage/DB, using `az login` credential | `/api/health/storage` returns `{ ok: true }` | Confirmed `{ ok: true }` | Pass | Proves the SDK/credential-chain code is correct; does not by itself prove the App Service's identity (different principal) has sufficient rights — TC-05's explicit role assignment is the evidence for that. |
| TC-07 | MySQL Flexible Server provisioned, General Purpose, Standard tier, firewall (not VNet) | Azure access confirmed | 1. `az mysql flexible-server show` | `state: Ready`, tier `GeneralPurpose`, SKU `Standard_D2ds_v4`, firewall rule `AllowAllAzureServicesAndResourcesWithinAzureIps` present | Confirmed | Pass | |
| TC-08 | Two databases exist on the one shared server (prod + dev) | TC-07 passed | 1. Connect as AAD admin, `SHOW DATABASES` | `assetmgmt` and `assetmgmt_dev` both exist | Confirmed via `create-databases.mjs` | Pass | |
| TC-09 | Full schema applied to both databases | TC-08 passed | 1. Run `scripts/migrate.mjs` against each database | `users`, `events`, `event_tables` tables created, migrations tracked in `schema_migrations` | Confirmed — `migrate.mjs` output showed all 3 migrations applied to both `assetmgmt` and `assetmgmt_dev` | Pass | |
| TC-10 | `event_tables` enforces Web BRD Section 3.1 LED rules at the DB layer | TC-09 passed | 1. Attempt `INSERT` with `outer_led=1, inner_led=0, main_led=0` (outer alone) 2. Attempt `INSERT` with `outer_led=1, main_led=1` (outer+main) 3. Attempt `INSERT` with all three `= 0` | All three inserts rejected by `CHECK` constraints | **Not yet run** — constraints are in the migration SQL (`chk_at_least_one_led`, `chk_outer_not_with_main`, `chk_outer_not_alone`) but no test data has been inserted yet to exercise them | Not run | To be exercised in Step 2, when event/table creation is built — flagging here since the constraints were added in this step's schema. |
| TC-11 | App Service → MySQL connectivity via Managed Identity (no password) | TC-05, TC-09 passed | 1. Grant Directory Readers to `uami-mysql-sportspres-assetmgmt` (blocked — see below) 2. Run `bootstrap-mysql-aad.mjs` to create AAD-mapped MySQL users for both App Service identities 3. Deploy app, hit `/api/health/db` | `{ ok: true }`, connecting as `app-sportspres-assetmgmt` / `app-sportspres-assetmgmt-dev` MySQL users with no password/connection string anywhere | **Blocked.** Directory Readers role could not be granted (insufficient Graph permission on the developer's account) — see workflow.md. `CREATE AADUSER` cannot run until it is. | Blocked | Needs a tenant directory admin (Privileged Role Administrator/Global Administrator) to grant Directory Readers to principal `5514ec52-fbe8-4a86-b771-566fac4d67b8` (see handoff notes). User has chosen this resolution path over disabling `aad_auth_validate_oids_in_tenant`. |
| TC-12 | Super Admin default account seeded, login works end-to-end | TC-09 passed | 1. Start server locally 2. `POST /api/auth/login` with `first_time_admin` / `Admin@123` 3. `GET /api/auth/me` with returned cookie | Login succeeds, session cookie issued, `/me` returns `{ username: "first_time_admin", role: "SuperAdmin" }` | Confirmed exactly this, both calls succeeded | Pass | |
| TC-13 | Super Admin change-password works and rejects wrong current password | TC-12 passed | 1. `POST /api/auth/change-password` with wrong `currentPassword` 2. Retry with correct current password and a valid new password | Step 1 rejected (401); Step 2 succeeds (200) | **Not yet run** — endpoint exists and was code-reviewed but not exercised in this smoke test | Not run | Straightforward to run before user sign-off; recommend running before final go-ahead. |
| TC-14 | Administrator/Normal User Azure AD login | AAD app registration completed by WTT IT | 1. Sign in via "Sign In With Microsoft" 2. Confirm role read from the `roles` claim maps correctly to Administrator/NormalUser | Session cookie issued with correct role | **Blocked** — Azure AD app registration not yet completed by WTT IT (tenant/client ID not configured); `/api/config` correctly reports `azureAd.configured: false` in the meantime | Blocked | Cannot be tested until WTT IT completes the numbered instructions given in this step's handoff. |
| TC-15 | Normal User cannot access Super Admin change-password endpoint | TC-14 | 1. As a Normal User session, `POST /api/auth/change-password` | 403 Forbidden | **Blocked** — depends on TC-14 (no AAD session obtainable yet) | Blocked | Code enforces `req.user.role !== 'SuperAdmin'` check; logic reviewed, not yet exercised against a real AAD session. |

## Open defects / follow-ups

| ID | Linked test case | Description | Severity | Status |
|---|---|---|---|---|
| D-01 | TC-11 | MySQL Managed-Identity connectivity for the App Service itself is blocked pending a tenant directory admin granting "Directory Readers" to `uami-mysql-sportspres-assetmgmt` (principal `5514ec52-fbe8-4a86-b771-566fac4d67b8`) | High — Step 1's "Definition of Done" requires end-to-end MySQL connectivity via Managed Identity | Open — waiting on WTT IT/tenant admin |
| D-02 | TC-14, TC-15 | Administrator/Normal User Azure AD login cannot be tested until WTT IT completes the app registration (tenant ID, client ID) | High — blocks role-based testing for 2 of 3 roles | Open — waiting on WTT IT |
| D-03 | TC-06 | Storage connectivity has only been proven end-to-end using the developer's own (Owner-level) identity, not yet the App Service's actual Managed Identity | Medium — RBAC assignment (TC-05) is in place and should work, but hasn't been proven against the live deployed app yet | Open — re-verify once app is deployed and reachable |
| D-04 | TC-10, TC-13 | A few test cases were written but not yet executed (DB constraint checks, change-password happy/unhappy path) | Low | Open — recommend running before final sign-off |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | | | Pending |
| User (Vatsan) go-ahead | | | Pending |
