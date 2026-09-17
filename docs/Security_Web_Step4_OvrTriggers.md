# Security Checklist — Step 4: Asset Upload – OVR Triggers (Backend)

Backend and frontend completed 2026-09-17, independent Solution Architect review completed the same day. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` (`2026` container), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | File upload/delete/copy uses the App Service's existing Managed Identity — no new keys/secrets introduced | Pass | `server/src/storage/ovrTriggers.js` reuses `storage/blobClient.js`'s existing `DefaultAzureCredential`-based container client; no new credential material added in this step. |
| A2 | All OVR Trigger routes (table-scoped and RPI) require an authenticated session | Pass | `ovrTriggersRouter.use(requireSession, loadEventTableContext)` and `rpiRouter.use(requireSession, loadEventContext)` apply to every route in each router, not per-route — structurally guaranteed, same pattern as Step 3. Confirmed live (TC-22 in QA doc). |
| A3 | No role restriction beyond authentication, consistent with Steps 2/3's reading of the BRD | Pass, as designed | Same reasoning as Steps 2/3: no BRD section restricts OVR Trigger upload/management by role. |
| A4 | New `/api/asset-rules` endpoint (view-only "Asset Management Settings" reference, added during this step's UI/UX pass) requires an authenticated session; returns no secrets | Pass | `assetRulesRouter.use(requireSession)` gates the whole router; the response is exclusively naming/validation rule metadata (filenames, formats, resolutions) already visible to any authenticated user via the upload UI itself - nothing new is exposed, just presented in one place. Read-only, no write route exists (Step 5 will add Edit/Save, Admin/Super Admin only). |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new network exposure introduced in this step | Pass | No new ports, CORS rules, or CSP changes; reuses the existing App Service/CORS/CSP configuration. Multipart uploads and preview downloads go through the existing HTTPS-only App Service endpoint. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Uploaded/copied files are stored under the existing, non-public storage account/containers | Pass | Reuses the existing per-year container structure; `allowBlobPublicAccess: false` at the account level (verified in Step 1) still applies. |
| D2 | Uploaded file content is validated server-side against type/resolution/size before being persisted | Pass | `server/src/media/ovrTriggerValidation.js` validates every file server-side (filename rule, PNG/MP4 structure, resolution, bit depth for images, size) before any blob write — reuses Step 3's byte-level parsers (`pngMetadata.js`/`mp4Metadata.js`), never trusts client-reported MIME type or extension alone. |
| D3 | Internal copy operations (`additionalCopy`, All Sponsor Logo's dual-folder save, Winning Moment fallback) read/write only within the same event's own storage scope | Pass | `copyOvrTriggerFileWithinFolder()` and the dual-destination save loop both operate on `ctx` objects built exclusively from the already-validated `eventId`/`tableNumber`/`destination` — no user-supplied path component is used in constructing the copy target. |
| D4 | Dual-folder writes/deletes (All Sponsor Logo) only touch destinations the table has actually enabled | **Fail, then Fixed 2026-09-17** | **Independent architect review caught this, live**: `saveToBothInnerAndOuter`'s loop wrote into both `inner` and `outer` unconditionally, regardless of whether the sibling destination was enabled for that table — created an orphaned, app-unmanageable `outer` folder on a table with Outer LED disabled. Fixed: both the upload and delete handlers now filter against `req.eventContext.table`'s own `innerLed`/`outerLed` flags. See QA doc D-02. |
| D5 | A file mutation triggered as a side effect of another action does not silently destroy an unrelated, independently-managed asset | **Fail, then Fixed 2026-09-17** | **Independent architect review caught this, live**: deleting a Home Look image also unconditionally deleted `default.png` (the `additionalCopy` target) — but `default.png` is also the independently-manageable Default Assets slot, so this could silently destroy a Default Image a user had separately uploaded afterward, with no audit trail either. Fixed: the cascade-delete was removed (the relationship is now one-directional, upload-only); the upload-side write is now change-logged. See QA doc D-03. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | The two new queries (`loadEventTableContext` in `ovrTriggers/routes.js`, `loadEventContext` in `rpiRoutes.js`) are parameterised via `mysql2` placeholders, consistent with every other query in the codebase. |
| E2 | Path traversal via user-controlled filenames | Pass | Filenames come from the multipart upload's `originalname` (attacker-controlled) and are used directly as blob names within a fixed, server-computed folder path. Azure Blob Storage's flat namespace means `/`/`..` can't actually escape that prefix, but `isBlobSafeFilename()` (reused unchanged from Step 3's `sponsorAdValidation.js`) is still applied to every upload as defense-in-depth, consistent with Steps 2/3. Not independently re-verified live this step for the literal slash case (client tooling used for testing normalizes it away before it reaches the server) — this is the same function already verified live in Step 3, applied here without modification. |
| E3 | File type is validated by actual content, not just extension/MIME type | Pass | `validateOvrTriggerMedia()` reuses `parsePngHeader`/`parseMp4Metadata`, which read real file bytes rather than trusting the client-supplied `Content-Type` header or file extension alone. |
| E4 | File upload size limits enforced server-side | Pass | `multer`'s `limits.fileSize` is set to `config.maxVideoUploadMb` (100MB) on both the table-scoped and RPI routers, same as Step 3; `IMAGE_SPEC.maxBytes` (4MB, reused from Step 3) applies on top for images. Both enforced server-side. |
| E5 | Upload batch size cannot exhaust memory before validation runs | Pass | Both routers use `upload.single("file")` (one file per OVR Trigger upload request, unlike Sponsor Ads' multi-file batches) with `limits.files: 1` explicitly set — there is no equivalent batch-size attack surface to the one Step 3's D-06/E9 fixed, since only one file part is ever accepted per request. |
| E6 | Filename/business-rule validation (Section 17's per-trigger-type filename rules, Section 16/3.1's per-destination LED-config gating, Section 22's Inner/Outer-only All Sponsor Logo) cannot be bypassed by calling the API directly | Pass | All enforced server-side in `validateOvrTriggerFilename()`, `requireValidDestination`, and `resolveAssetSlot()` respectively — confirmed by direct curl testing bypassing any UI (TC-07, TC-09, TC-18, TC-19 in QA doc). |
| E7 | Error messages returned to the client do not leak internal details | Pass | Reuses the existing `errorHandler.js` (generic message in production); per-file rejection messages are validation-specific but contain no storage paths, stack traces, or account details. |
| E8 | Every action that changes a file's real content on disk is recorded in the change log, including ones triggered indirectly (Web BRD Section 24) | **Fail, then Fixed 2026-09-17** | Caught during this checklist's own write-up, mirroring Step 3's E8-adjacent finding: `applyWinningMomentFallback()`'s auto-copy of `default.mp4` into `winner.mp4` changed real blob content without any change-log entry. Fixed: it now logs its own `New` entry whenever it performs the copy. See QA doc D-01. |
| E9 | `sponsorsequence.csv` / change-log concurrency protections are not weakened or duplicated incorrectly by this step | Pass, unchanged | This step's only change-log writes go through the same unmodified `appendChangeLogEntry()` (ETag-conditional-write-with-retry, built in Step 3); no new concurrent-write surface was introduced (OVR Trigger slots are single-file, not a shared sequence file like Sponsor Ads). |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced in this step | Pass | No new dependencies added; reuses the existing Managed-Identity-only credential chain end to end. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Every upload/delete action, including indirectly-triggered ones, is attributable to a user and recorded (Web BRD Section 24) | Pass (after E8 fix) | `appendChangeLogEntry()` is called for every New/Deleted action across all trigger types, All Sponsor Logo's dual-folder save, RPI, and now the Winning Moment fallback's auto-copy — all populated from `req.user.username` (the authenticated session), never client-supplied input. Verified live (TC-15, TC-23). |
| G2 | Change Log Email Notification / Event Log Tab | N/A at this stage | Step 9's scope. |

## H. Dependency & platform

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | No new dependencies introduced this step | Pass | `npm audit`: 0 vulnerabilities in `server/`; this step adds no new packages, reusing `multer` and the pure-JS media parsers from Step 3. |
| H2 | No native binaries or platform-specific dependencies introduced | Pass, by design | Same reasoning as Step 3 — `ovrTriggerValidation.js` reuses the dependency-free `pngMetadata.js`/`mp4Metadata.js` parsers rather than introducing `ffmpeg`/`ffprobe`. |
| H3 | `asset_management_templates.json`'s actual location and content is correctly reconciled against the code that's supposed to implement it | **Fail, then Fixed 2026-09-17** | **Independent architect review caught this**: the config file was believed not to exist anywhere; it actually exists at `references/0forimplementation/web/asset_management_templates.json`. Cross-checking against it found `templateConfig.js`'s Main LED Home Look image filename (`HOME_Look.png`) diverged from the real config's `HOME_Look` (no extension), which also matches BRD Section 20's literal text. Fixed: `templateConfig.js` corrected; every other entry in the file was independently cross-checked and matched. See QA doc D-04, D-06. |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | (fresh subagent, no prior context) | 2026-09-17 | Approved with notes — found D4/D5/H3 above (two real data-integrity/audit gaps, one config-accuracy correction) via its own independent live testing against a throwaway test event, plus verified auth/RBAC, filename/resolution validation, path-safety, `npm audit`, and `ng build` all held. All findings fixed and re-verified live same day; the H3 fix's first attempt introduced a second, self-contained bug (metadata key casing) which was also caught and fixed before sign-off. |
| User (Vatsan) go-ahead | | | Pending. |
