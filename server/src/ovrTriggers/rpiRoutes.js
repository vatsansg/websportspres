import { Router } from "express";
import multer from "multer";
import { query } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { config } from "../config/env.js";
import { findOvrTriggerType } from "./templateConfig.js";
import { validateOvrTriggerFilename, validateOvrTriggerMedia } from "../media/ovrTriggerValidation.js";
import { isBlobSafeFilename } from "../media/sponsorAdValidation.js";
import {
  ovrTriggerFileExists,
  uploadOvrTriggerFile,
  downloadOvrTriggerFile,
  deleteOvrTriggerFile,
} from "../storage/ovrTriggers.js";
import { appendChangeLogEntry } from "../logging/assetChangeLog.js";

// mergeParams: true - mounted at /api/events/:eventId/ovr-triggers/rpi. Web BRD Section
// 21: RPI Home Look is event-level (the event's single rpi folder), not per-table -
// deliberately a separate router rather than another destination value on the
// table-scoped ovrTriggersRouter, since there is no table dimension here at all.
export const rpiRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxVideoUploadMb * 1024 * 1024, files: 1 },
});

function handleUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: `File exceeds the maximum allowed size (${config.maxVideoUploadMb}MB)` });
    }
    next(err);
  });
}

async function loadEventContext(req, res, next) {
  const { eventId } = req.params;
  const eventRows = await query(
    "SELECT event_id, event_name, year, status FROM events WHERE event_id = ?",
    [eventId]
  );
  if (eventRows.length === 0) return res.status(404).json({ error: "Event not found" });

  req.eventContext = {
    year: eventRows[0].year,
    eventId: eventRows[0].event_id,
    eventName: eventRows[0].event_name,
    destination: "rpi",
  };
  next();
}

// Web BRD Section 17/31: resolution config is per-table, per Inner/Outer/Main LED - RPI
// has no equivalent column anywhere, so it validates against the fixed Surrounds default
// (1920x1080) rather than a per-table override. Documented judgment call, not literal BRD
// text - flagged for the user in workflow.md.
export const RPI_RESOLUTION = { width: 1920, height: 1080 };

rpiRouter.use(requireSession, loadEventContext);

rpiRouter.get("/", async (req, res) => {
  const status = await ovrTriggerFileExists(req.eventContext, "HOME_Look.png");
  res.json({ exists: status.exists });
});

rpiRouter.post("/upload", handleUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was provided" });

  const triggerType = findOvrTriggerType("rpi_home_look");
  const fileConfig = triggerType.files[0];

  const filenameError = !isBlobSafeFilename(req.file.originalname)
    ? "Filename contains invalid characters"
    : validateOvrTriggerFilename(req.file.originalname, fileConfig);
  if (filenameError) return res.status(400).json({ error: filenameError });

  const mediaError = validateOvrTriggerMedia(req.file.buffer, "image", RPI_RESOLUTION);
  if (mediaError) return res.status(400).json({ error: mediaError });

  await uploadOvrTriggerFile(req.eventContext, fileConfig.storageFilename, req.file.buffer, req.file.mimetype);
  await appendChangeLogEntry({
    year: req.eventContext.year,
    eventId: req.eventContext.eventId,
    eventName: req.eventContext.eventName,
    filename: `RPI/${fileConfig.storageFilename}`,
    status: "New",
    username: req.user.username,
  });
  res.json({ ok: true });
});

rpiRouter.delete("/", async (req, res) => {
  await deleteOvrTriggerFile(req.eventContext, "HOME_Look.png");
  await appendChangeLogEntry({
    year: req.eventContext.year,
    eventId: req.eventContext.eventId,
    eventName: req.eventContext.eventName,
    filename: "RPI/HOME_Look.png",
    status: "Deleted",
    username: req.user.username,
  });
  res.json({ ok: true });
});

rpiRouter.get("/preview", async (req, res) => {
  const status = await ovrTriggerFileExists(req.eventContext, "HOME_Look.png");
  if (!status.exists) return res.status(404).json({ error: "File not found" });
  const buffer = await downloadOvrTriggerFile(req.eventContext, "HOME_Look.png");
  res.set("Content-Type", "image/png");
  res.send(buffer);
});
