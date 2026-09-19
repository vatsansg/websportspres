# QA Test Case Document — Step 9: Change Log Email Notification and Event Log Tab

## Header

| Field | Value |
|---|---|
| Application | Web |
| Step / Phase | Step 9 — Change Log Email Notification (Web BRD Section 29) and Event Log Tab (Section 30) |
| BRD reference(s) | Web BRD Sections 29, 30 |
| Implementation Sequence reference | Web Implementation Sequence Step 9 |
| Date | Built 2026-09-19; redesigned through five rounds of live user feedback the same day (see workflow.md's Step 9 write-up for the full history) |
| Tested by | Claude Code (backend via `curl` against the live `dev` slot; frontend via live browser testing, including direct interaction in the user's own already-open, already-authenticated browser tab via Claude-in-Chrome) and the user directly (multiple live test passes, each surfacing real defects that were fixed and redeployed). No independent Solution Architect review has been run on this step yet. |
| Environment | Azure: `app-sportspres-assetmgmt` `dev` slot, `mysql-sportspres-assetmgmt` (`assetmgmt_dev`), `sasportspresentation` storage account. Azure Communication Services Email (`email-sportspres-assetmgmt`, Azure-managed sender domain). Real events `1000`/`1001` used throughout (no disposable test event needed - Change Log Email/Event Log read existing change-log history, they don't create data). |

## Summary

| Total cases | Passed | Failed | Blocked | Not yet run |
|---|---|---|---|---|
| 15 | 11 | 0 | 0 | 4 |

## Test cases

| ID | Description | Preconditions | Steps | Expected result | Actual result | Status | Notes |
|---|---|---|---|---|---|---|---|
| TC-01 | `GET /api/events/:eventId/log` requires an authenticated session | — | `GET /api/events/1000/log` with no session cookie | 401 `Not authenticated` | Confirmed live | Pass | |
| TC-02 | Event Log Tab returns every change-log entry for the event, sorted newest-first, displayed `dd/mm/yyyy hh:mm SGT` | Signed in | Open the Log modal for event `1000` | All entries present, most recent first, timestamps in Singapore time, no columns wrapping in the (widened) modal | Confirmed live (both directly and via the user's own testing) after the SGT-formatting/modal-width fix | Pass | |
| TC-03 | `POST /api/events/:eventId/send-change-log-email` requires an authenticated session | — | `POST` with no session cookie | 401 `Not authenticated` | Confirmed live | Pass | |
| TC-04 | Send Mail scope `"session"` includes only entries logged since the caller's own login | Event with both old (pre-login) and new (this-session) entries | Send Mail → "Changes in this session" | Email contains only this session's entries | Confirmed live, and root-caused against the real dev DB + the event's actual change-log CSV when an earlier version of this filter appeared broken (see workflow.md's "third round" write-up) | Pass | |
| TC-05 | Send Mail scope `"24h"` includes only entries from the last 24 hours | Same | Send Mail → "Changes in the last 24 hours" | Email contains only last-24h entries | Confirmed live after the same fix as TC-04 (both scopes filter the full history directly, not a partial "unsent" subset) | Pass | |
| TC-06 | Send Mail scope `"all"` includes the event's entire change-log history, no time filter | Same | Send Mail → "All changes for this event" | Email contains every logged entry for the event, oldest and newest alike | Confirmed live against event `1000`'s real 78-row history after dropping the `email_last_sent_sno` watermark (migration `011_drop_email_last_sent_sno.sql`) | Pass | |
| TC-07 | A successful send resets the "unsent" indicator (`email_pending`), and a later send still works (isn't permanently blocked) | An event with unsent changes | Send Mail (any scope) twice in a row | First send succeeds and clears the indicator; second send (any scope) also succeeds, not blocked with "No changes to send" | Confirmed live after the fourth fix - the route previously gated sending itself on `email_pending`, silently no-op'ing every send after the first in a session; `email_pending` is now a UI hint only, never a send gate | Pass | |
| TC-08 | A failed email send (e.g. simulated ACS error) leaves `email_pending` untouched, so the user can retry | — | Not fault-injection-tested this session | Event stays marked pending, Send Mail button stays red | Not exercised - would require deliberately breaking ACS connectivity | Not yet run | Behavior verified by code review only (`try { sendChangeLogEmail } catch { throw 502 }` runs before the `UPDATE ... SET email_pending = FALSE`). |
| TC-09 | `GET /api/system-settings` is readable by every signed-in role; `PUT` is restricted to SuperAdmin/Administrator | — | Code review + live 401 check | GET/PUT both require a session; PUT additionally requires the role | GET/PUT 401 without a session confirmed live; the role restriction on PUT was not independently exercised from the rejected (Normal User) side this session - same recurring limitation as every other step's RBAC testing (no Normal User test account available) | Not yet run | Flagged for the user's own testing pass, consistent with every prior step's equivalent gap. |
| TC-10 | Leaving the Asset Upload page with unsent changes, while Force Email Send is on, prompts before navigating away - for every exit path (Back to Dashboard, a left-nav link, Sign Out, browser back/forward) | Force Email Send on (DB default), an event with unsent changes selected | Attempt to navigate away | A custom "Send Mail Now / Leave Without Sending / Cancel" modal appears; navigation is blocked until resolved | Confirmed live: the CanDeactivate guard genuinely blocked a Claude-in-Chrome `navigate()` call mid-session with exactly this prompt, requiring an explicit override to proceed | Pass | |
| TC-11 | An actual browser tab close/refresh with unsent changes triggers the browser's native "leave site?" warning (the one deliberate exception to this app's no-native-dialogs convention) | Same | Attempt to close/navigate away from the tab | Native browser confirmation dialog appears | Confirmed live - the same navigation attempt in TC-10 surfaced the browser's own native dialog (`beforeunload`), not a custom one, exactly as designed | Pass | |
| TC-12 | Dashboard shows a per-row "✉ Unsent" badge and a login-time reminder banner for events with unsent changes, only while Force Email Send is on | Same | View Dashboard | Badge on the affected event's row; banner listing it, linking to its Asset Upload page | Not independently re-screenshotted this session - built on the same `emailPending`/`forceEmailSend` data already live-verified correct elsewhere (TC-04–TC-07, TC-10), and the Dashboard's own favorite-star/archive badges (an identical rendering pattern) were live-verified in Step 5/6's own QA pass | Not yet run | Low-risk gap - flagged for the user's own visual check. |
| TC-13 | System Settings page: Force Email Send checkbox loads the current value, Save persists it, Cancel discards an unsaved change | Signed in as SuperAdmin/Administrator | Open `/system-settings`, toggle the checkbox, Cancel; toggle again, Save | Cancel reverts to the last-saved value; Save persists and is reflected on reload | Not independently live-tested this session (the page was never opened in the browser this session) - built on the exact same load/save/cancel pattern already live-verified for Change Password and other simple settings forms | Not yet run | Flagged for the user's own testing pass. |
| TC-14 | Asset Upload page's Event picker: typing narrows the list by Event ID or name (e.g. "1000" or "Star Contender"); "Favorites only" narrows to the user's favorited events | Signed in, at least one event favorited | Type a search term; toggle Favorites only | List narrows correctly for both | Confirmed live via Claude-in-Chrome (typing "Star" correctly narrowed to both Star Contender events; enabling Favorites only correctly narrowed to zero non-selected favorites, matching the real data) after rebuilding the picker as a proper combobox - the first version (search box narrowing a separate native `<select>`) gave no visible feedback until the `<select>` was opened by hand, which the user correctly flagged as "not working." User separately confirmed it working after the rebuild. | Pass | |
| TC-15 | Save Sequence (Sponsor Ads) still works correctly after all of Step 9's changes to the Asset Upload page | Signed in | Save Sequence (Inner and Outer) | Saves instantly, no hang; Send Mail indicator updates correctly afterward | Confirmed live (`PUT .../sequence` 200, follow-on `GET /api/events` 200) after a user report of it being "stuck" turned out to be a one-time glitch overlapping with a deploy/restart cycle, not a real regression | Pass | |

## Open defects / follow-ups

Five rounds of live user feedback surfaced and fixed real defects before this step reached its current state - see workflow.md's Step 9 section for the full root-cause writeup of each. Summary:
1. Automatic per-save email was too noisy → replaced with manually-triggered, scope-selectable Send Mail (redesign).
2. Send Mail batched the entire history instead of a sensible recent window → added the session/24h/all scope picker.
3. The scope picker's filters silently collapsed to the same small set regardless of which option was chosen → traced to an "unsent since last send" watermark interacting badly with the new scopes; watermark removed entirely.
4. Every send after the first one in a session silently did nothing → `email_pending` was still gating the send action itself, not just the UI indicator; fixed to never block sending.
5. The Event picker's pattern search appeared to do nothing → the search box narrowed a separate native `<select>` with no visible feedback until opened by hand; rebuilt as a real combobox with results shown inline.

No defects remain open as of this document's writing; TC-08, TC-09 (PUT role check), TC-12, and TC-13 are flagged above as not yet independently exercised, not as known failures.
