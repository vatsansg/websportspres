-- User-requested feature (2026-09-19, beyond the original BRD scope - see workflow.md):
-- a personal "favorite events" list on the Dashboard, max 3 per user, available to every
-- role (not permission-gated like Export/Archive - this is a per-user productivity
-- convenience, not a destructive or sensitive action). Keyed by `username` (the same
-- stable string identifier already used throughout this app - events.created_by,
-- users.username, etc.) rather than a numeric FK to `users.id`, consistent with that
-- existing convention. ON DELETE CASCADE means a favorite silently disappears if its
-- event row is ever hard-deleted (Archive is a status change, not a delete, so archiving
-- an event does not remove a favorite - it just stops showing up in the Active-only
-- Dashboard list, same as any other event).
CREATE TABLE IF NOT EXISTS user_favorites (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  event_id VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_favorites (username, event_id),
  CONSTRAINT fk_user_favorites_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  KEY idx_user_favorites_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
