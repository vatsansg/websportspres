import { parsePngHeader } from "./pngMetadata.js";
import { parseMp4Metadata } from "./mp4Metadata.js";
import { IMAGE_SPEC } from "./sponsorAdValidation.js";
import { config } from "../config/env.js";

/**
 * Web BRD Section 17: the filename must match the predefined filename for the
 * corresponding OVR trigger section, or the user must not be allowed to save the asset.
 * Case-insensitive on both rules - the file is always renamed to a fixed canonical
 * `storageFilename` on save regardless (see templateConfig.js), so this check only gates
 * what the user is allowed to upload, not the name actually persisted.
 */
export function validateOvrTriggerFilename(filename, fileConfig) {
  if (fileConfig.filenameRule === "any") return null;
  const lower = filename.toLowerCase();
  if (fileConfig.filenameRule === "exact") {
    if (lower !== fileConfig.requiredFilename.toLowerCase()) {
      return `Filename must be exactly "${fileConfig.requiredFilename}" (got "${filename}")`;
    }
    return null;
  }
  if (fileConfig.filenameRule === "contains") {
    if (!lower.includes(fileConfig.requiredFilename.toLowerCase())) {
      return `Filename must contain "${fileConfig.requiredFilename}"`;
    }
    return null;
  }
  return null;
}

/**
 * @param {Buffer} buffer
 * @param {"image"|"video"} kind
 * @param {{ width: number, height: number }} expectedResolution
 * @returns {string | null}
 */
export function validateOvrTriggerMedia(buffer, kind, expectedResolution) {
  if (kind === "image") {
    const header = parsePngHeader(buffer);
    if (!header) return "Not a valid PNG file";
    if (header.width !== expectedResolution.width || header.height !== expectedResolution.height) {
      return `Image must be ${expectedResolution.width}x${expectedResolution.height} (got ${header.width}x${header.height})`;
    }
    if (header.bitsPerPixel !== IMAGE_SPEC.bitsPerPixel) {
      return `Image must be 32-bit (got ${header.bitsPerPixel}-bit)`;
    }
    if (buffer.length > IMAGE_SPEC.maxBytes) {
      return `Image exceeds the maximum file size of ${IMAGE_SPEC.maxBytes / (1024 * 1024)}MB`;
    }
    return null;
  }

  // video
  const maxBytes = config.maxVideoUploadMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return `Video exceeds the maximum file size of ${config.maxVideoUploadMb}MB`;
  }
  const meta = parseMp4Metadata(buffer);
  if (!meta) return "Not a valid MP4 file";
  if (meta.width !== expectedResolution.width || meta.height !== expectedResolution.height) {
    return `Video must be ${expectedResolution.width}x${expectedResolution.height} (got ${meta.width}x${meta.height})`;
  }
  return null;
}
