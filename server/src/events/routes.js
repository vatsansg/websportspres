import { Router } from "express";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { query, withTransaction } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { requireRole } from "../auth/requireRole.js";
import {
  createEventStorageStructure,
  deleteEventStorageStructure,
  createTableStorage,
  deleteTableStorage,
  enableTableDestination,
  disableTableDestination,
  listRealFiles,
  renameEventStorage,
  writeExportGuidFile,
  buildEventFolderName,
  LED_FOLDER_NAMES,
} from "../storage/eventFolders.js";
import { getContainerClient } from "../storage/blobClient.js";
import { appendChangeLogEntry, readChangeLogEntries } from "../logging/assetChangeLog.js";
import { sendChangeLogEmail } from "../logging/changeLogEmail.js";

export const eventsRouter = Router();

// Prevents an authenticated user (any role) from looping event creation to exhaust the
// Event ID namespace or spam storage/DB - same treatment Step 1 gave the auth routes, but
// keyed by session username (set by requireSession, which runs first) rather than IP,
// since abuse here is about how many events one account creates, not one network address.
const eventCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many events created recently. Please try again later." },
});

// Same reasoning/shape as eventCreationLimiter above, separate bucket since editing an
// event (Step 5) is a different action than creating one.
const eventEditLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many event edits recently. Please try again later." },
});

const DESTINATIONS = ["inner", "outer", "main"];

// Step 7: Export Event (Web BRD Section 25.3) is role-gated (SuperAdmin/Administrator
// only) but still rate-limited like every other mutating events route, same shape/reason
// as eventEditLimiter above.
const eventExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many exports recently. Please try again later." },
});

// User-requested feature (2026-09-18, beyond the original BRD scope - see workflow.md):
// Archive is a one-way (from the UI's perspective) status change, same role gate as
// Export Event, same rate-limiter shape as every other mutating events route.
const eventArchiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many archive actions recently. Please try again later." },
});

// Blob paths are built directly from event_id/event_name (see storage/eventFolders.js's
// buildEventFolderName), so a "/" here would silently create nested "folders" instead of
// the intended single event folder, and other control characters are invalid in blob names.
const BLOB_SAFE_PATTERN = /^[^/\\\x00-\x1f]+$/;

// Event ID is numeric-only (confirmed by user testing, matches the real sample event's
// "1111" convention) - kept as a string (not converted to a number) so leading zeros are
// preserved exactly and the DB column stays VARCHAR(20) as already built.
const NUMERIC_PATTERN = /^[0-9]+$/;

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
  eventCreationLimiter,
  body("eventId")
    .isString()
    .trim()
    .isLength({ min: 1, max: 20 })
    .matches(NUMERIC_PATTERN)
    .withMessage("Event ID must be numeric"),
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

    try {
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
    } catch (err) {
      // The SELECT-then-INSERT above has a TOCTOU gap: two concurrent requests for the same
      // new eventId can both pass the pre-check and race on the INSERT. Catch the PK
      // violation here so the loser still gets a clean 409, not a generic 500.
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: `Event ID "${eventId}" already exists` });
      }
      throw err;
    }

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
      // DB-only "ghost" event with no folder structure behind it. Both rollback steps are
      // logged (not silently swallowed) so a double-failure here - the rarer case where the
      // rollback itself also fails - leaves a trace instead of vanishing without a record.
      console.error(`Storage creation failed for event "${eventId}" after DB commit:`, err);
      try {
        await query("DELETE FROM events WHERE event_id = ?", [eventId]); // cascades to event_tables
      } catch (dbRollbackErr) {
        console.error(
          `Failed to roll back DB row for event "${eventId}" after storage failure - manual cleanup needed:`,
          dbRollbackErr
        );
      }
      await deleteEventStorageStructure({ year, eventId, eventName }).catch((storageCleanupErr) => {
        console.error(`Failed to clean up partial storage for event "${eventId}":`, storageCleanupErr);
      });
      err.status = 500;
      err.message = "Event storage creation failed; event was not created";
      throw err;
    }
  }
);

