# Security Checklist — Step 3: Asset Upload – Sponsor Assets

Completed 2026-09-17. Environment: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` (`2026` container), resource group `rgsportspresentationsource`.

## A. Identity & access (Web Application)

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | File upload/delete uses the App Service's existing Managed Identity — no new keys/secrets introduced | Pass | `server/src/storage/sponsorAds.js` reuses `storage/blobClient.js`'s existing `DefaultAzureCredential`-based clients; no new credential material added in this step. |
| A2 | All Sponsor Ads routes require an authenticated session | Pass | `sponsorAdsRouter.use(requireSession, loadEventTableContext)` applies to every route in the router, not per-route — structurally guaranteed rather than relying on each handler remembering to check. Confirmed live (TC-18 in QA doc). |
| A3 | No role restriction beyond authentication, consistent with Step 2's reading of the BRD | Pass, as designed | Same reasoning as Step 2's Security Checklist A3: no BRD section restricts Sponsor Ad upload/management by role; Normal User is only restricted from user-CRUD and Export Event (Section 2.1). |

## B. Identity & access (Desktop Application)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | (Desktop app items) | N/A | This checklist covers the Web application only. |

## C. Network & transport

| # | Item | Status | Notes |
|---|---|---|---|
| C1 | No new network exposure introduced in this step | Pass | No new ports, CORS rules, or CSP changes; reuses Step 1's App Service/CORS/CSP configuration unchanged. Multipart uploads go through the existing HTTPS-only App Service endpoint. |

## D. Data protection

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | Uploaded files are stored under the existing, non-public storage account/containers | Pass | Reuses the existing `2026` container structure from Step 2; `allowBlobPublicAccess: false` at the account level (verified in Step 1) still applies. |
| D2 | Uploaded file content is validated server-side against type/size/dimensions before being persisted (Security Checklist E2/E3 from Step 1's template, now applicable) | Pass | `server/src/media/sponsorAdValidation.js` validates every file server-side (filename, format, resolution, bit depth, file size) before any blob write — never trusts the client-reported MIME type or extension alone; PNG/MP4 structure is parsed directly from the file bytes. |

## E. Application security

| # | Item | Status | Notes |
|---|---|---|---|
| E1 | SQL injection | Pass | The one new query (`loadEventTableContext` in `sponsorAds/routes.js`) is parameterised via `mysql2` placeholders, consistent with every other query in the codebase. |
| E2 | Path traversal via user-controlled filenames | Pass | Filenames come from the multipart upload's `originalname` (upload route) or the URL path (`delete`, duration-retrieval routes) - both attacker-controlled - and are used directly as blob names within a fixed, server-computed folder path (`Table N/inner\|outer/`). Azure Blob Storage's flat namespace means `/`/`..` can't actually escape that prefix, but a filename containing `/` or control characters is now explicitly rejected (`isBlobSafeFilename()` in `media/sponsorAdValidation.js`, applied via `validateFilename()` on upload and via the `requireBlobSafeFilename` middleware on delete/duration-retrieval) as defense-in-depth, consistent with Step 2's `eventId`/`eventName` check. Caught during this checklist's own write-up rather than left as an open item - fixed same day. |
| E3 | File type is validated by actual content, not just extension/MIME type | Pass | `parsePngHeader`/`parseMp4Metadata` read the real file bytes (PNG signature + IHDR chunk; MP4 `moov`/`tkhd`/`mvhd` boxes) rather than trusting the client-supplied `Content-Type` header or file extension alone - a file renamed to `.png` without valid PNG bytes is rejected. |
| E4 | File upload size limits enforced server-side | Pass | `multer`'s own `limits.fileSize` is set to `config.maxVideoUploadMb` (100MB, Web BRD Section 27.1) as a hard ceiling on the whole request; `sponsorAdValidation.js` applies the tighter 4MB image-specific limit on top. Both enforced server-side, not just in the Angular form. |
| E5 | Filename content restrictions (Web BRD Section 12) cannot be bypassed by calling the API directly | Pass | Enforced in `validateFilename()` (`media/sponsorAdValidation.js`), called from the upload route before any storage write - confirmed by testing directly via curl, not just through the UI (TC-07/TC-08 in QA doc). |
| E6 | Business-rule validation (destination availability per Section 11.1) cannot be bypassed by calling the API directly | Pass | `requireValidDestination` middleware runs server-side on every route in the router; confirmed live that `main` and a disabled `inner`/`outer` are both rejected via direct curl calls (TC-10/TC-11). |
| E7 | Error messages returned to the client do not leak internal details | Pass | Reuses Step 1's `errorHandler.js` (generic message in production); per-file upload rejection messages are validation-specific but contain no storage paths, stack traces, or account details. |
| E8 | Concurrent writes to the same event's change log, or to the same table/destination's `sponsorsequence.csv`, cannot silently lose an entry | **Fail, then Fixed 2026-09-17** | **Independent architect review caught this**: `appendChangeLogEntry()` (`logging/assetChangeLog.js`) already used ETag-conditional writes with retry, but `saveSponsorAdSequence()`/`removeFromSponsorAdSequence()` (`storage/sponsorAds.js`) did an unconditional overwrite with no concurrency protection at all - two concurrent requests touching the same table/destination's sequence file (e.g. a Save Sequence racing a Delete) could silently lose one side's update. Fixed: both now use the same ETag-conditional-write-with-retry pattern as the change log (up to 5 attempts, re-reading current state on each retry for the delete-triggered removal path specifically, since that path's own logic depends on current state). |
| E9 | Uploaded file batches cannot exhaust server memory before validation runs | **Fail, then Fixed 2026-09-17** | **Independent architect review caught this**: `multer`'s `memoryStorage()` buffers the entire multipart body into process memory before any handler or validation code runs; the original config only capped per-file size (`fileSize`), with no limit on the number of parts in one request - an authenticated user could send many near-100MB parts in a single request and exhaust worker memory before a single file was validated or rejected. Fixed: added `limits.files: 50` to the `multer()` config in `sponsorAds/routes.js`. |

## F. Secrets management

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | No new secrets introduced in this step | Pass | `multer` (the one new dependency) requires no credentials; reuses Step 1's Managed-Identity-only credential chain end to end. |

## G. Logging, monitoring & audit

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Every upload/update/delete action is attributable to a user and recorded (Web BRD Section 24) | Pass | `appendChangeLogEntry()` is called for every New/Updated/Deleted action, populated from `req.user.username` (the authenticated session), not client-supplied input. Verified live (TC-15). |
| G2 | Change Log Email Notification / Event Log Tab | N/A at this stage | Step 9's scope - this step only writes the underlying CSV that Step 9 will later email/display. |

## H. Dependency & platform

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | New dependency (`multer`) is `npm audit`-clean | Pass | `npm audit`: 0 vulnerabilities in `server/` after adding `multer`. |
| H2 | No native binaries or platform-specific dependencies introduced | Pass, by design | Deliberately avoided an `ffmpeg`/`ffprobe`-based approach for video metadata (duration/resolution) specifically to avoid cross-platform binary staging risk between the Windows dev machine and the Linux App Service - `media/mp4Metadata.js` and `media/pngMetadata.js` are both pure-JS, dependency-free parsers, verified against real sample files (TC-03/TC-04). |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | (fresh subagent, no prior context) | 2026-09-17 | Approved with notes — found the E8/E9 gaps documented above (sequence-file concurrency, unbounded upload batch size) plus a functional gap (Section 14 distribution model, see workflow.md and QA doc D-05). All fixed and re-verified live same day. |
| User (Vatsan) go-ahead | | 2026-09-17 | Approved. |
