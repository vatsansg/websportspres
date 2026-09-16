-- Events table (Web BRD Section 5). Inner/Outer/Main LED booleans are deliberately NOT here -
-- see 003_create_event_tables.sql and workflow.md for why LED config lives per-table instead
-- (Web BRD Sections 3.1, 6, 9, 10, 11.1, and decisively Section 25.4's per-table export schema).
CREATE TABLE IF NOT EXISTS events (
  event_id VARCHAR(20) NOT NULL PRIMARY KEY,
  event_name VARCHAR(255) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  status ENUM('Active', 'Archive') NOT NULL DEFAULT 'Active',
  export_guid CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(255) NULL,
  updated_by VARCHAR(255) NULL,
  KEY idx_events_status (status),
  KEY idx_events_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