// Event list - Active-status only, Event ID descending (Web BRD Section 25.1). Built for
// Step 3's Asset Upload picker (eventId/eventName/year/status), and reused as-is for
// Step 6's real Dashboard/Event List, which additionally needs each row's table/LED
// summary - added here as an extra `tables` field rather than a second endpoint, since
// it's a pure addition existing consumers already ignore. `isFavorite` (user-requested,
// 2026-09-19) is the signed-in user's own favorite state for that event - never another
// user's, so two people never see each other's favorites.
eventsRouter.get("/", requireSession, async (req, res) => {
  const rows = await query(
    "SELECT event_id, event_name, year, status, email_pending FROM events WHERE status = 'Active' ORDER BY event_id DESC"
  );
  if (rows.length === 0) {
    return res.json([]);
  }
  const tableRows = await query(
    `SELECT event_id, table_number, inner_led, outer_led, main_led
     FROM event_tables WHERE event_id IN (?) ORDER BY event_id, table_number`,
    [rows.map((r) => r.event_id)]
  );
  const tablesByEvent = new Map();
  for (const t of tableRows) {
    if (!tablesByEvent.has(t.event_id)) tablesByEvent.set(t.event_id, []);
    tablesByEvent.get(t.event_id).push({
      tableNumber: t.table_number,
      innerLed: !!t.inner_led,
      outerLed: !!t.outer_led,
      mainLed: !!t.main_led,
    });
  }
  const favoriteRows = await query("SELECT event_id FROM user_favorites WHERE username = ?", [
    req.user.username,
  ]);
  const favoriteIds = new Set(favoriteRows.map((f) => f.event_id));
  res.json(
    rows.map((r) => ({
      eventId: r.event_id,
      eventName: r.event_name,
      year: r.year,
      status: r.status,
      tables: tablesByEvent.get(r.event_id) ?? [],
      isFavorite: favoriteIds.has(r.event_id),
      emailPending: !!r.email_pending,
    }))
  );
});

// User-requested feature (2026-09-19, beyond the original BRD scope - see workflow.md):
// a personal favorite-events list, max 3 per user, available to every role. Toggled from
// the Dashboard. `favoriteLimiter` reuses the same shape as every other mutating events
// route.
const favoriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many favorite changes recently. Please try again later." },
});

const MAX_FAVORITES_PER_USER = 3;

// User-requested (2026-09-19, see workflow.md): manual "Send Mail" action, available to
// every role (whoever made the change is the one who should be able to send notice of
// it) - same shape as favoriteLimiter above.
const sendMailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many Change Log Email sends recently. Please try again later." },
});

eventsRouter.post("/:eventId/favorite", requireSession, favoriteLimiter, async (req, res) => {
  const eventRows = await query("SELECT event_id FROM events WHERE event_id = ?", [req.params.eventId]);
  if (eventRows.length === 0) {
    return res.status(404).json({ error: "Event not found" });
  }

  const existing = await query("SELECT id FROM user_favorites WHERE username = ? AND event_id = ?", [
    req.user.username,
    req.params.eventId,
  ]);
  if (existing.length > 0) {
    return res.json({ eventId: req.params.eventId, isFavorite: true });
  }

  const countRows = await query("SELECT COUNT(*) AS n FROM user_favorites WHERE username = ?", [
    req.user.username,
  ]);
  if (countRows[0].n >= MAX_FAVORITES_PER_USER) {
    return res.status(409).json({ error: `You can only favorite up to ${MAX_FAVORITES_PER_USER} events. Remove one first.` });
  }

  try {
    await query("INSERT INTO user_favorites (username, event_id) VALUES (?, ?)", [
      req.user.username,
      req.params.eventId,
    ]);
  } catch (err) {
    // TOCTOU: two rapid clicks (or two tabs) racing the same add - the loser just finds
    // it's already favorited, same non-error outcome as the existing-row check above.
    if (err.code !== "ER_DUP_ENTRY") throw err;
  }
  res.json({ eventId: req.params.eventId, isFavorite: true });
});

eventsRouter.delete("/:eventId/favorite", requireSession, favoriteLimiter, async (req, res) => {
  await query("DELETE FROM user_favorites WHERE username = ? AND event_id = ?", [
    req.user.username,
    req.params.eventId,
  ]);
  res.json({ eventId: req.params.eventId, isFavorite: false });
});

