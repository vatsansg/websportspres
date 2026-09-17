import { Router } from "express";
import multer from "multer";
import { query } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { config } from "../config/env.js";
import { OVR_TRIGGER_TYPES, ALL_SPONSOR_LOGO, findOvrTriggerType } from "./templateConfig.js";
import { validateOvrTriggerFilename, validateOvrTriggerMedia } from "../media/ovrTriggerValidation.js";
import { isBlobSafeFilename } from "../media/sponsorAdValidation.js";
import {
  ovrTriggerFileExists,
  uploadOvrTriggerFile,
  downloadOvrTriggerFile,
  deleteOvrTriggerFile,
  copyOvrTriggerFileWithinFolder,
} from "../storage/ovrTriggers.js";
import { appendChangeLogEntry } from "../logging/assetChangeLog.js";

// mergeParams: true - mounted at /api/events/:eventId/tables/:tableNumber/ovr-triggers.
export const ovrTriggersRouter = Router({ mergeParams: true });

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

async function loadEventTableContext(req, res, next) {
  const { eventId, tableNumber } = req.params;
  const eventRows = await query(
    "SELECT event_id, event_name, year, status FROM events WHERE event_id = ?",
    [eventId]
  );
  if (eventRows.length === 0) return res.status(404).json({ error: "Event not found" });

  const tableRows = await query(
    `SELECT table_number, inner_led, outer_led, main_led,
            inner_resolution_width, inner_resolution_height,
            outer_resolution_width, outer_resolution_height,
            main_resolution_width, main_resolution_height
     FROM event_tables WHERE event_id = ? AND table_number = ?`,
    [eventId, tableNumber]
  );
  if (tableRows.length === 0) return res.status(404).json({ error: "Table not found for this event" });

  const t = tableRows[0];
  req.eventContext = {
    year: eventRows[0].year,
    eventId: eventRows[0].event_id,
    eventName: eventRows[0].event_name,
    tableNumber: Number(tableNumber),
    table: {
      innerLed: !!t.inner_led,
      outerLed: !!t.outer_led,
      mainLed: !!t.main_led,
      innerResolution: { width: t.inner_resolution_width, height: t.inner_resolution_height },
      outerResolution: { width: t.outer_resolution_width, height: t.outer_resolution_height },
      mainResolution: { width: t.main_resolution_width, height: t.main_resolution_height },
    },
  };
  next();
}

// Web BRD Sections 3.1/16: a destination is only offered if the table's own LED config
// enables it - unlike Sponsor Ads, OVR Triggers DO use Main LED.
function requireValidDestination(req, res, next) {
  const { destination } = req.params;
  if (destination !== "inner" && destination !== "outer" && destination !== "main") {
    return res.status(400).json({ error: 'Destination must be "inner", "outer", or "main"' });
  }
  const enabledKey = destination === "inner" ? "innerLed" : destination === "outer" ? "outerLed" : "mainLed";
  if (!req.eventContext.table[enabledKey]) {
    return res.status(400).json({ error: `${destination} LED is not enabled for this table` });
  }
  next();
}

function resolutionForDestination(table, destination) {
  if (destination === "inner") return table.innerResolution;
  if (destination === "outer") return table.outerResolution;
  return table.mainResolution;
}

// Web BRD Section 18.1: physically enforces the "winner.mp4 falls back to a copy of
// default.mp4" rule. Never overwrites a real (non-empty) winner.mp4 - only copies the
// default in when winner.mp4 is genuinely absent or still the empty placeholder. Called
// after default.mp4 changes and after winner.mp4 is deleted, so the slot never sits
// truly empty while a usable default exists. Logs its own change-log "New" entry when it
// actually performs the copy - same audit-completeness fix the independent review applied
// to sponsorsequence.csv's implicit rewrites in Step 3, since this silently changes
// winner.mp4's content on disk too. Tags the copy with fallbackCopy=true blob metadata
// (independent architect review: without this, the "usingFallback" status flag/UI tag
// could never actually report true, since by the time any status check ran the file
// already existed) - a later real upload of winner.mp4 fully overwrites the blob and its
// metadata, so the tag clears itself with no extra bookkeeping needed.
async function applyWinningMomentFallback(ctx, username) {
  const winnerStatus = await ovrTriggerFileExists(ctx, "winner.mp4");
  if (winnerStatus.exists && winnerStatus.sizeBytes > 0) return;
  const defaultStatus = await ovrTriggerFileExists(ctx, "default.mp4");
  if (defaultStatus.exists && defaultStatus.sizeBytes > 0) {
    // Lowercase key: the Azure SDK lowercases blob metadata keys on read (Node normalizes
    // the x-ms-meta-* header names), so a camelCase key here would never match on lookup.
    await copyOvrTriggerFileWithinFolder(ctx, "default.mp4", "winner.mp4", { fallbackcopy: "true" });
    await appendChangeLogEntry({
      year: ctx.year,
      eventId: ctx.eventId,
      eventName: ctx.eventName,
      filename: changeLogPath(ctx.tableNumber, ctx.destination, "winner.mp4"),
      status: "New",
      username,
    });
  }
}

