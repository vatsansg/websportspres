-- User feedback (2026-09-19, see workflow.md), second round: the "only re-send what's
-- new since the last send" watermark design (email_last_sent_sno, migration 009)
-- conflicted with what the user actually wants - "session"/"24h"/"all" should each filter
-- the event's *entire* change-log history, not just entries never before included in any
-- send, and *any* successful send (whichever scope) should clear the "unsent" indicator.
-- That makes email_last_sent_sno dead weight - dropped rather than left as an unused,
-- confusing column.
ALTER TABLE events DROP COLUMN email_last_sent_sno;
