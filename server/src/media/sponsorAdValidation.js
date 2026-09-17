import { parsePngHeader } from "./pngMetadata.js";
import { parseMp4Metadata } from "./mp4Metadata.js";
import { config } from "../config/env.js";

// Web BRD Section 12: uploaded filenames must not contain either term, checked
// case-insensitively (consistent with the Event Name "WTT" check from Step 2).
const FORBIDDEN_FILENAME_TERMS = ["led", "ovr"];

// Filenames are used directly as blob names within a server-computed folder prefix
// (storage/sponsorAds.js). Azure Blob Storage's flat namespace means a "/" can't actually
// escape that prefix, but it could still produce a confusingly-nested pseudo-path - same
// defense-in-depth reasoning as Step 2's eventId/eventName blob-safety check.
const BLOB_SAFE_PATTERN = /^[^/\\\x00-\x1f]+$/;

// "Sports Press - LED Display Media Specifications" doc, Surrounds LED (Inner & Outer)
// section - the only spec that applies to Sponsor Ads (Web BRD Section 11.1: Main LED
// never applies). The doc's own "80 Mbps" video field is ambiguous (mixes a bitrate unit
// into a field labeled max file size) - per the user's explicit decision, ignored in favor
// of relying solely on the BRD's own unambiguous 100MB application-wide cap (Section 27.1).
const IMAGE_SPEC = { width: 1920, height: 1080, bitsPerPixel: 32, maxBytes: 4 * 1024 * 1024 };
const VIDEO_SPEC = { width: 1920, height: 1080 };

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
 * @returns {string | null} a human-readable validation error, or null if the file is valid.
 */
export function validateSponsorAdFile(filename, buffer) {
  const filenameError = validateFilename(filename);
  if (filenameError) return filenameError;

  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();

  if (ext === ".png") {
    const header = parsePngHeader(buffer);
    if (!header) return "Not a valid PNG file";
    if (header.width !== IMAGE_SPEC.width || header.height !== IMAGE_SPEC.height) {
      return `Image must be ${IMAGE_SPEC.width}x${IMAGE_SPEC.height} (got ${header.width}x${header.height})`;
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
    if (meta.width !== VIDEO_SPEC.width || meta.height !== VIDEO_SPEC.height) {
      return `Video must be ${VIDEO_SPEC.width}x${VIDEO_SPEC.height} (got ${meta.width}x${meta.height})`;
    }
    return null;
  }

  return "Only PNG images and MP4 videos are accepted for Sponsor Ads";
}
