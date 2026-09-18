import { getTemplatesContainerClient } from "../storage/blobClient.js";
import { OVR_TRIGGER_TYPES as DEFAULT_OVR_TRIGGER_TYPES, ALL_SPONSOR_LOGO as DEFAULT_ALL_SPONSOR_LOGO } from "./templateConfig.js";

// Web BRD Section 18: "The configuration file must be stored in the ... Azure Storage
// Account" - this is that file's live home. Loaded into an in-memory cache at startup and
// refreshed on every save, so every request doesn't re-download it; every runtime consumer
// (ovrTriggers/routes.js, rpiRoutes.js, assetRules/routes.js) reads via the getters below,
// never templateConfig.js's static constants directly (those are seed data only).
const BLOB_NAME = "asset_management_templates.json";

let cache = null;

function defaultConfig() {
  return { ovrTriggerTypes: DEFAULT_OVR_TRIGGER_TYPES, allSponsorLogo: DEFAULT_ALL_SPONSOR_LOGO };
}

/** Call once at server startup, before the app accepts requests. */
export async function loadTemplatesConfig() {
  const container = getTemplatesContainerClient();
  const blob = container.getBlockBlobClient(BLOB_NAME);
  const exists = await blob.exists();
  if (!exists) {
    // First boot against this environment - seed the blob from the version-controlled
    // defaults so the file BRD Section 18 requires actually exists there from now on.
    cache = defaultConfig();
    await writeConfig(cache);
    return cache;
  }
  const buffer = await blob.downloadToBuffer();
  cache = JSON.parse(buffer.toString("utf8"));
  return cache;
}

function requireCache() {
  if (!cache) {
    throw new Error("Templates config accessed before loadTemplatesConfig() ran at startup");
  }
  return cache;
}

async function writeConfig(newConfig) {
  const container = getTemplatesContainerClient();
  const blob = container.getBlockBlobClient(BLOB_NAME);
  const buffer = Buffer.from(JSON.stringify(newConfig, null, 2), "utf8");
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: "application/json" } });
}

const VALID_DESTINATIONS = ["inner", "outer", "main", "rpi"];

function validateFileRule(label, file, errors) {
  if (!["image", "video"].includes(file.kind)) {
    errors.push(`${label}: file kind must be "image" or "video"`);
  }
  if (!["exact", "contains", "any"].includes(file.filenameRule)) {
    errors.push(`${label}: filenameRule must be "exact", "contains", or "any"`);
  }
  if (!file.storageFilename || typeof file.storageFilename !== "string") {
    errors.push(`${label}: storageFilename is required`);
  }
  // requiredFilename is mandatory for exact/contains (that's what's being matched
  // against) and meaningless for "any" (Web BRD Section 19.1's "no predefined required
  // upload filename" case) - the structured editor enforces this same rule client-side.
  if (["exact", "contains"].includes(file.filenameRule) && !file.requiredFilename) {
    errors.push(`${label}: requiredFilename is required when filenameRule is "${file.filenameRule}"`);
  }
}

// Step 5, tightened after the raw-JSON editor was replaced with a structured form
// (2026-09-18): this is defense in depth, not the only thing enforcing shape - the UI now
// can't produce most of what this used to need to catch, but any other API client still
// hits the same rules.
function validateShape(newConfig) {
  const errors = [];
  if (!newConfig || typeof newConfig !== "object") return ["Config must be an object"];
  if (!Array.isArray(newConfig.ovrTriggerTypes) || newConfig.ovrTriggerTypes.length === 0) {
    errors.push('"ovrTriggerTypes" must be a non-empty array');
  }
  if (!newConfig.allSponsorLogo || typeof newConfig.allSponsorLogo !== "object") {
    errors.push('"allSponsorLogo" must be an object');
  }
  if (errors.length > 0) return errors;

  const seenIds = new Set();
  for (const trigger of newConfig.ovrTriggerTypes) {
    if (!trigger.id || !trigger.label || !Array.isArray(trigger.destinations) || !Array.isArray(trigger.files)) {
      errors.push(`Trigger "${trigger.id ?? "(missing id)"}" is missing id/label/destinations/files`);
      continue;
    }
    if (seenIds.has(trigger.id)) errors.push(`Duplicate trigger id "${trigger.id}"`);
    seenIds.add(trigger.id);
    if (trigger.destinations.length === 0 || trigger.destinations.some((d) => !VALID_DESTINATIONS.includes(d))) {
      errors.push(`Trigger "${trigger.id}": destinations must be a non-empty subset of ${VALID_DESTINATIONS.join(", ")}`);
    }
    if (trigger.files.length === 0) {
      errors.push(`Trigger "${trigger.id}": at least one file rule is required`);
    }
    for (const file of trigger.files) {
      validateFileRule(`Trigger "${trigger.id}"`, file, errors);
    }
  }

  const logo = newConfig.allSponsorLogo;
  if (!logo.label) errors.push('"allSponsorLogo": label is required');
  if (!Array.isArray(logo.destinations) || logo.destinations.length === 0 || logo.destinations.some((d) => !VALID_DESTINATIONS.includes(d))) {
    errors.push(`"allSponsorLogo": destinations must be a non-empty subset of ${VALID_DESTINATIONS.join(", ")}`);
  }
  validateFileRule('"allSponsorLogo"', logo, errors);

  return errors;
}

/**
 * Step 5: Admin/Super Admin Edit/Save for the Asset Management Settings. Validates the
 * new config's shape (not full business-rule re-derivation - this is a config file, not
 * user input on a public form, and the person editing it is trusted staff), writes it to
 * blob storage, and refreshes the in-memory cache so subsequent requests see it
 * immediately without a restart.
 */
export async function saveTemplatesConfig(newConfig) {
  const errors = validateShape(newConfig);
  if (errors.length > 0) {
    const err = new Error("Invalid asset rules configuration");
    err.status = 400;
    err.details = errors;
    throw err;
  }
  await writeConfig(newConfig);
  cache = newConfig;
  return cache;
}

export function getOvrTriggerTypes() {
  return requireCache().ovrTriggerTypes;
}

export function getAllSponsorLogo() {
  return requireCache().allSponsorLogo;
}

export function findOvrTriggerType(id) {
  return getOvrTriggerTypes().find((t) => t.id === id) ?? null;
}

export function getRawConfig() {
  return requireCache();
}
