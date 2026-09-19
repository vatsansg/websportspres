-- User-requested redesign of Step 9 (2026-09-19, see workflow.md): replaces the
-- automatic per-save Change Log Email with a manually-triggered "Send Mail" action per
-- event, so a user editing several files in a row doesn't get flooded with separate
-- emails. `email_pending` is set TRUE by appendChangeLogEntry() (assetChangeLog.js)
-- whenever a new change-log row is written, and cleared back to FALSE only once that
-- event's accumulated changes have actually been emailed. `email_last_sent_sno` is the
-- highest change-log `sno` (see assetChangeLog.js) already covered by a sent email - the
-- next Send Mail only needs to include rows with a higher sno than this, so a user's
-- several small saves between two "Send Mail" clicks are still batched into one email.
ALTER TABLE events
  ADD COLUMN email_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN email_last_sent_sno INT UNSIGNED NOT NULL DEFAULT 0;
