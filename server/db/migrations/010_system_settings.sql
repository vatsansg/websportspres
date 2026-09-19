-- User-requested (2026-09-19, see workflow.md): a single global app-wide setting,
-- "Force Email Send", editable by SuperAdmin/Administrator from the new System Settings
-- page. When enabled, a user with unsent Change Log Email changes on an event is warned
-- before navigating away from that event's Asset Upload page (and reminded again at
-- their next login) until they press Send Mail; when disabled, Send Mail is available but
-- never forced. Modeled as a singleton row (id is always 1, enforced by the CHECK) rather
-- than a key/value table since there is currently exactly one setting - a key/value shape
-- would be speculative generality for a table with one row and one column.
CREATE TABLE IF NOT EXISTS system_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  force_email_send BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_system_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User's explicit choice (2026-09-19): forced from day one, not opt-in.
INSERT INTO system_settings (id, force_email_send)
VALUES (1, TRUE)
ON DUPLICATE KEY UPDATE id = id;