eventsRouter.get("/:eventId", requireSession, async (req, res) => {
  const eventRows = await query(
    "SELECT event_id, event_name, year, status, email_pending FROM events WHERE event_id = ?",
    [req.params.eventId]
  );
  if (eventRows.length === 0) {
    return res.status(404).json({ error: "Event not found" });
  }
  const tableRows = await query(
    `SELECT table_number, inner_led, outer_led, main_led,
            inner_resolution_width, inner_resolution_height,
            outer_resolution_width, outer_resolution_height,
            main_resolution_width, main_resolution_height
     FROM event_tables WHERE event_id = ? ORDER BY table_number`,
    [req.params.eventId]
  );
  const event = eventRows[0];
  res.json({
    eventId: event.event_id,
    eventName: event.event_name,
    year: event.year,
    status: event.status,
    emailPending: !!event.email_pending,
    tables: tableRows.map((t) => ({
      tableNumber: t.table_number,
      innerLed: !!t.inner_led,
      outerLed: !!t.outer_led,
      mainLed: !!t.main_led,
      innerResolutionWidth: t.inner_resolution_width,
      innerResolutionHeight: t.inner_resolution_height,
      outerResolutionWidth: t.outer_resolution_width,
      outerResolutionHeight: t.outer_resolution_height,
      mainResolutionWidth: t.main_resolution_width,
      mainResolutionHeight: t.main_resolution_height,
    })),
  });
});

