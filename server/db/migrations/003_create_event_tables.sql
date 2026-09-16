-- Per-table LED configuration and per-table/per-LED-type resolution (Web BRD Sections 3.1, 6, 31).
-- Table 1 must never be deleted (Section 9) - enforced in application logic, not schema.
CREATE TABLE IF NOT EXISTS event_tables (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(20) NOT NULL,
  table_number INT UNSIGNED NOT NULL,
  inner_led TINYINT(1) NOT NULL DEFAULT 0,
  outer_led TINYINT(1) NOT NULL DEFAULT 0,
  main_led TINYINT(1) NOT NULL DEFAULT 0,
  inner_resolution_width SMALLINT UNSIGNED NOT NULL DEFAULT 1920,
  inner_resolution_height SMALLINT UNSIGNED NOT NULL DEFAULT 1080,
  outer_resolution_width SMALLINT UNSIGNED NOT NULL DEFAULT 1920,
  outer_resolution_height SMALLINT UNSIGNED NOT NULL DEFAULT 1080,
  main_resolution_width SMALLINT UNSIGNED NOT NULL DEFAULT 3840,
  main_resolution_height SMALLINT UNSIGNED NOT NULL DEFAULT 2160,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_event_tables_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  UNIQUE KEY uq_event_table_number (event_id, table_number),
  -- Web BRD Section 3.1 business rules, enforced again here as a defense-in-depth safety net:
  CONSTRAINT chk_at_least_one_led CHECK (inner_led = 1 OR outer_led = 1 OR main_led = 1),
  CONSTRAINT chk_outer_not_with_main CHECK (NOT (outer_led = 1 AND main_led = 1)),
  CONSTRAINT chk_outer_not_alone CHECK (NOT (outer_led = 1 AND inner_led = 0 AND main_led = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
