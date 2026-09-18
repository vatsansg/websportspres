import { Router } from "express";
import { requireSession } from "../auth/session.js";
import { requireRole } from "../auth/requireRole.js";
import { config } from "../config/env.js";
import { getOvrTriggerTypes, getAllSponsorLogo, getRawConfig, saveTemplatesConfig } from "../ovrTriggers/templatesStore.js";
import { RPI_RESOLUTION } from "../ovrTriggers/rpiRoutes.js";
import { IMAGE_SPEC, FORBIDDEN_FILENAME_TERMS } from "../media/sponsorAdValidation.js";

// View-only reference for the "Asset Management Settings" popup (Web BRD's asset-naming/
// validation rules, in one place) - single-sourced from the same live config every
// validation route actually reads (server/src/ovrTriggers/templatesStore.js, Web BRD
// Section 18's blob-storage-backed config), so this can never drift out of sync with
// real behavior. GET is available to every authenticated role; Step 5's Edit/Save
// (/raw below) is restricted to Admin/SuperAdmin, per the user's explicit request.
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
    ovrTriggers: getOvrTriggerTypes().map((trigger) => ({
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
    allSponsorLogo: (() => {
      const allSponsorLogo = getAllSponsorLogo();
      return {
        label: allSponsorLogo.label,
        destinations: allSponsorLogo.destinations,
        requiredFilename: allSponsorLogo.requiredFilename,
        storageFilename: allSponsorLogo.storageFilename,
      };
    })(),
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

// Step 5: the raw, editable config (ovrTriggerTypes + allSponsorLogo, exactly as stored
// in the templates container) - the curated view above is a read-only summary shaped
// for the popup and isn't a faithful round-trip of the underlying JSON, so editing needs
// its own pair of endpoints rather than reusing GET "/". Admin/SuperAdmin only (Security
// Checklist: this configuration drives every OVR Trigger validation rule in the app).
assetRulesRouter.get("/raw", requireRole("SuperAdmin", "Administrator"), (req, res) => {
  res.json(getRawConfig());
});

assetRulesRouter.put("/raw", requireRole("SuperAdmin", "Administrator"), async (req, res) => {
  try {
    const saved = await saveTemplatesConfig(req.body);
    res.json(saved);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message, details: err.details });
    }
    throw err;
  }
});
