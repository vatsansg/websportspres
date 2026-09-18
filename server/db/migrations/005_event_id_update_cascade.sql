-- Web BRD Section 8: Event ID must be editable after creation. The existing FK
-- (fk_event_tables_event) has no ON UPDATE clause, so MySQL rejects any UPDATE to
-- events.event_id while a table row still references the old value - which is always,
-- since Table 1 is mandatory. Adding ON UPDATE CASCADE lets a single
-- `UPDATE events SET event_id = ?` propagate to event_tables automatically within the
-- same transaction, instead of needing to manually delete/reinsert child rows.
ALTER TABLE event_tables DROP FOREIGN KEY fk_event_tables_event;
ALTER TABLE event_tables ADD CONSTRAINT fk_event_tables_event
  FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE ON UPDATE CASCADE;