function changeLogPath(tableNumber, destination, filename) {
  const destinationLabel = destination === "inner" ? "Inner" : destination === "outer" ? "Outer" : "MainLED";
  return `Table ${tableNumber}/${destinationLabel}/${filename}`;
}

/**
 * Resolves an "assetKey" (a URL-safe identifier for one upload slot) to everything the
 * upload/delete/preview handlers need. Unifies the three asset families this router
 * covers (standard OVR triggers, All Sponsor Logo, Default Assets) behind one shape so
 * the routes below don't need one branch per family per action.
 */
function resolveAssetSlot(destination, assetKey) {
  if (assetKey === "default.image" || assetKey === "default.video") {
    // Default Assets exist uniformly for inner/outer/main - no extra destination gate
    // needed beyond requireValidDestination, which already only allows enabled LED types.
    const kind = assetKey === "default.image" ? "image" : "video";
    return {
      kind,
      filenameRule: "any",
      storageFilename: kind === "image" ? "default.png" : "default.mp4",
    };
  }

  if (assetKey === "all_sponsor_logo.image") {
    if (destination === "main") return null; // Web BRD Section 22: Inner/Outer only.
    return {
      kind: "image",
      filenameRule: ALL_SPONSOR_LOGO.filenameRule,
      requiredFilename: ALL_SPONSOR_LOGO.requiredFilename,
      storageFilename: ALL_SPONSOR_LOGO.storageFilename,
      saveToBothInnerAndOuter: true,
    };
  }

  const [triggerId, kind] = assetKey.split(".");
  const triggerType = findOvrTriggerType(triggerId);
  if (!triggerType || (kind !== "image" && kind !== "video")) return null;
  if (!triggerType.destinations.includes(destination)) return null;
  const fileConfig = triggerType.files.find((f) => f.kind === kind);
  if (!fileConfig) return null;
  return { ...fileConfig, kind };
}

ovrTriggersRouter.use(requireSession, loadEventTableContext);

// Status for every applicable asset slot at this destination - trigger types, Default
// Assets, and All Sponsor Logo where relevant - in one call, so the UI isn't making a
// dozen round trips to render one destination's page.
ovrTriggersRouter.get("/:destination", requireValidDestination, async (req, res) => {
  const { destination } = req.params;
  const ctx = { ...req.eventContext, destination };
  const slots = [];

  for (const triggerType of OVR_TRIGGER_TYPES) {
    if (!triggerType.destinations.includes(destination)) continue;
    for (const fileConfig of triggerType.files) {
      const assetKey = `${triggerType.id}.${fileConfig.kind}`;
      const status = await ovrTriggerFileExists(ctx, fileConfig.storageFilename);
      slots.push({
        assetKey,
        triggerId: triggerType.id,
        label: triggerType.label,
        kind: fileConfig.kind,
        optional: !!triggerType.optional,
        exists: status.exists,
        // Reads the fallbackCopy blob-metadata tag applyWinningMomentFallback() sets -
        // status.exists alone can't distinguish a real upload from a fallback copy, since
        // the fallback is physically enforced (the file already exists by the time this
        // runs). See storage/ovrTriggers.js.
        usingFallback: !!fileConfig.fallbackFrom && status.exists && status.metadata?.fallbackcopy === "true",
      });
    }
  }

  if (destination !== "main") {
    const logoStatus = await ovrTriggerFileExists(ctx, ALL_SPONSOR_LOGO.storageFilename);
    slots.push({
      assetKey: "all_sponsor_logo.image",
      triggerId: "all_sponsor_logo",
      label: ALL_SPONSOR_LOGO.label,
      kind: "image",
      optional: true,
      exists: logoStatus.exists,
      usingFallback: false,
    });
  }

  const defaultPng = await ovrTriggerFileExists(ctx, "default.png");
  const defaultMp4 = await ovrTriggerFileExists(ctx, "default.mp4");
  slots.push(
    {
      assetKey: "default.image",
      triggerId: "default",
      label: "Default Image",
      kind: "image",
      optional: true,
      exists: defaultPng.exists && defaultPng.sizeBytes > 0,
      usingFallback: false,
    },
    {
      assetKey: "default.video",
      triggerId: "default",
      label: "Default Video",
      kind: "video",
      optional: true,
      exists: defaultMp4.exists && defaultMp4.sizeBytes > 0,
      usingFallback: false,
    }
  );

  res.json({ slots });
});

