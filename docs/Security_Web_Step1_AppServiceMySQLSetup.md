# Security Checklist — Step 1: Application, App Service and Database Environment Setup

Completed 2026-09-16. Environment: `app-sportspres-assetmgmt` (+ `dev` slot), `mysql-sportspres-assetmgmt`, `sasportspresentation`, resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | App Service → Storage Account access uses Managed Identity + RBAC only — no storage account key or SAS token stored anywhere in application settings, code, or source control | Pass | `src/storage/blobClient.js` uses `DefaultAzureCredential` exclusively. No `STORAGE_ACCOUNT_KEY`/connection-string setting exists on either slot. |
| A2 | App Service → MySQL access uses Managed Identity / Azure AD authentication only — no username/password connection string with an embedded secret | Pass (by design; functional connectivity blocked — see D-01 in QA doc) | `src/db/pool.js` only ever obtains a password via an AAD token (`DefaultAzureCredential`). No code path accepts a static MySQL password. The App Service's own identity cannot yet complete a real connection because `CREATE AADUSER` is blocked pending a Directory Readers grant (tracked separately, not a security gap in what's built). |
| A3 | RBAC role(s) granted to the Managed Identity are scoped to only what this step/application needs (least privilege), not subscription- or account-wide | Pass | Storage Blob Data Contributor granted at the **storage account** scope only, to each slot's identity individually — verified via `az role assignment list`. |
| A4 | Role-based access control (Super Admin / Administrator / Normal User) is enforced server-side for every action, not only hidden in the UI | Pass | `requireRole()` middleware and the change-password route's explicit role check run server-side; nothing in this step relies on the UI hiding a button. Only Step 1's routes exist so far — this must be re-checked as each later step adds routes. |
| A5 | Export Event action is genuinely inaccessible to a Normal User via direct API call | N/A at this stage | Export Event is not built until Step 7. |
| A6 | Default first-time admin password (`Admin@123`) has a documented, enforced path to being changed, and is never left at the default in a shared/production environment | Pass, with a follow-up | `/api/auth/change-password` works end-to-end (TC-13 in QA doc). There is currently no *forced* change on first login — changing it is possible but not mandatory. Recommend adding a `must_change_password` prompt in a later step; not blocking for Step 1. |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1–B3 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | All traffic to/from the App Service is HTTPS only | Pass | `httpsOnly: true` confirmed on both slots (Azure default, verified not overridden). |
| C2 | MySQL connection enforces TLS/SSL | Pass | Every connection path (`pool.js`, `migrate.mjs`, bootstrap/admin scripts) sets `ssl: { minVersion: "TLSv1.2" }`. |
| C3 | MySQL network access is restricted (private endpoint/VNet integration, or a documented, minimal firewall rule set) rather than open to all Azure services/all IPs by default | Pass, per approved decision | User explicitly chose firewall rules over VNet/private endpoint for this stage (documented in workflow.md). Rule set: `AllowAllAzureServicesAndResourcesWithinAzureIps` (the standard Azure-services rule) plus one rule for the developer's own IP (for admin/migration scripts) — no `0.0.0.0.0-255.255.255.255` open-to-internet rule exists. |
| C4 | CORS configuration on the App Service, if applicable, is restricted to known origins, not `*` | Pass | `src/app.js` uses an explicit allowlist (`CORS_ORIGIN`, defaults to `http://localhost:4200` only). No wildcard. In production, Angular and the API share one origin, so CORS is largely moot there. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Storage Account containers are not set to public/anonymous read access | Pass | Verified: `allowBlobPublicAccess: false` at the account level — no container can be made public regardless of individual container settings. |
| D2 | Data at rest (Storage Account, MySQL) uses default/standard Azure encryption at minimum | Pass | Both resources use Azure's default encryption-at-rest; nothing was configured to weaken this. |
| D3 | The `duration` value and other Sponsor Ad metadata are validated server-side | N/A at this stage | Sponsor Ads are not built until Step 3. |
| D4 | Uploaded file content is validated server-side against type/extension/size | N/A at this stage | File upload is not built until Steps 3–4. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | All user input is validated and sanitised against injection (SQL injection, path traversal) | Pass | `express-validator` on the login/change-password routes; every SQL statement in `src/` uses parameterised `mysql2` queries — no string-concatenated SQL exists anywhere in the codebase. |
| E2 | File upload size limits enforced server-side | N/A at this stage | No file upload yet. |
| E3 | Filenames validated to prevent path traversal | N/A at this stage | No file upload yet. |
| E4 | Session/authentication tokens are handled securely | Pass | Session is an httpOnly cookie (`secure` in production, `sameSite: lax`), signed JWT, 12-hour expiry. Not accessible to client-side JS. |
| E5 | Error messages returned to the client do not leak internal details | Pass | `src/middleware/errorHandler.js` returns a generic message in production; details only go to server-side `console.error`. |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No secrets are committed to source control | Pass | `.env` is git-ignored; `.env.example` contains no real values; the one-time MySQL bootstrap admin password was generated to the session scratchpad, never written inside the repo, and shown to the user once (see workflow.md) rather than persisted anywhere. |
| F2 | Any remaining secret is stored as an App Service application setting, never hard-coded | Pass | `SESSION_JWT_SECRET` was generated per-slot and set directly via `az webapp config appsettings set` — never appears in code or in this conversation's committed files. Section 29's email API key is N/A until Step 9 (Azure Communication Services Email chosen; no key exists yet since the resource isn't provisioned). |
| F3 | Application logs do not print secrets, access keys, or full connection strings | Pass | `errorHandler.js` and `auditLog.js` log usernames/paths/reasons only, never passwords or tokens. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Change log / Event Log Tab correctly capture actions for this step | N/A at this stage | The LED Asset Change Log is a Section 24 feature, built from Step 3/4 onward. |
| G2 | Failed/rejected actions are logged for audit, without logging sensitive data | Pass | Added in this step: `src/logging/auditLog.js`, wired into failed local logins (`local_login_failed`, reason only — never the attempted password) and forbidden role-check attempts (`forbidden_role_access`). |
| G3 | Basic application monitoring/alerting exists or is planned | N/A at this stage, noted for later | Not built yet. Recommend Application Insights on the App Service in a later step — not blocking Step 1. |

## H. Dependency & platform

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | No known-critical vulnerabilities in newly added dependencies | Pass | `npm audit` (production dependencies): **0 vulnerabilities** in both `server/` and `client/`. Angular was deliberately pinned to v20 (not the newest v21) specifically because v19.x had 3 high-severity CVEs (XSS/DoS) not yet backported at the time of this build; v20 is patched. Dev-only tooling vulnerabilities (babel/postcss, build-time only) were fixed via `npm audit fix`. |
| H2 | Runtime versions are supported/patched, not end-of-life | Pass | Node 24 LTS (App Service runtime `NODE:24-lts`, matches local dev Node v24.13.0). MySQL upgraded from 8.0.21 to **8.4.9 LTS** on 2026-09-16 (Azure flagged 8.0's standard support ending 2026-12-31; upgraded now while no real event data exists, per user's decision). |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | | | Pending |
| User (Vatsan) go-ahead | | | Pending |