// Web BRD Section 8/9: Event Modification. One combined edit endpoint, same shape as
// creation's combined payload - Event ID/Name/Year, plus the full desired table list
// (adds, removes, and per-table LED toggles all expressed as "here is the table list I
// want now" rather than separate add/remove/toggle endpoints). Confirmation is gated in
// two ways per Section 8's own text: table deletion always needs confirmation
// (unconditional), while ID/Name/Year rename and LED-destination-disable only need it
// "if files already exist" (conditional - checked live against storage before deciding).
//
// Flow: first call omits `confirmed`; if any destructive change needs confirmation and
// the caller hasn't set `confirmed: true`, respond 409 with the list of pending
// confirmations (and how many real files each affects) without changing anything. The
// client shows that to the user and, on OK, resubmits the identical body with
// `confirmed: true` - the server re-derives the same diff independently rather than
// trusting a client-supplied list of "confirmed changes", so there's no way to slip an
// unconfirmed destructive change through by lying about which ones were shown.
eventsRouter.put(
  "/:eventId",
  requireSession,
  eventEditLimiter,
  body("eventId")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 20 })
    .matches(NUMERIC_PATTERN)
    .withMessage("Event ID must be numeric"),
  body("eventName")
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .matches(BLOB_SAFE_PATTERN)
    .custom((value) => !/wtt/i.test(value))
    .withMessage("Event Name must not contain \"WTT\""),
  body("year").isInt({ min: 2000, max: 2100 }).toInt(),
  body("tables").isArray({ min: 1 }),
  body("confirmed").optional().isBoolean().toBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }

    const currentEventId = req.params.eventId;
    const newEventId = (req.body.eventId ? req.body.eventId.trim() : currentEventId);
    const newEventName = req.body.eventName.trim();
    const newYear = req.body.year;
    const newTables = req.body.tables;
    const confirmed = req.body.confirmed === true;

    const tableErrors = validateTables(newTables);
    if (tableErrors.length > 0) {
      return res.status(400).json({ error: "Invalid table configuration", details: tableErrors });
    }

    const eventRows = await query(
      "SELECT event_id, event_name, year, status FROM events WHERE event_id = ?",
      [currentEventId]
    );
    if (eventRows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    const current = eventRows[0];
    const oldEventId = current.event_id;
    const oldEventName = current.event_name;
    const oldYear = current.year;

    if (newEventId !== oldEventId) {
      const clash = await query("SELECT event_id FROM events WHERE event_id = ?", [newEventId]);
      if (clash.length > 0) {
        return res.status(409).json({ error: `Event ID "${newEventId}" already exists` });
      }
    }

    const currentTableRows = await query(
      `SELECT table_number, inner_led, outer_led, main_led,
              inner_resolution_width, inner_resolution_height,
              outer_resolution_width, outer_resolution_height,
              main_resolution_width, main_resolution_height
       FROM event_tables WHERE event_id = ? ORDER BY table_number`,
      [currentEventId]
    );
    const currentTables = new Map(currentTableRows.map((t) => [t.table_number, t]));
    const newTablesByNumber = new Map(newTables.map((t) => [t.tableNumber, t]));

    const removedTableNumbers = [...currentTables.keys()].filter((n) => !newTablesByNumber.has(n));
    const addedTables = newTables.filter((t) => !currentTables.has(t.tableNumber));
    const changedTables = newTables
      .filter((t) => currentTables.has(t.tableNumber))
      .map((t) => {
        const before = currentTables.get(t.tableNumber);
        const enabled = (destination) =>
          destination === "inner" ? !!before.inner_led : destination === "outer" ? !!before.outer_led : !!before.main_led;
        const wants = (destination) =>
          destination === "inner" ? !!t.innerLed : destination === "outer" ? !!t.outerLed : !!t.mainLed;
        return {
          tableNumber: t.tableNumber,
          disabling: DESTINATIONS.filter((d) => enabled(d) && !wants(d)),
          enabling: DESTINATIONS.filter((d) => !enabled(d) && wants(d)),
        };
      });

    // Gather every confirmation this edit could need, and how many real files it
    // affects, before touching anything.
    const confirmations = [];

    const identityChanged = newEventId !== oldEventId || newEventName !== oldEventName || newYear !== oldYear;
    if (identityChanged) {
      const files = await listRealFiles({ year: oldYear, eventId: oldEventId, eventName: oldEventName });
      if (files.length > 0) {
        confirmations.push({
          type: "rename",
          message: `Renaming/moving this event will relocate ${files.length} existing file(s) to the new event folder.`,
          fileCount: files.length,
        });
      }
    }

    for (const tableNumber of removedTableNumbers) {
      const files = await listRealFiles({
        year: oldYear,
        eventId: oldEventId,
        eventName: oldEventName,
        folderPath: `Table ${tableNumber}`,
      });
      // Web BRD Section 9: table deletion is confirmed unconditionally, regardless of
      // whether it actually contains any real files.
      confirmations.push({
        type: "table-delete",
        tableNumber,
        message: `Deleting Table ${tableNumber} will permanently remove its folder and ${files.length} file(s) in it.`,
        fileCount: files.length,
      });
    }

    for (const change of changedTables) {
      for (const destination of change.disabling) {
        const files = await listRealFiles({
          year: oldYear,
          eventId: oldEventId,
          eventName: oldEventName,
          folderPath: `Table ${change.tableNumber}/${LED_FOLDER_NAMES[destination]}`,
        });
        if (files.length > 0) {
          confirmations.push({
            type: "destination-disable",
            tableNumber: change.tableNumber,
            destination,
            message: `Disabling ${destination.toUpperCase()} LED on Table ${change.tableNumber} will permanently remove ${files.length} file(s).`,
            fileCount: files.length,
          });
        }
      }
    }

    if (confirmations.length > 0 && !confirmed) {
      return res.status(409).json({ error: "Confirmation required", confirmations });
    }

    try {
      await withTransaction(async ({ query: txQuery }) => {
        if (newEventId !== oldEventId || newEventName !== oldEventName || newYear !== oldYear) {
          await txQuery(
            "UPDATE events SET event_id = ?, event_name = ?, year = ?, updated_by = ? WHERE event_id = ?",
            [newEventId, newEventName, newYear, req.user.username, oldEventId]
          );
        }

        for (const tableNumber of removedTableNumbers) {
          await txQuery("DELETE FROM event_tables WHERE event_id = ? AND table_number = ?", [
            newEventId,
            tableNumber,
          ]);
        }

        for (const table of addedTables) {
          const r = resolutionFields(table);
          await txQuery(
            `INSERT INTO event_tables
               (event_id, table_number, inner_led, outer_led, main_led,
                inner_resolution_width, inner_resolution_height,
                outer_resolution_width, outer_resolution_height,
                main_resolution_width, main_resolution_height)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newEventId,
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

        for (const t of newTables) {
          if (!currentTables.has(t.tableNumber)) continue; // handled above as an add
          await txQuery(
            "UPDATE event_tables SET inner_led = ?, outer_led = ?, main_led = ? WHERE event_id = ? AND table_number = ?",
            [t.innerLed ? 1 : 0, t.outerLed ? 1 : 0, t.mainLed ? 1 : 0, newEventId, t.tableNumber]
          );
        }
      });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: `Event ID "${newEventId}" already exists` });
      }
      throw err;
    }

    // DB commit succeeded - now apply the same changes to storage. Unlike creation,
    // there is no full symmetric rollback here if a storage step fails partway through
    // (unwinding a partial rename/add/delete/toggle set safely is materially harder than
    // creation's single all-or-nothing folder tree) - failures are logged loudly and
    // surfaced to the caller as a 500 rather than silently swallowed, so the operator
    // knows the DB and storage may be out of sync and can check `_ledassetschangelog.csv`
    // / the storage account directly. This asymmetry is a deliberate, documented scope
    // decision (see workflow.md Step 5), not an oversight.
    try {
      let effectiveYear = oldYear;
      let effectiveEventId = oldEventId;
      let effectiveEventName = oldEventName;

      if (identityChanged) {
        await renameEventStorage({
          oldYear,
          newYear,
          oldEventId,
          oldEventName,
          newEventId,
          newEventName,
        });
        effectiveYear = newYear;
        effectiveEventId = newEventId;
        effectiveEventName = newEventName;
      }

      for (const tableNumber of removedTableNumbers) {
        const files = await listRealFiles({
          year: effectiveYear,
          eventId: effectiveEventId,
          eventName: effectiveEventName,
          folderPath: `Table ${tableNumber}`,
        });
        await deleteTableStorage({
          year: effectiveYear,
          eventId: effectiveEventId,
          eventName: effectiveEventName,
          tableNumber,
        });
        for (const filename of files) {
          await appendChangeLogEntry({
            year: effectiveYear,
            eventId: effectiveEventId,
            eventName: effectiveEventName,
            filename,
            status: "Deleted",
            username: req.user.username,
          });
        }
      }

      for (const table of addedTables) {
        await createTableStorage({
          year: effectiveYear,
          eventId: effectiveEventId,
          eventName: effectiveEventName,
          table,
        });
      }

      for (const change of changedTables) {
        for (const destination of change.enabling) {
          await enableTableDestination({
            year: effectiveYear,
            eventId: effectiveEventId,
            eventName: effectiveEventName,
            tableNumber: change.tableNumber,
            destination,
          });
        }
        for (const destination of change.disabling) {
          const files = await listRealFiles({
            year: effectiveYear,
            eventId: effectiveEventId,
            eventName: effectiveEventName,
            folderPath: `Table ${change.tableNumber}/${LED_FOLDER_NAMES[destination]}`,
          });
          await disableTableDestination({
            year: effectiveYear,
            eventId: effectiveEventId,
            eventName: effectiveEventName,
            tableNumber: change.tableNumber,
            destination,
          });
          for (const filename of files) {
            await appendChangeLogEntry({
              year: effectiveYear,
              eventId: effectiveEventId,
              eventName: effectiveEventName,
              filename,
              status: "Deleted",
              username: req.user.username,
            });
          }
        }
      }

      const containerClient = getContainerClient(String(effectiveYear));
      const eventStorageUrl = `${containerClient.url}/${encodeURIComponent(
        buildEventFolderName(effectiveEventId, effectiveEventName)
      )}`;
      res.json({ eventId: newEventId, eventName: newEventName, year: newYear, eventStorageUrl });
    } catch (err) {
      console.error(`Storage sync failed while editing event "${oldEventId}" -> "${newEventId}":`, err);
      err.status = 500;
      err.message =
        "Event was updated in the database, but applying the change to storage failed partway through. Please check the event's storage folder and contact an administrator.";
      throw err;
    }
  }
);

// Web BRD Section 25.3-25.6: Export Event. SuperAdmin/Administrator only (Section 2.1) -
// the Normal User must never see this action at all (enforced here server-side; the
// frontend also hides the button entirely for a Normal User, not just disables it, per
// Section 25.1's literal "must not be presented" wording). Generates a new ExportGUID
// every time (overwriting any previous value, Section 25.5), writes the same JSON both
// back to the client (for the local download) and into the event's own storage folder as
// `_GUID.json` (Section 25.6) - the file the downstream Desktop app reads directly from
// Azure Storage to validate the event before downloading anything.
eventsRouter.post(
  "/:eventId/export",
  requireSession,
  requireRole("SuperAdmin", "Administrator"),
  eventExportLimiter,
  async (req, res) => {
    const eventRows = await query(
      "SELECT event_id, event_name, year, status FROM events WHERE event_id = ?",
      [req.params.eventId]
    );
    if (eventRows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    const event = eventRows[0];

    const tableRows = await query(
      "SELECT table_number, inner_led, outer_led, main_led FROM event_tables WHERE event_id = ? ORDER BY table_number",
      [event.event_id]
    );

    const exportGuid = randomUUID();
    const containerClient = getContainerClient(String(event.year));
    const eventStorageUrl = `${containerClient.url}/${encodeURIComponent(
      buildEventFolderName(event.event_id, event.event_name)
    )}`;

    // Web BRD Section 25.4's exact field list - a downstream (non-JS) consumer parses
    // this literally, so the field names here are not stylistic choices to "fix" into
    // this codebase's usual camelCase-from-snake_case convention; they already are what
    // the spec requires.
    const exportContent = {
      eventId: event.event_id,
      eventName: event.event_name,
      eventStorageUrl,
      tables: tableRows.map((t) => ({
        tableNumber: t.table_number,
        innerLed: !!t.inner_led,
        outerLed: !!t.outer_led,
        mainLed: !!t.main_led,
      })),
      exportedByUsername: req.user.username,
      exportedByRole: req.user.role,
      exportTimestamp: new Date().toISOString(),
      exportGuid,
    };

    // Section 25.5: persisted before the storage write, so a storage failure still
    // leaves the DB holding the same GUID that would be in a retried export - no window
    // where the two could disagree if the client retries after a transient failure.
    await query("UPDATE events SET export_guid = ? WHERE event_id = ?", [exportGuid, event.event_id]);

    try {
      await writeExportGuidFile({
        year: event.year,
        eventId: event.event_id,
        eventName: event.event_name,
        content: exportContent,
      });
    } catch (err) {
      console.error(`Failed to write _GUID.json for event "${event.event_id}":`, err);
      err.status = 500;
      err.message =
        "The export GUID was recorded, but writing _GUID.json to storage failed. Please try exporting again.";
      throw err;
    }

    res.json(exportContent);
  }
);

// Archive (user-requested, 2026-09-18, beyond the original BRD scope - Web BRD Section 5
// itself explicitly says the archiving feature "is reserved for future implementation
// and is not built as part of this scope," but the user has now explicitly asked for it;
// documented as a deliberate scope extension in workflow.md, not a silent BRD deviation).
// SuperAdmin/Administrator only - same role gate as Export Event, since both are
// event-list-level actions the Normal User must never see. One-way from the UI's
// perspective: there is no unarchive action built (not requested), though the data
// itself is untouched - an archived event simply stops appearing in GET /api/events'
// existing `WHERE status = 'Active'` filter, so no changes were needed there.
eventsRouter.patch(
  "/:eventId/archive",
  requireSession,
  requireRole("SuperAdmin", "Administrator"),
  eventArchiveLimiter,
  async (req, res) => {
    const eventRows = await query("SELECT event_id, status FROM events WHERE event_id = ?", [
      req.params.eventId,
    ]);
    if (eventRows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (eventRows[0].status === "Archive") {
      return res.status(409).json({ error: "This event is already archived" });
    }

    await query("UPDATE events SET status = 'Archive', updated_by = ? WHERE event_id = ?", [
      req.user.username,
      req.params.eventId,
    ]);
    res.json({ eventId: req.params.eventId, status: "Archive" });
  }
);

// Step 9 (Web BRD Section 30): Event Log Tab. Read-only view of the same change-log data
// Section 24/29 already write - "does not introduce a separate storage location or data
// source" (Section 30's own text). Open to every signed-in role (no requireRole gate):
// unlike Export/Archive this isn't a destructive or list-level action, it's a per-event
// audit trail, and a Normal User who can open an event to upload assets has an equally
// legitimate reason to see what changed on it. Sorted newest-first per Section 30.
eventsRouter.get("/:eventId/log", requireSession, async (req, res) => {
  const eventRows = await query(
    "SELECT event_id, event_name, year FROM events WHERE event_id = ?",
    [req.params.eventId]
  );
  if (eventRows.length === 0) {
    return res.status(404).json({ error: "Event not found" });
  }
  const event = eventRows[0];

  const entries = await readChangeLogEntries({
    year: event.year,
    eventId: event.event_id,
    eventName: event.event_name,
  });
  entries.sort((a, b) => b.changetimestamp.localeCompare(a.changetimestamp));

  res.json({ entries });
});

const SEND_MAIL_SCOPES = ["session", "24h", "all"];

// User feedback (2026-09-19, see workflow.md), second round: the first version of this
// route filtered `scope` on top of an "unsent since the last send" watermark
// (`email_last_sent_sno`) - in testing this meant every scope quietly collapsed to the
// same small set (whatever hadn't been marked sent yet), which looked like "scope isn't
// filtering, it always sends only the current session's changes." Simplified per the
// user's explicit correction: each scope now filters the event's *entire* change-log
// history directly (no watermark), and *any* successful send - whichever scope - clears
// `email_pending`. `email_last_sent_sno` was dropped entirely (migration
// 011_drop_email_last_sent_sno.sql) rather than left as dead, confusing state.
// - "session": only entries logged since the caller's own login (JWT `iat`).
// - "24h": only entries logged in the last 24 hours.
// - "all" (default): every entry ever logged for this event, no time filter.
//
// Third round of user feedback: `email_pending` used to also *gate* sending ("no changes
// to send" once cleared), which silently blocked every option after the first successful
// send in a session - a "recap" send (e.g. "All changes" a second time) was expected to
// always work as long as the event has any logged history at all, not just once.
// `email_pending` is now purely a UI hint (the Dashboard/Send Mail button's red
// indicator, set by appendChangeLogEntry() on a new change, cleared here after a send) -
// it never blocks the send action itself; only an empty `toSend` (nothing in the chosen
// scope, or no history at all) does that.
eventsRouter.post("/:eventId/send-change-log-email", requireSession, sendMailLimiter, async (req, res) => {
  const scope = SEND_MAIL_SCOPES.includes(req.body?.scope) ? req.body.scope : "all";

  const eventRows = await query("SELECT event_id, event_name, year FROM events WHERE event_id = ?", [
    req.params.eventId,
  ]);
  if (eventRows.length === 0) {
    return res.status(404).json({ error: "Event not found" });
  }
  const event = eventRows[0];

  const entries = await readChangeLogEntries({
    year: event.year,
    eventId: event.event_id,
    eventName: event.event_name,
  });

  let cutoffMs = null;
  if (scope === "session") {
    cutoffMs = req.user.iat * 1000;
  } else if (scope === "24h") {
    cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  }
  const toSend = cutoffMs === null ? entries : entries.filter((e) => new Date(e.changetimestamp).getTime() >= cutoffMs);

  if (toSend.length === 0) {
    return res.json({ sent: false, message: "No changes to send for the selected time range." });
  }

  // Web BRD Section 29 field list has no explicit ordering; user-requested (2026-09-19):
  // newest first, matching the Event Log Tab's own sort (Web BRD Section 30).
  toSend.sort((a, b) => b.changetimestamp.localeCompare(a.changetimestamp));

  try {
    await sendChangeLogEmail({ eventId: event.event_id, eventName: event.event_name, entries: toSend });
  } catch (err) {
    console.error(`Failed to send Change Log Email for event "${event.event_id}":`, err);
    err.status = 502;
    err.message = "Could not send the Change Log Email. Please try again.";
    throw err;
  }

  // User-requested (2026-09-19): resets regardless of which scope was actually sent.
  await query("UPDATE events SET email_pending = FALSE WHERE event_id = ?", [event.event_id]);

  res.json({ sent: true, entriesSent: toSend.length, scope });
});
