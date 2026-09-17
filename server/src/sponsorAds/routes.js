import { Router } from "express";
import multer from "multer";
import { body, validationResult } from "express-validator";
import { query } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { config } from "../config/env.js";
import { validateSponsorAdFile, isVideoFilename, isBlobSafeFilename } from "../media/sponsorAdValidation.js";
import { parseMp4Metadata } from "../media/mp4Metadata.js";
import {
  listSponsorAdFiles,
  uploadSponsorAdFile,
  sponsorAdFileExists,
  downloadSponsorAdFile,
  deleteSponsorAdFile,
  saveSponsorAdSequence,
  removeFromSponsorAdSequence,
} from "../storage/sponsorAds.js";
import { appendChangeLogEntry } from "../logging/assetChangeLog.js";

// mergeParams: true - this router is mounted at
// /api/events/:eventId/tables/:tableNumber/sponsor-ads in app.js, and needs those two
// parent-route params alongside its own :destination/:filename.
export const sponsorAdsRouter = Router({ mergeParams: true });

// memoryStorage buffers the entire multipart body before any handler/validation runs, so
// fileSize alone isn't enough - an unbounded number of near-limit parts in one request
// could still exhaust worker memory before a single byte gets validated. Cap the part
// count too; 50 is generous for a single Sponsor Ads batch upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxVideoUploadMb * 1024 * 1024, files: 50 },
});

async function loadEventTableContext(req, res, next) {
  const { eventId, tableNumber } = req.params;
  const eventRows = await query(
    "SELECT event_id, event_name, year, status FROM events WHERE event_id = ?",
    [eventId]
  );
  if (eventRows.length === 0) return res.status(404).json({ error: "Event not found" });

  const tableRows = await query(
    "SELECT table_number, inner_led, outer_led FROM event_tables WHERE event_id = ? AND table_number = ?",
    [eventId, tableNumber]
  );
  if (tableRows.length === 0) return res.status(404).json({ error: "Table not found for this event" });

  req.eventContext = {
    year: eventRows[0].year,
    eventId: eventRows[0].event_id,
    eventName: eventRows[0].event_name,
    tableNumber: Number(tableNumber),
    table: { innerLed: !!tableRows[0].inner_led, outerLed: !!tableRows[0].outer_led },
  };
  next();
}

// Web BRD Section 11.1: only Inner/Outer are ever valid Sponsor Ads destinations, and only
// when actually enabled for this specific table - Main LED is rejected regardless of the
// table's own LED config, and a disabled Inner/Outer is rejected too.
function requireValidDestination(req, res, next) {
  const { destination } = req.params;
  if (destination !== "inner" && destination !== "outer") {
    return res.status(400).json({ error: 'Destination must be "inner" or "outer"' });
  }
  const enabled = destination === "inner" ? req.eventContext.table.innerLed : req.eventContext.table.outerLed;
  if (!enabled) {
    return res.status(400).json({ error: `${destination} LED is not enabled for this table` });
  }
  next();
}

// Change-log filename column: Web BRD Section 24's own example ("Table 1/Inner/...")
// capitalizes the LED destination, even though the actual storage folder is lowercase
// (Step 2's deliberate deviation to match the real sample event). This is a purely
// descriptive audit string, not a literal blob path, so it follows the BRD's casing.
function changeLogPath(tableNumber, destination, filename) {
  const destinationLabel = destination === "inner" ? "Inner" : "Outer";
  return `Table ${tableNumber}/${destinationLabel}/${filename}`;
}

// Defense-in-depth for routes that take a filename from the URL path (delete, duration
// retrieval): Azure Blob Storage's flat namespace means a "/" can't actually escape the
// server-computed folder prefix, but rejecting it early avoids confusingly-nested blob
// names and keeps this consistent with Step 2's eventId/eventName safety check.
function requireBlobSafeFilename(req, res, next) {
  if (!isBlobSafeFilename(req.params.filename)) {
    return res.status(400).json({ error: "Filename contains invalid characters" });
  }
  next();
}

// multer's own errors (file too large, too many files) throw synchronously into the
// upload middleware's callback rather than via the normal Express next(err) flow that
// Express 5 auto-forwards for async handlers - without this wrapper they'd fall through to
// the generic error handler as an unhelpful 500 instead of a clean, specific 400.
function handleUpload(req, res, next) {
  upload.array("files")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: `A file exceeds the maximum allowed size (${config.maxVideoUploadMb}MB)` });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Too many files in one upload (maximum 50)" });
    }
    next(err);
  });
}

sponsorAdsRouter.use(requireSession, loadEventTableContext);

