import { getContainerClient } from "../storage/blobClient.js";
import { buildEventFolderName } from "../storage/eventFolders.js";
import { query } from "../db/pool.js";

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

// Inverse of escapeCsvField() - Step 9 (Web BRD Section 30) needs to read this file back
// as structured rows, not just append to it. Handles quoted fields with embedded commas/
// escaped quotes; every other field here (sno, changetimestamp, status) is never quoted
// by escapeCsvField() in practice, but a general parser is no more code than a naive
// split(",") and doesn't silently corrupt a filename that happens to contain a comma.
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
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
  const timestamp = new Date().toISOString();

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const { rows, etag } = await readExistingWithEtag(blob);
    const nextSno = rows.length + 1;
    const newRow = [nextSno, escapeCsvField(filename), timestamp, status, escapeCsvField(username)].join(",");
    const csv = [HEADER, ...rows, newRow].join("\n") + "\n";

    try {
      await blob.upload(Buffer.from(csv, "utf8"), Buffer.byteLength(csv), {
        blobHTTPHeaders: { blobContentType: "text/csv" },
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      });
      // Step 9 (Web BRD Section 29, redesigned 2026-09-19 per user feedback - see
      // workflow.md): every successful change-log write marks the event as having an
      // unsent Change Log Email, in the one place every call site already funnels
      // through, rather than touching each of this app's dozen-plus
      // appendChangeLogEntry() call sites individually. The email itself is no longer
      // sent automatically here - see events/routes.js's POST .../send-change-log-email,
      // triggered manually by the user's own "Send Mail" action.
      await query("UPDATE events SET email_pending = TRUE WHERE event_id = ?", [eventId]);
      return;
    } catch (err) {
      const isConcurrencyConflict = err.statusCode === 412;
      if (isConcurrencyConflict && attempt < MAX_WRITE_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * Step 9 (Web BRD Section 30): reads back the event's full change log as structured
 * rows, for the Event Log Tab. Read-only view of the exact same data
 * appendChangeLogEntry() writes - "it does not introduce a separate storage location or
 * data source" (Section 30's own text).
 */
export async function readChangeLogEntries({ year, eventId, eventName }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const blob = containerClient.getBlockBlobClient(`${eventFolder}/${CHANGELOG_FILENAME}`);
  const { rows } = await readExistingWithEtag(blob);
  return rows.map((row) => {
    const [sno, filename, changetimestamp, status, username] = parseCsvLine(row);
    return { sno: Number(sno), filename, changetimestamp, status, username };
  });
}
