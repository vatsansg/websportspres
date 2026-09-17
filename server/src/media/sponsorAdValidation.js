import { parsePngHeader } from "./pngMetadata.js";
import { parseMp4Metadata } from "./mp4Metadata.js";
import { config } from "../config/env.js";

// Web BRD Section 12: uploaded filenames must not contain either term, checked
// case-insensitively (consistent with the Event Name "WTT" check from Step 2).
export const FORBIDDEN_FILENAME_TERMS = ["led", "ovr"];

// Filenames are used directly as blob names within a server-computed folder prefix
// (storage/sponsorAds.js). Azure Blob Storage's flat namespace means a "/" can't actually
// escape that prefix, but it could still produce a confusingly-nested pseudo-path - same
// defense-in-depth reasoning as Step 2's eventId/eventName blob-safety check.
const BLOB_SAFE_PATTERN = /^[^/\\\x00-\x1f]+$/;

// "Sports Press - LED Display Media Specifications" doc: format/bit-depth/file-size are
// fixed, application-wide constants - only the expected WIDTH/HEIGHT is per-table/per-LED-
// type, sourced from event_tables (Web BRD Section 31), per the user's explicit decision
// to treat event_tables as the single source of truth for resolution rather than a fixed
// app-wide value. The doc's own "80 Mbps" video field is ambiguous (mixes a bitrate unit
// into a field labeled max file size) - per an earlier explicit decision, ignored in favor
// of relying solely on the BRD's own unambiguous 100MB application-wide cap (Section 27.1).
// Exported for reuse by ovrTriggerValidation.js - the same format/bit-depth/size rules
// apply to OVR Trigger images (Web BRD Section 17 validates against the same "Sports
// Press" spec doc), only the expected resolution differs by asset type/destination.
export const IMAGE_SPEC = { bitsPerPixel: 32, maxBytes: 4 * 1024 * 1024 };

export function isVideoFilename(filename) {
  return filename.toLowerCase().endsWith(".mp4");
}

// Applies to any route that takes a filename from the URL path (delete, duration
// retrieval) and turns it into a blob name - the LED/OVR content rule is an upload-time
// gate only (Web BRD Section 12's literal wording: "prevent a file from being uploaded"),
// not a general constraint on filenames that already exist.
export function isBlobSafeFilename(filename) {
  return BLOB_SAFE_PATTERN.test(filename);
}

export function validateFilename(filename) {
  if (!isBlobSafeFilename(filename)) {
    return "Filename contains invalid characters";
  }
  const lower = filename.toLowerCase();
  for (const term of FORBIDDEN_FILENAME_TERMS) {
    if (lower.includes(term)) {
      return `Filename must not contain "${term.toUpperCase()}"`;
    }
  }
  return null;
}

/**
 * @param {string} filename
 * @param {Buffer} buffer
 * @param {{ width: number, height: number }} expectedResolution - from event_tables for
 *   this specific table/LED destination (Web BRD Section 31), not a fixed app-wide value.
 * @returns {string | null} a human-readable validation error, or null if the file is valid.
 */
export function validateSponsorAdFile(filename, buffer, expectedResolution) {
  const filenameError = validateFilename(filename);
  if (filenameError) return filenameError;

  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();

  if (ext === ".png") {
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

  if (ext === ".mp4") {
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

  return "Only PNG images and MP4 videos are accepted for Sponsor Ads";
}
