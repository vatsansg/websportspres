-- User Management (Step 5 follow-up, 2026-09-18): tracks who provisioned an AAD-linked
-- Administrator/NormalUser account, same audit-trail pattern already used on
-- events/event_tables (created_by/updated_by). NULL for the seeded first_time_admin row
-- and any row that predates this feature.
ALTER TABLE users ADD COLUMN added_by VARCHAR(255) NULL AFTER azure_ad_object_id;
