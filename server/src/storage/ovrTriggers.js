import { getContainerClient } from "./blobClient.js";
import { LED_FOLDER_NAMES, buildEventFolderName } from "./eventFolders.js";

// Web BRD Section 21: RPI Home Look lives in the event's single rpi folder, not inside
// any per-table folder - unlike inner/outer/main, "rpi" has no table dimension at all.
function destinationFolderName(destination) {
  if (destination === "rpi") return "rpi";
  if (!(destination in LED_FOLDER_NAMES)) {
    throw new Error(`Invalid OVR trigger destination: ${destination}`);
  }
  return LED_FOLDER_NAMES[destination];
}

function destinationFolderPath(eventFolder, tableNumber, destination) {
  if (destination === "rpi") return `${eventFolder}/rpi`;
  return `${eventFolder}/Table ${tableNumber}/${destinationFolderName(destination)}`;
}

function resolveContext({ year, eventId, eventName, tableNumber, destination }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const folderPath = destinationFolderPath(eventFolder, tableNumber, destination);
  return { containerClient, folderPath };
}

/**
 * Generic blob CRUD for a single (table, destination) folder - trigger-type-specific
 * orchestration (validation, renaming, additional copies, fallback resolution, All
 * Sponsor Logo's dual-folder save) lives in ovrTriggers/routes.js, not here.
 */
export function ovrTriggerBlobClient(ctx, filename) {
  const { containerClient, folderPath } = resolveContext(ctx);
  return containerClient.getBlockBlobClient(`${folderPath}/${filename}`);
}

export async function ovrTriggerFileExists(ctx, filename) {
  const blob = ovrTriggerBlobClient(ctx, filename);
  const exists = await blob.exists();
  if (!exists) return { exists: false, sizeBytes: 0, metadata: {} };
  const props = await blob.getProperties();
  return { exists: true, sizeBytes: props.contentLength ?? 0, metadata: props.metadata ?? {} };
}

export async function uploadOvrTriggerFile(ctx, filename, buffer, contentType, metadata) {
  const blob = ovrTriggerBlobClient(ctx, filename);
  // A real upload always fully overwrites the blob, including any metadata a previous
  // fallback copy left behind - omitting `metadata` here (the normal case) clears it,
  // rather than needing to explicitly unset a stale flag.
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType }, metadata });
}

export async function downloadOvrTriggerFile(ctx, filename) {
  const blob = ovrTriggerBlobClient(ctx, filename);
  return blob.downloadToBuffer();
}

export async function deleteOvrTriggerFile(ctx, filename) {
  const blob = ovrTriggerBlobClient(ctx, filename);
  await blob.deleteIfExists();
}

/** Copies one blob within the same (table, destination) folder under a new filename. */
export async function copyOvrTriggerFileWithinFolder(ctx, sourceFilename, targetFilename, metadata) {
  const sourceBlob = ovrTriggerBlobClient(ctx, sourceFilename);
  const targetBlob = ovrTriggerBlobClient(ctx, targetFilename);
  const buffer = await sourceBlob.downloadToBuffer();
  const props = await sourceBlob.getProperties();
  await targetBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: props.contentType },
    metadata,
  });
}
