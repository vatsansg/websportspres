import { getContainerClient } from "./blobClient.js";
import { LED_FOLDER_NAMES, buildEventFolderName } from "./eventFolders.js";

const SEQUENCE_FILENAME = "sponsorsequence.csv";
const RESERVED_NAMES = new Set([SEQUENCE_FILENAME, "keepalive.txt"]);

// Web BRD Section 11.1: Sponsor Ads apply only to Inner/Outer - Main LED is never a valid
// destination here, so this module (unlike eventFolders.js) only ever knows about these two.
function destinationFolderName(destination) {
  if (destination !== "inner" && destination !== "outer") {
    throw new Error(`Invalid Sponsor Ads destination: ${destination}`);
  }
  return LED_FOLDER_NAMES[destination];
}

function sponsorAdsFolderPath(eventFolder, tableNumber, destination) {
  return `${eventFolder}/Table ${tableNumber}/${destinationFolderName(destination)}`;
}

function stripExtension(filename) {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? filename : filename.slice(0, idx);
}

function isVideoFilename(filename) {
  return filename.toLowerCase().endsWith(".mp4");
}

// seqno,filename,duration - filename stored WITHOUT extension (Web BRD Section 13).
function parseSequenceCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const [seqno, filenameNoExt, duration] = lines[i].split(",");
    if (filenameNoExt === undefined) continue;
    rows.push({
      seqno: Number(seqno),
      filenameNoExt,
      duration: duration === undefined || duration === "" ? null : Number(duration),
    });
  }
  return rows;
}

function buildSequenceCsv(orderedFiles) {
  const header = "seqno,filename,duration";
  const lines = orderedFiles.map(
    (f, idx) => `${idx + 1},${stripExtension(f.filename)},${f.duration ?? ""}`
  );
  return [header, ...lines].join("\n") + "\n";
}

function resolveContext({ year, eventId, eventName, tableNumber, destination }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const folderPath = sponsorAdsFolderPath(eventFolder, tableNumber, destination);
  return { containerClient, folderPath };
}

/**
 * Lists a table/destination's Sponsor Ad files, merging the actual blobs present with the
 * existing sponsorsequence.csv (Web BRD Sections 13/14 - the CSV is the source of truth for
 * order and duration; a file uploaded but not yet sequenced gets a default duration and is
 * appended after the already-sequenced files).
 */
export async function listSponsorAdFiles(ctx) {
  const { containerClient, folderPath } = resolveContext(ctx);

  const filenames = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${folderPath}/` })) {
    const name = blob.name.slice(folderPath.length + 1);
    if (RESERVED_NAMES.has(name) || name.includes("/")) continue;
    filenames.push(name);
  }

  const sequenceBlob = containerClient.getBlockBlobClient(`${folderPath}/${SEQUENCE_FILENAME}`);
  let sequenceRows = [];
  if (await sequenceBlob.exists()) {
    const downloaded = await sequenceBlob.downloadToBuffer();
    sequenceRows = parseSequenceCsv(downloaded.toString("utf8"));
  }

  const byNameNoExt = new Map(sequenceRows.map((r) => [r.filenameNoExt, r]));
  const sequenced = [];
  const unsequenced = [];
  for (const filename of filenames) {
    const row = byNameNoExt.get(stripExtension(filename));
    if (row) {
      sequenced.push({ filename, duration: row.duration, seqno: row.seqno });
    } else {
      unsequenced.push({ filename, duration: isVideoFilename(filename) ? null : 1, seqno: null });
    }
  }
  sequenced.sort((a, b) => a.seqno - b.seqno);
  return [...sequenced, ...unsequenced];
}

export async function uploadSponsorAdFile(ctx, { filename, buffer, contentType }) {
  const { containerClient, folderPath } = resolveContext(ctx);
  const blob = containerClient.getBlockBlobClient(`${folderPath}/${filename}`);
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType } });
}

export async function sponsorAdFileExists(ctx, filename) {
  const { containerClient, folderPath } = resolveContext(ctx);
  const blob = containerClient.getBlockBlobClient(`${folderPath}/${filename}`);
  return blob.exists();
}

export async function downloadSponsorAdFile(ctx, filename) {
  const { containerClient, folderPath } = resolveContext(ctx);
  const blob = containerClient.getBlockBlobClient(`${folderPath}/${filename}`);
  return blob.downloadToBuffer();
}

export async function deleteSponsorAdFile(ctx, filename) {
  const { containerClient, folderPath } = resolveContext(ctx);
  await containerClient.deleteBlob(`${folderPath}/${filename}`);
}

/**
 * Regenerates sponsorsequence.csv for one table/destination (Web BRD Sections 13/14).
 * @param {Array<{filename: string, duration: number|null}>} orderedFiles
 * @returns {Promise<string>} the blob path written, for change-log attribution.
 */
export async function saveSponsorAdSequence(ctx, orderedFiles) {
  const { containerClient, folderPath } = resolveContext(ctx);
  const csv = buildSequenceCsv(orderedFiles);
  const blobPath = `${folderPath}/${SEQUENCE_FILENAME}`;
  const blob = containerClient.getBlockBlobClient(blobPath);
  await blob.upload(Buffer.from(csv, "utf8"), Buffer.byteLength(csv), {
    blobHTTPHeaders: { blobContentType: "text/csv" },
  });
  return blobPath;
}

/** Removes one file's row from sponsorsequence.csv, if present, without touching the rest. */
export async function removeFromSponsorAdSequence(ctx, filename) {
  const files = await listSponsorAdFiles(ctx);
  const sequencedCount = files.filter((f) => f.seqno !== null).length;
  const remaining = files.filter((f) => f.filename !== filename && f.seqno !== null);
  if (remaining.length === sequencedCount) return null; // wasn't sequenced
  return saveSponsorAdSequence(ctx, remaining);
}
