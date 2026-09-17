import { getContainerClient } from "../storage/blobClient.js";
import { buildEventFolderName } from "../storage/eventFolders.js";

// Matches the real templates-container blob's name (extra "s") rather than the Web BRD
// Section 24 prose's literal "_ledassetchangelog.csv" - same interoperability reasoning as
// the folder-casing decision in Step 2 (see workflow.md).
const CHANGELOG_FILENAME = "_ledassetschangelog.csv";

// Web BRD Section 24's literal 5-column spec: path context (e.g. "Table 1/Inner/foo.png")
// is folded into `filename` itself, not a separate column. Confirmed via research that no
// consumer (the Desktop app) currently reads this file, so there's no live interop reason
// to deviate to the real (but unused) 6-column template blob's layout - see workflow.md.
const HEADER = "sno,filename,changetimestamp,status,username";
const MAX_WRITE_ATTEMPTS = 5;

function parseDataRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(1); // drop header, keep raw data rows as-is (already escaped correctly)
}

function escapeCsvField(value) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function readExistingWithEtag(blob) {
  try {
    const props = await blob.getProperties();
    const buf = await blob.downloadToBuffer();
    return { rows: parseDataRows(buf.toString("utf8")), etag: props.etag };
  } catch (err) {
    if (err.statusCode === 404) return { rows: [], etag: undefined };
    throw err;
  }
}

/**
 * Appends one row to the event's change log (Web BRD Section 24). Uses ETag-conditional
 * writes with retry so two concurrent uploads (e.g. two users, or two requests racing)
 * can't silently clobber each other's entry - the whole file is rewritten on each append
 * (Block Blobs have no true append), so without this a lost-update race is possible.
 *
 * @param {{ year: number, eventId: string, eventName: string, filename: string, status: "New"|"Updated"|"Deleted", username: string }} entry
 */
export async function appendChangeLogEntry({ year, eventId, eventName, filename, status, username }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const blob = containerClient.getBlockBlobClient(`${eventFolder}/${CHANGELOG_FILENAME}`);

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { rows, etag } = await readExistingWithEtag(blob);
    const nextSno = rows.length + 1;
    const newRow = [
      nextSno,
      escapeCsvField(filename),
      new Date().toISOString(),
      status,
      escapeCsvField(username),
    ].join(",");
    const csv = [HEADER, ...rows, newRow].join("\n") + "\n";

    try {
      await blob.upload(Buffer.from(csv, "utf8"), Buffer.byteLength(csv), {
        blobHTTPHeaders: { blobContentType: "text/csv" },
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      });
      return;
    } catch (err) {
      const isConcurrencyConflict = err.statusCode === 412;
      if (isConcurrencyConflict && attempt < MAX_WRITE_ATTEMPTS) continue;
      throw err;
    }
  }
}