sponsorAdsRouter.get("/:destination", requireValidDestination, async (req, res) => {
  const files = await listSponsorAdFiles({ ...req.eventContext, destination: req.params.destination });
  res.json(files);
});

sponsorAdsRouter.post(
  "/:destination/upload",
  requireValidDestination,
  handleUpload,
  async (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No files were provided" });
    }

    const results = [];
    for (const file of files) {
      const validationError = validateSponsorAdFile(file.originalname, file.buffer);
      if (validationError) {
        results.push({ filename: file.originalname, ok: false, error: validationError });
        continue;
      }
      await uploadSponsorAdFile(
        { ...req.eventContext, destination: req.params.destination },
        { filename: file.originalname, buffer: file.buffer, contentType: file.mimetype }
      );
      await appendChangeLogEntry({
        year: req.eventContext.year,
        eventId: req.eventContext.eventId,
        eventName: req.eventContext.eventName,
        filename: changeLogPath(req.eventContext.tableNumber, req.params.destination, file.originalname),
        status: "New",
        username: req.user.username,
      });
      results.push({ filename: file.originalname, ok: true });
    }
    res.json({ results });
  }
);

sponsorAdsRouter.put(
  "/:destination/sequence",
  requireValidDestination,
  body("files").isArray(),
  body("files.*.filename").isString().notEmpty(),
  body("files.*.duration").optional({ nullable: true }).isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }

    const ctx = { ...req.eventContext, destination: req.params.destination };
    for (const f of req.body.files) {
      const exists = await sponsorAdFileExists(ctx, f.filename);
      if (!exists) {
        return res.status(400).json({ error: `File "${f.filename}" was not found in this folder` });
      }
    }

    await saveSponsorAdSequence(ctx, req.body.files);
    await appendChangeLogEntry({
      year: req.eventContext.year,
      eventId: req.eventContext.eventId,
      eventName: req.eventContext.eventName,
      filename: changeLogPath(req.eventContext.tableNumber, req.params.destination, "sponsorsequence.csv"),
      status: "Updated",
      username: req.user.username,
    });
    res.json({ ok: true });
  }
);

sponsorAdsRouter.delete(
  "/:destination/:filename",
  requireValidDestination,
  requireBlobSafeFilename,
  async (req, res) => {
    const ctx = { ...req.eventContext, destination: req.params.destination };
    const exists = await sponsorAdFileExists(ctx, req.params.filename);
    if (!exists) return res.status(404).json({ error: "File not found" });

    // Must run before the delete below: it detects whether the file was sequenced by
    // checking the current blob listing against sponsorsequence.csv, which only works
    // while the blob (and therefore the merged listing) still includes it.
    const sequenceRewritten = await removeFromSponsorAdSequence(ctx, req.params.filename);
    await deleteSponsorAdFile(ctx, req.params.filename);
    await appendChangeLogEntry({
      year: req.eventContext.year,
      eventId: req.eventContext.eventId,
      eventName: req.eventContext.eventName,
      filename: changeLogPath(req.eventContext.tableNumber, req.params.destination, req.params.filename),
      status: "Deleted",
      username: req.user.username,
    });
    // The delete implicitly rewrote sponsorsequence.csv to drop this file's row - that's a
    // real content change to a real file, so it needs its own audit entry too (Web BRD
    // Section 24), same as the explicit PUT .../sequence route already logs.
    if (sequenceRewritten) {
      await appendChangeLogEntry({
        year: req.eventContext.year,
        eventId: req.eventContext.eventId,
        eventName: req.eventContext.eventName,
        filename: changeLogPath(req.eventContext.tableNumber, req.params.destination, "sponsorsequence.csv"),
        status: "Updated",
        username: req.user.username,
      });
    }
    res.json({ ok: true });
  }
);

// Web BRD Section 27/Step 3.1: synchronous, on-demand video duration retrieval - not run
// automatically at upload time.
sponsorAdsRouter.post(
  "/:destination/:filename/duration",
  requireValidDestination,
  requireBlobSafeFilename,
  async (req, res) => {
    const { filename } = req.params;
    if (!isVideoFilename(filename)) {
      return res.status(400).json({ error: "Duration retrieval only applies to video files" });
    }
    const ctx = { ...req.eventContext, destination: req.params.destination };
    const exists = await sponsorAdFileExists(ctx, filename);
    if (!exists) return res.status(404).json({ error: "File not found" });

    const buffer = await downloadSponsorAdFile(ctx, filename);
    const meta = parseMp4Metadata(buffer);
    if (!meta) {
      return res.status(422).json({ error: "Could not read video metadata from this file" });
    }
    res.json({ durationSeconds: Math.round(meta.durationSeconds) });
  }
);
