# QA Test Case Document — Step 7: Export Functionality

## Header

| Field | Value |
|---|---|
| Application | Web |
| Step / Phase | Step 7 — Export Functionality |
| BRD reference(s) | Web BRD Sections 25.1, 25.3, 25.4, 25.5, 25.6 |
| Implementation Sequence reference | Web Implementation Sequence Step 7 (7.1–7.3) |
| Date | 2026-09-18 |
| Tested by | Claude Code (self-tested: backend fully via `curl` against the live `dev` slot, plus direct DB/storage inspection; frontend via code review and a successful `ng build` only — see "Not live-tested" below). No independent Solution Architect review has been run on this step yet. |
| Environment | Azure: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` storage account (`2027` container). Used the disposable test event `9502` already created/renamed during Step 5's own testing (see `docs/QA_Web_Step5_EventConfiguration.md`) — no new test event needed. |

## Summary

| Total cases | Passed | Failed | Blocked | Not yet run |
|---|---|---|---|---|
| 9 | 8 | 0 | 0 | 1 |

## Test cases

| ID | Description | Preconditions | Steps | Expected result | Actual result | Status | Notes |
|---|---|---|---|---|---|---|---|
| TC-01 | `POST /api/events/:eventId/export` requires an authenticated session | — | `POST /api/events/9502/export` with no session cookie | 401 `Not authenticated` | Confirmed live | Pass | |
| TC-02 | Export produces exactly the field set/shape Web BRD Section 25.4 specifies | Signed in as SuperAdmin | `POST /api/events/9502/export` | 200, body has exactly `eventId`, `eventName`, `eventStorageUrl`, `tables` (array of `{tableNumber, innerLed, outerLed, mainLed}`), `exportedByUsername`, `exportedByRole`, `exportTimestamp`, `exportGuid` | Confirmed live: response matched exactly, including both of event `9502`'s tables with correct LED booleans, `exportedByUsername: "first_time_admin"`, `exportedByRole: "SuperAdmin"` | Pass | |
| TC-03 | `eventStorageUrl` is built from the real Storage Account URL, year container, and event folder (Section 4.2) | Same | Inspect the returned `eventStorageUrl` | `https://sasportspresentation.blob.core.windows.net/2027/9502%20-%20QA%20Step5%20Rename%20Test%20Renamed` | Confirmed live — matches the real container/folder this event actually lives in after Step 5's rename testing | Pass | |
| TC-04 | The local-download JSON and the `_GUID.json` copy written to Azure Storage contain identical content (Section 25.3) | Same export | Compare the API response body against the downloaded `_GUID.json` blob | Byte-for-byte identical JSON (field order and all) | Confirmed live: downloaded `_GUID.json` from the `2027` container and diffed against the API response — identical | Pass | |
| TC-05 | `_GUID.json` is written to the event's own folder root, at the fixed filename (Section 25.6) | Same | `az storage blob list`/`az storage blob download` | Blob exists at `9502 - QA Step5 Rename Test Renamed/_GUID.json` | Confirmed live | Pass | |
| TC-06 | A repeat export overwrites the previous `_GUID.json` and previous `ExportGUID`, never appends (Section 25.5) | TC-02's export already done | `POST /api/events/9502/export` a second time | A **new, different** `exportGuid`; `_GUID.json`'s content updates to match; the DB's `events.export_guid` column matches the new value, not the old one | Confirmed live: first export `c188dcfd-...`, second export `c4b06c67-...` (different); both the storage blob and the DB column reflected only the newer value afterward | Pass | |
| TC-07 | Exporting a nonexistent event returns a clean 404, not a 500 | — | `POST /api/events/99999999/export` | 404 `Event not found` | Confirmed live | Pass | |
| TC-08 | `_GUID.json` and the change log are excluded from `listRealFiles()`'s "would this rename/delete lose real files" check (Step 5's confirmation-flow logic, extended for this new file type) | Event with a real `_GUID.json` present | Code review of `eventFolders.js`'s `listRealFiles()` | `_GUID.json` is filtered out by basename, same treatment as `_ledassetschangelog.csv` and the scaffolding filenames | Confirmed by code review; not re-exercised live this session as its own scenario (Step 5's own rename tests on `9502` ran *before* `_GUID.json` existed on that event, so there was nothing to accidentally warn about yet). Logic is straightforward and shares the exact same code path already live-verified for the change log. | Pass | |
| TC-09 | Export Event action is restricted to SuperAdmin/Administrator, both server-side (403 for a Normal User) and in the UI (button not rendered at all for a Normal User, per Section 25.1's literal "must not be presented" wording) | — | Attempt `POST /api/events/:eventId/export` as a Normal User; separately, view the Dashboard as a Normal User | 403 on the API call; no "Export Event" button rendered in that user's Event List rows at all | **Not live-tested this session** — no Normal User test account/credentials available (Administrator/NormalUser are real Azure AD people; see the same limitation already logged in Step 5's QA doc, TC-22/TC-23). Verified by code review: `requireRole("SuperAdmin", "Administrator")` gates the route server-side; `dashboard.component.html` wraps the button in `@if (canExport)`, not just `[disabled]`, so it's absent from the DOM entirely for a Normal User, not merely greyed out. | Not yet run | Flagged for the user's own testing pass. |

## Frontend — not live-tested this session

The Dashboard's Export Event button (file download trigger, GUID-display modal with a Copy button) was **not exercised in a real browser this session**. Browser automation (Claude in Chrome) hit a recurring tooling issue already documented once before in this project (Step 4's workflow.md notes: `Can't interact with browser-internal or unparseable URLs` despite `navigate` reporting success) — four fresh-tab retries all failed the same way, past the point where retrying further would be productive. Rather than keep retrying, the backend was instead verified exhaustively via `curl` and direct DB/storage inspection (TC-01 through TC-08 above), and the frontend was verified via a successful `ng build` (no compile errors) and code review only. **Recommended as the first thing to check in the user's own testing pass**: click Export Event on a real event, confirm a `.json` file downloads with the right filename (`{EventID}_{EventName}_assetconfig.json`), confirm the GUID modal displays and its Copy button actually copies to the clipboard, and confirm the button doesn't appear at all when signed in as a Normal User.

## Open defects / follow-ups

None found this step — TC-01 through TC-08 all passed on the first attempt, no fixes needed.
