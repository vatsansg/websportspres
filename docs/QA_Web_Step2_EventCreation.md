# QA Test Case Document — Step 2: Event Creation and Event Configuration

## Header

| Field | Value |
|---|---|
| Application | Web |
| Step / Phase | Step 2 — Event Creation and Event Configuration |
| BRD reference(s) | Web BRD Sections 3.1, 4, 5, 6, 7, 7.1, 9, 31 |
| Implementation Sequence reference | Web Implementation Sequence Step 2 |
| Date | 2026-09-16 |
| Tested by | Claude Code (self-tested; independent architect review pending) |
| Environment | Azure: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` storage account (`2026` container). |

## Summary

| Total cases | Passed | Failed | Blocked | Not yet run |
|---|---|---|---|---|
| 16 | 15 | 0 | 0 | 1 |

## Test cases

| ID | Description | Preconditions | Steps | Expected result | Actual result | Status | Notes |
|---|---|---|---|---|---|---|---|
| TC-01 | Create event with a single table, all three LED types enabled | Logged in as Super Admin against the live `dev` slot | `POST /api/events` with `eventId: QATEST1`, one table, Inner+Outer+Main all true | 201, `event_tables`/`events` rows created, full folder structure created in the `2026` container | Confirmed live: 201 response, DB rows correct (`inner_led/outer_led/main_led = 1/1/1`), blobs created: event-level `keepalive.txt` + `_ledassetschangelog.csv`, `rpi/keepalive.txt`, `Table 1/{keepalive.txt, inner/{keepalive.txt,sponsorsequence.csv}, outer/{keepalive.txt,sponsorsequence.csv}, mainled/keepalive.txt}` | Pass | |
| TC-02 | Create event with two tables, mixed LED configs (Table 1 all three, Table 2 Main only) | TC-01 passed | Same request, second table `mainLed: true` only | Table 2 gets only `keepalive.txt` + `mainled/keepalive.txt`, no `inner`/`outer` folders | Confirmed live: `Table 2/keepalive.txt` and `Table 2/mainled/keepalive.txt` only — no `inner`/`outer` subfolders created | Pass | |
| TC-03 | Duplicate Event ID rejected | TC-01's event exists | `POST /api/events` again with `eventId: QATEST1` | 409, event/storage not touched again | Confirmed live: `409 {"error":"Event ID \"QATEST1\" already exists"}` | Pass | |
| TC-04 | Event Name containing "WTT" rejected (case-insensitive) | — | `POST /api/events` with `eventName: "WTT Grand Final"` | 400, no DB/storage side effects | Confirmed live: `400`, `"Event Name must not contain \"WTT\""` | Pass | |
| TC-05 | Outer LED without Inner LED rejected | — | `POST /api/events` with a table `innerLed: false, outerLed: true` | 400 (post-004 rule: Outer requires Inner) | Confirmed live: `400`, `"Table 1: Outer LED requires Inner LED to also be selected"` | Pass | |
| TC-06 | Event without Table 1 rejected | — | `POST /api/events` with only `tableNumber: 2` | 400 (Web BRD Section 9: Table 1 mandatory) | Confirmed live: `400`, `"Table 1 is required for every event"` | Pass | |
| TC-07 | Table with no LED type selected rejected | — | `POST /api/events` with a table where inner/outer/main all `false` | 400 | Confirmed live: `400`, `"Table 1: at least one LED type must be selected"` | Pass | |
| TC-08 | Unauthenticated request rejected | No session cookie | `POST /api/events` with no cookie | 401 | Confirmed live: `401 {"error":"Not authenticated"}` | Pass | |
| TC-09 | Path-traversal-style Event ID rejected | — | `POST /api/events` with `eventId: "../evil"` | 400 — rejected before it can affect blob path construction | Confirmed live: `400`, `"Invalid value"` on `eventId` (fails `BLOB_SAFE_PATTERN`) | Pass | Security-relevant: `eventId`/`eventName` are used directly to build blob paths (`storage/eventFolders.js`); this proves the "/" and control-character block works, not just that some rejection happens. |
| TC-10 | `sponsorsequence.csv` placed only in Inner/Outer folders, never Main LED or `rpi` (Web BRD Section 7.1) | TC-01, TC-02 passed | Inspect the full blob listing from TC-01/TC-02 | No `sponsorsequence.csv` under any `mainled/` or `rpi/` path | Confirmed: blob listing shows `sponsorsequence.csv` only under `Table 1/inner/` and `Table 1/outer/` — none under `mainled/` or `rpi/` | Pass | |
| TC-11 | Folder/filename conventions match the real, pre-existing sample event (`1111 - Champions Montpellier`) for Desktop-app interoperability | — | Compare TC-01/TC-02's blob names against the real sample's structure | Lowercase `inner`/`outer`/`mainled` subfolder names; change log filename `_ledassetschangelog.csv` (matching the templates container's actual, typo'd filename, not the BRD prose's `_ledassetchangelog.csv`) | Confirmed: all new folders use the same lowercase convention and the same change-log filename as the real sample event and the real templates container blob | Pass | Deliberate deviation from the BRD's literal prose casing — see workflow.md Step 2 deviations for the full reasoning (this sample was named authoritative by the user at kickoff). |
| TC-12 | Create Event UI: full end-to-end flow (login → fill form → submit → success) | Deployed to `dev` | Browser: sign in as Super Admin, click "Create Event", fill Event ID/Name, add a second table, toggle Outer on Table 2, submit | Event created (`QAUI1`), confirmation panel shown, matching DB/storage artifacts created | Confirmed via live browser automation: form submitted successfully, storage listing for `QAUI1 - QA UI Test Event` shows Table 1 (Inner only) + Table 2 (Inner+Outer) folders exactly as configured in the UI. (Originally auto-navigated to the dashboard on success — replaced with an in-page confirmation panel per user feedback, see TC-16.) | Pass | |
| TC-13 | Create Event UI: Outer LED checkbox is disabled/unchecked when Inner is unchecked | TC-12 environment | In the form, uncheck Inner LED on a table that had Outer checked | Outer checkbox becomes disabled and is unchecked automatically | Confirmed via screenshot inspection during TC-12 — `onInnerToggle()` clears `outerLed` when `innerLed` is unchecked, and the checkbox gets `[disabled]="!table.innerLed"` | Pass | |
| TC-14 | DB rows are rolled back if Azure Storage folder creation fails partway | — | Force a storage failure after the DB transaction commits (e.g. revoke the app identity's Storage RBAC mid-request) and attempt event creation | `events`/`event_tables` rows for the attempted event do not exist afterward; storage partial artifacts (if any) are also cleaned up | **Not run** — deliberately did not revoke live production RBAC to force this failure path, to avoid disrupting the shared `dev` slot's real storage access mid-session. Code path reviewed: `server/src/events/routes.js`'s `catch` block deletes the just-inserted `events` row (cascades to `event_tables`) and calls `deleteEventStorageStructure` before rethrowing. | Not run | Low risk — the rollback logic is simple, synchronous, and directly reviewable; flagging honestly rather than claiming a live pass with no evidence, consistent with Step 1's TC-15 approach. Could be closed out with a dedicated integration test harness in a later step if desired. |
| TC-15 | Event ID must be numeric — non-numeric IDs rejected (user-reported, post-review fix) | — | `POST /api/events` with `eventId: "ABC123"`; separately, in the UI, type a non-numeric Event ID | 400 server-side; client-side `validate()` also rejects it before submit | Confirmed live: `400`, `"Event ID must be numeric"`. Server: `NUMERIC_PATTERN` (`/^[0-9]+$/`) in `server/src/events/routes.js`. Client: same pattern in `create-event.component.ts`'s `validate()`, plus `inputmode="numeric"`/`pattern="[0-9]+"` on the input. A valid numeric ID (`9001`) confirmed still succeeds (201). | Pass | Kept as a string (not converted to a number) so leading zeros are preserved and the existing `VARCHAR(20)` column needs no migration. |
| TC-16 | Post-creation confirmation shows save + storage-folder-creation confirmation (user-reported, post-review fix) | — | Browser: submit the Create Event form successfully | An in-page confirmation panel appears (not a native browser popup) showing the Event ID/Name/Year and the Azure Storage location, with "Go to Dashboard" and "Create Another Event" actions — no silent auto-navigation | Confirmed via live browser automation (event `9002`): panel rendered with the exact confirmation text and the real `eventStorageUrl` returned by the API; "Create Another Event" correctly reset the form to its default empty state | Pass | Deliberately built as an in-page `.wtt-success` panel (consistent with the change-password page's existing pattern) rather than a native `alert()`/`confirm()` dialog, for consistency with the rest of the app and better accessibility (`role="status"`). |

## Open defects / follow-ups

| ID | Linked test case | Description | Severity | Status |
|---|---|---|---|---|
| D-01 | — | `az storage blob delete-batch` (AAD auth mode) failed with "Failed Precondition" for every blob during QA cleanup; individually looping `az storage blob delete` worked once RBAC had propagated. | Low — QA/cleanup tooling issue only, not an application bug | Resolved for this session's cleanup; not investigated further since it's an Azure CLI quirk unrelated to the app itself. |
| D-02 | TC-14 | DB-rollback-on-storage-failure path is code-reviewed but not live-exercised | Low | Open — see TC-14 notes. |
| D-03 | TC-15 | While cleaning up QA test events `9001`/`9002` after this fix, deleted their `events`/`event_tables` DB rows without first having Storage Blob Data Contributor access to also delete the matching storage blobs — leaving orphaned blob folders (`2026/9001 - QA Numeric Verify Event/`, `2026/9002 - QA Browser Confirm Panel/`) with no corresponding DB row. This is the exact "ghost" state the app's own rollback logic (see TC-14/D-02) is designed to prevent, self-inflicted by QA cleanup rather than the application. | Low — dev-slot QA data only, but a real inconsistency: Event IDs `9001`/`9002` are technically free again in the DB and could collide with these leftover blobs if reused | Open — flagged to the user directly; needs Storage Blob Data Contributor access to delete the two blob prefixes above. |

## Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Independent Solution Architect review | | | Pending |
| User (Vatsan) go-ahead | | | Pending |
