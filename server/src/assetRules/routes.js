import { Router } from "express";
import { requireSession } from "../auth/session.js";
import { config } from "../config/env.js";
import { OVR_TRIGGER_TYPES, ALL_SPONSOR_LOGO } from "../ovrTriggers/templateConfig.js";
import { RPI_RESOLUTION } from "../ovrTriggers/rpiRoutes.js";
import { IMAGE_SPEC, FORBIDDEN_FILENAME_TERMS } from "../media/sponsorAdValidation.js";

// View-only reference for the "Asset Management Settings" popup (Web BRD's asset-naming/
// validation rules, in one place) - single-sourced from the same constants the actual
// validation code runs against, so this can never drift out of sync with real behavior.
// Available to every authenticated role; Step 5 is expected to add Edit/Save here,
// restricted to Admin/SuperAdmin, per the user's explicit request.
export const assetRulesRouter = Router();

assetRulesRouter.use(requireSession);

assetRulesRouter.get("/", (req, res) => {
  res.json({
    sponsorAds: {
      destinations: ["inner", "outer"],
      allowedFormats: ["PNG", "MP4"],
      filenameMustNotContain: FORBIDDEN_FILENAME_TERMS.map((t) => t.toUpperCase()),
      image: { bitDepth: IMAGE_SPEC.bitsPerPixel, maxSizeMB: IMAGE_SPEC.maxBytes / (1024 * 1024) },
      video: { maxSizeMB: config.maxVideoUploadMb },
      resolution: {
        note: "Configured per table at event creation (defaults shown; a specific event's table may differ).",
        innerOuterDefault: { width: 1920, height: 1080 },
        mainLedDefault: { width: 3840, height: 2160 },
      },
    },
    ovrTriggers: OVR_TRIGGER_TYPES.map((trigger) => ({
      id: trigger.id,
      label: trigger.label,
      destinations: trigger.destinations,
      optional: !!trigger.optional,
      files: trigger.files.map((f) => ({
        kind: f.kind,
        filenameRule: f.filenameRule,
        requiredFilename: f.requiredFilename ?? null,
        storageFilename: f.storageFilename,
        additionalCopy: f.additionalCopy ?? null,
        fallbackFrom: f.fallbackFrom ?? null,
      })),
    })),
    allSponsorLogo: {
      label: ALL_SPONSOR_LOGO.label,
      destinations: ALL_SPONSOR_LOGO.destinations,
      requiredFilename: ALL_SPONSOR_LOGO.requiredFilename,
      storageFilename: ALL_SPONSOR_LOGO.storageFilename,
    },
    rpi: {
      label: "RPI Home Look",
      destinations: ["rpi"],
      filenameRule: "contains",
      requiredFilename: "16x9_1080 STILL",
      storageFilename: "HOME_Look.png",
      resolution: RPI_RESOLUTION,
    },
    defaultAssets: {
      label: "Default Assets",
      description:
        "One PNG + one MP4 slot per table/destination (Inner, Outer, Main LED). Used as the Winning Moment fallback source, and copied automatically into Home Look's default image.",
      storageFilenames: { image: "default.png", video: "default.mp4" },
    },
  });
});
