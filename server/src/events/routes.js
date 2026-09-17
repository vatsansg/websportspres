import { Router } from "express";
import { body, validationResult } from "express-validator";
import { query, withTransaction } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { createEventStorageStructure, deleteEventStorageStructure } from "../storage/eventFolders.js";

export const eventsRouter = Router();

// Blob paths are built directly from event_id/event_name (see storage/eventFolders.js's
// buildEventFolderName), so a "/" here would silently create nested "folders" instead of
// the intended single event folder, and other control characters are invalid in blob names.
const BLOB_SAFE_PATTERN = /^[^/\\\x00-\x1f]+$/;

function validateTables(tables) {
  const errors = [];
  if (!Array.isArray(tables) || tables.length === 0) {
    return ["At least one table is required"];
  }
  const seenNumbers = new Set();
  for (const table of tables) {
    const tableNumber = table?.tableNumber;
    if (!Number.isInteger(tableNumber) || tableNumber < 1) {
      errors.push("Each table must have a positive integer tableNumber");
      continue;
    }
    if (seenNumbers.has(tableNumber)) {
      errors.push(`Duplicate tableNumber ${tableNumber}`);
    }
    seenNumbers.add(tableNumber);

    const { innerLed, outerLed, mainLed } = table;
    if (!innerLed && !outerLed && !mainLed) {
      errors.push(`Table ${tableNumber}: at least one LED type must be selected`);
    }
    // Web BRD Section 3.1 (post-004 fix): Outer can never be selected without Inner;
    // Main is independently free. See db/migrations/004_fix_outer_led_constraint.sql.
    if (outerLed && !innerLed) {
      errors.push(`Table ${tableNumber}: Outer LED requires Inner LED to also be selected`);
    }
  }
  if (!seenNumbers.has(1)) {
    errors.push("Table 1 is required for every event (Web BRD Section 9)");
  }
  return errors;
}

function resolutionFields(table) {
  return {
    innerWidth: table.innerResolutionWidth ?? 1920,
    innerHeight: table.innerResolutionHeight ?? 1080,
    outerWidth: table.outerResolutionWidth ?? 1920,
    outerHeight: table.outerResolutionHeight ?? 1080,
    mainWidth: table.mainResolutionWidth ?? 3840,
    mainHeight: table.mainResolutionHeight ?? 2160,
  };
}

// Web BRD Section 5/9: Event ID is globally unique (not per-year) - approved decision,
// see workflow.md Step 2 kickoff. Event Name must not reference "WTT" (Section 5).
eventsRouter.post(
  "/",
  requireSession,
  body("eventId").isString().trim().isLength({ min: 1, max: 20 }).matches(BLOB_SAFE_PATTERN),
  body("eventName")
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .matches(BLOB_SAFE_PATTERN)
    .custom((value) => !/wtt/i.test(value))
    .withMessage("Event Name must not contain \"WTT\""),
  body("year").optional().isInt({ min: 2000, max: 2100 }).toInt(),
  body("tables").isArray({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }

    const eventId = req.body.eventId.trim();
    const eventName = req.body.eventName.trim();
    const year = req.body.year ?? new Date().getFullYear();
    const tables = req.body.tables;

    const tableErrors = validateTables(tables);
    if (tableErrors.length > 0) {
      return res.status(400).json({ error: "Invalid table configuration", details: tableErrors });
    }

    const existing = await query("SELECT event_id FROM events WHERE event_id = ?", [eventId]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `Event ID "${eventId}" already exists` });
    }

    await withTransaction(async ({ query: txQuery }) => {
      await txQuery(
        `INSERT INTO events (event_id, event_name, year, status, created_by, updated_by)
         VALUES (?, ?, ?, 'Active', ?, ?)`,
        [eventId, eventName, year, req.user.username, req.user.username]
      );

      for (const table of tables) {
        const r = resolutionFields(table);
        await txQuery(
          `INSERT INTO event_tables
             (event_id, table_number, inner_led, outer_led, main_led,
              inner_resolution_width, inner_resolution_height,
              outer_resolution_width, outer_resolution_height,
              main_resolution_width, main_resolution_height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            table.tableNumber,
            table.innerLed ? 1 : 0,
            table.outerLed ? 1 : 0,
            table.mainLed ? 1 : 0,
            r.innerWidth,
            r.innerHeight,
            r.outerWidth,
            r.outerHeight,
            r.mainWidth,
            r.mainHeight,
          ]
        );
      }
    });

    try {
      const { eventStorageUrl } = await createEventStorageStructure({
        year,
        eventId,
        eventName,
        tables,
      });
      res.status(201).json({ eventId, eventName, year, eventStorageUrl });
    } catch (err) {
      // Storage failed after the DB commit succeeded - roll both back rather than leave a
      // DB-only "ghost" event with no folder structure behind it.
      await query("DELETE FROM events WHERE event_id = ?", [eventId]); // cascades to event_tables
      await deleteEventStorageStructure({ year, eventId, eventName }).catch(() => {});
      err.status = 500;
      err.message = "Event storage creation failed; event was not created";
      throw err;
    }
  }
);