ovrTriggersRouter.post(
  "/:destination/:assetKey/upload",
  requireValidDestination,
  handleUpload,
  async (req, res) => {
    const { destination, assetKey } = req.params;
    const slot = resolveAssetSlot(destination, assetKey);
    if (!slot) return res.status(404).json({ error: "Unknown asset type for this destination" });
    if (!req.file) return res.status(400).json({ error: "No file was provided" });

    const filenameError = !isBlobSafeFilename(req.file.originalname)
      ? "Filename contains invalid characters"
      : validateOvrTriggerFilename(req.file.originalname, slot);
    if (filenameError) return res.status(400).json({ error: filenameError });

    const expectedResolution = resolutionForDestination(req.eventContext.table, destination);
    const mediaError = validateOvrTriggerMedia(req.file.buffer, slot.kind, expectedResolution);
    if (mediaError) return res.status(400).json({ error: mediaError });

    const ctx = { ...req.eventContext, destination };
    // Independent architect review: saveToBothInnerAndOuter must not write into a
    // sibling destination the table itself has disabled - requireValidDestination only
    // gates the URL's own :destination, not the "also save to" side of a dual-folder
    // asset like All Sponsor Logo.
    const destinationsToSave = (slot.saveToBothInnerAndOuter ? ["inner", "outer"] : [destination]).filter(
      (dest) => dest === "main" || req.eventContext.table[dest === "inner" ? "innerLed" : "outerLed"]
    );
    for (const dest of destinationsToSave) {
      const saveCtx = { ...req.eventContext, destination: dest };
      await uploadOvrTriggerFile(saveCtx, slot.storageFilename, req.file.buffer, req.file.mimetype);
      await appendChangeLogEntry({
        year: req.eventContext.year,
        eventId: req.eventContext.eventId,
        eventName: req.eventContext.eventName,
        filename: changeLogPath(req.eventContext.tableNumber, dest, slot.storageFilename),
        status: "New",
        username: req.user.username,
      });
      if (slot.additionalCopy) {
        // Independent architect review: this write changes default.png's real content
        // (the same slot the Default Assets feature reads/writes) with no audit entry -
        // same class of gap as the Winning Moment fallback's D-01 fix, generalized here.
        await copyOvrTriggerFileWithinFolder(saveCtx, slot.storageFilename, slot.additionalCopy);
        await appendChangeLogEntry({
          year: req.eventContext.year,
          eventId: req.eventContext.eventId,
          eventName: req.eventContext.eventName,
          filename: changeLogPath(req.eventContext.tableNumber, dest, slot.additionalCopy),
          status: "New",
          username: req.user.username,
        });
      }
      if (assetKey === "default.video") {
        await applyWinningMomentFallback(saveCtx, req.user.username);
      }
    }
    res.json({ ok: true });
  }
);

ovrTriggersRouter.delete("/:destination/:assetKey", requireValidDestination, async (req, res) => {
  const { destination, assetKey } = req.params;
  const slot = resolveAssetSlot(destination, assetKey);
  if (!slot) return res.status(404).json({ error: "Unknown asset type for this destination" });

  // Independent architect review: dual-folder deletes must respect the sibling
  // destination's own LED enablement too, same reasoning as the upload handler above.
  const destinationsToDelete = (slot.saveToBothInnerAndOuter ? ["inner", "outer"] : [destination]).filter(
    (dest) => dest === "main" || req.eventContext.table[dest === "inner" ? "innerLed" : "outerLed"]
  );
  for (const dest of destinationsToDelete) {
    const ctx = { ...req.eventContext, destination: dest };
    await deleteOvrTriggerFile(ctx, slot.storageFilename);
    // additionalCopy (Home Look -> default.png) is deliberately one-directional: upload
    // sets the Default Image, but delete does not retract it. default.png is also the
    // independently-manageable Default Assets slot - cascading its deletion here would
    // silently destroy a Default Image the user may have set separately afterward, with
    // no relationship to this Home Look file at all. See workflow.md for this judgment
    // call (independent architect review originally flagged the missing audit log for
    // the old cascade-delete behavior; removing the cascade is a more complete fix).
    await appendChangeLogEntry({
      year: req.eventContext.year,
      eventId: req.eventContext.eventId,
      eventName: req.eventContext.eventName,
      filename: changeLogPath(req.eventContext.tableNumber, dest, slot.storageFilename),
      status: "Deleted",
      username: req.user.username,
    });
    if (assetKey === "winning_moment.video") {
      await applyWinningMomentFallback(ctx, req.user.username);
    }
  }
  res.json({ ok: true });
});

// Web BRD Section 28: OVR Trigger Preview - lets the frontend view/play the currently
// saved file before the user confirms a further action. Streams the raw bytes back with
// a content-type the browser can render directly.
ovrTriggersRouter.get("/:destination/:assetKey/preview", requireValidDestination, async (req, res) => {
  const { destination, assetKey } = req.params;
  const slot = resolveAssetSlot(destination, assetKey);
  if (!slot) return res.status(404).json({ error: "Unknown asset type for this destination" });

  const ctx = { ...req.eventContext, destination };
  const status = await ovrTriggerFileExists(ctx, slot.storageFilename);
  if (!status.exists) return res.status(404).json({ error: "File not found" });

  const buffer = await downloadOvrTriggerFile(ctx, slot.storageFilename);
  res.set("Content-Type", slot.kind === "image" ? "image/png" : "video/mp4");
  res.send(buffer);
});
