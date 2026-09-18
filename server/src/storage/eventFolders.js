import { getContainerClient, getTemplatesContainerClient } from "./blobClient.js";

// Real-world convention confirmed against the existing "1111 - Champions Montpellier"
// sample event in the live storage account (per the user's own kickoff instruction to
// treat it as ground truth) - lowercase, not the BRD prose's "Inner"/"Outer"/"MainLED".
export const LED_FOLDER_NAMES = { inner: "inner", outer: "outer", main: "mainled" };

// Matches the templates container's actual filename exactly (it has an extra "s" that
// the BRD's prose doesn't - "_ledassetchangelog.csv" - but the existing sample event and
// the templates blob itself both use this spelling, and the downstream Desktop app almost
// certainly expects whatever that already-working pipeline produces). Do not "fix" this.
const CHANGELOG_TEMPLATE_NAME = "_ledassetschangelog.csv";
const KEEPALIVE_TEMPLATE_NAME = "keepalive.txt";
const SPONSOR_SEQUENCE_TEMPLATE_NAME = "sponsorsequence.csv";

// Web BRD Section 8: "if files already exist in the affected storage folders, other than
// the default keepalive.txt, the user must receive a confirmation prompt." These are the
// names of scaffolding this app itself creates automatically (Step 2/4) - not something a
// user uploaded - so none of them should count as "existing files" worth warning about.
// default.png/default.mp4 are excluded only while still the 0-byte placeholder; a real
// upload there does count.
const SCAFFOLD_FILENAMES = new Set([KEEPALIVE_TEMPLATE_NAME, SPONSOR_SEQUENCE_TEMPLATE_NAME]);

async function downloadTemplateBuffer(templateName) {
  const container = getTemplatesContainerClient();
  const blob = container.getBlockBlobClient(templateName);
  const download = await blob.downloadToBuffer();
  return download;
}

async function uploadBuffer(containerClient, path, buffer, contentType) {
  const blob = containerClient.getBlockBlobClient(path);
  await blob.upload(buffer, buffer.length, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });
}

const EMPTY_BUFFER = Buffer.alloc(0);

// Step 4 (Web BRD Section 18.1's Winning Moment fallback): per the user's explicit
// decision, default.png/default.mp4 are real per-table/per-destination assets an admin
// uploads later (via the Default Assets feature, since a single global template can't
// suit every event/venue's differing resolutions) - not a static file copied from the
// templates container. Created empty here, same pattern as keepalive.txt, purely so the
// slot visibly exists from table creation onward; ovrTriggers routes treat a 0-byte
// default as "not actually set" so an empty placeholder can never be used as a real
// fallback source.
async function createDefaultAssetPlaceholders(containerClient, folderPath) {
  await uploadBuffer(containerClient, `${folderPath}/default.png`, EMPTY_BUFFER, "image/png");
  await uploadBuffer(containerClient, `${folderPath}/default.mp4`, EMPTY_BUFFER, "video/mp4");
}

export function buildEventFolderName(eventId, eventName) {
  return `${eventId} - ${eventName}`;
}

/**
 * Creates one destination's folder (Inner/Outer/Main) under a table folder: keepalive.txt,
 * sponsorsequence.csv (Inner/Outer only - Section 7.1, Main LED never has Sponsor Ads), and
 * the Default Assets placeholders. Shared by full-event creation (Step 2), single-table
 * addition, and enabling a previously-disabled destination on an existing table (Step 5).
 */
async function createDestinationFolder(containerClient, tableFolder, destination, buffers) {
  const folder = `${tableFolder}/${LED_FOLDER_NAMES[destination]}`;
  await uploadBuffer(containerClient, `${folder}/keepalive.txt`, buffers.keepaliveBuf, "text/plain");
  if (destination !== "main") {
    await uploadBuffer(
      containerClient,
      `${folder}/${SPONSOR_SEQUENCE_TEMPLATE_NAME}`,
      buffers.sponsorSeqBuf,
      "text/csv"
    );
  }
  await createDefaultAssetPlaceholders(containerClient, folder);
}

/** Creates a full table folder (keepalive.txt + whichever destinations are enabled). */
async function createTableFolderStructure(containerClient, eventFolder, table, buffers) {
  const tableFolder = `${eventFolder}/Table ${table.tableNumber}`;
  await uploadBuffer(containerClient, `${tableFolder}/keepalive.txt`, buffers.keepaliveBuf, "text/plain");
  if (table.innerLed) await createDestinationFolder(containerClient, tableFolder, "inner", buffers);
  if (table.outerLed) await createDestinationFolder(containerClient, tableFolder, "outer", buffers);
  if (table.mainLed) await createDestinationFolder(containerClient, tableFolder, "main", buffers);
}

async function loadTemplateBuffers() {
  const [keepaliveBuf, sponsorSeqBuf] = await Promise.all([
    downloadTemplateBuffer(KEEPALIVE_TEMPLATE_NAME),
    downloadTemplateBuffer(SPONSOR_SEQUENCE_TEMPLATE_NAME),
  ]);
  return { keepaliveBuf, sponsorSeqBuf };
}

/**
 * Creates the full Azure Storage folder structure for a newly-created event (Web BRD
 * Sections 4, 6, 7, 7.1). Idempotent-ish per call (uploads overwrite), but only ever
 * called once, right after the event's DB rows are inserted - if this throws, the
 * caller is expected to roll back those DB rows so the event doesn't exist in a
 * half-created state.
 *
 * @param {{ year: number, eventId: string, eventName: string, tables: Array<{tableNumber: number, innerLed: boolean, outerLed: boolean, mainLed: boolean}> }} event
 */
export async function createEventStorageStructure({ year, eventId, eventName, tables }) {
  const containerClient = getContainerClient(String(year));
  await containerClient.createIfNotExists();

  const eventFolder = buildEventFolderName(eventId, eventName);
  const buffers = await loadTemplateBuffers();
  const changelogBuf = await downloadTemplateBuffer(CHANGELOG_TEMPLATE_NAME);

  // Event-level defaults: keepalive.txt + the change log (Section 7 - event level only).
  await uploadBuffer(containerClient, `${eventFolder}/keepalive.txt`, buffers.keepaliveBuf, "text/plain");
  await uploadBuffer(
    containerClient,
    `${eventFolder}/${CHANGELOG_TEMPLATE_NAME}`,
    changelogBuf,
    "text/csv"
  );

  // rpi folder - once per event, not per table (Section 6 Step 4).
  await uploadBuffer(containerClient, `${eventFolder}/rpi/keepalive.txt`, buffers.keepaliveBuf, "text/plain");

  for (const table of tables) {
    await createTableFolderStructure(containerClient, eventFolder, table, buffers);
  }

  return { eventStorageUrl: `${containerClient.url}/${encodeURIComponent(eventFolder)}` };
}

/** Deletes the full event folder tree - used both for real deletes (Step 5) and to roll
 * back a failed event creation (Step 2) so a DB failure doesn't leave orphaned blobs, or
 * a storage failure doesn't leave a DB-only "ghost" event. */
export async function deleteEventStorageStructure({ year, eventId, eventName }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${eventFolder}/` })) {
    await containerClient.deleteBlob(blob.name);
  }
}

/**
 * Step 5 (Web BRD Section 5): adds one new table to an existing event's storage
 * structure. Assumes the caller has already validated the table's LED configuration and
 * inserted its DB row.
 */
export async function createTableStorage({ year, eventId, eventName, table }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const buffers = await loadTemplateBuffers();
  await createTableFolderStructure(containerClient, eventFolder, table, buffers);
}

/** Step 5 (Web BRD Section 9): deletes one table's complete folder subtree. */
export async function deleteTableStorage({ year, eventId, eventName, tableNumber }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const tableFolder = `${eventFolder}/Table ${tableNumber}`;
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${tableFolder}/` })) {
    await containerClient.deleteBlob(blob.name);
  }
}

/** Step 5 (Web BRD Section 8): enables a previously-disabled LED destination on an
 * existing table - creates that destination's folder exactly as if the table had been
 * created with it enabled from the start. */
export async function enableTableDestination({ year, eventId, eventName, tableNumber, destination }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const tableFolder = `${eventFolder}/Table ${tableNumber}`;
  const buffers = await loadTemplateBuffers();
  await createDestinationFolder(containerClient, tableFolder, destination, buffers);
}

/** Step 5 (Web BRD Section 8): disables a previously-enabled LED destination on an
 * existing table - deletes that destination's complete folder subtree. Caller is
 * responsible for the confirmation-prompt gate (see hasRealContent below) before calling
 * this - it does not check again. */
export async function disableTableDestination({ year, eventId, eventName, tableNumber, destination }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const folder = `${eventFolder}/Table ${tableNumber}/${LED_FOLDER_NAMES[destination]}`;
  for await (const blob of containerClient.listBlobsFlat({ prefix: `${folder}/` })) {
    await containerClient.deleteBlob(blob.name);
  }
}

/**
 * Step 5 (Web BRD Section 8): lists any real (non-scaffolding) files under a folder
 * prefix, used to decide whether a destructive change needs a confirmation prompt.
 * Excludes keepalive.txt/sponsorsequence.csv unconditionally, and default.png/default.mp4
 * only while they're still the untouched 0-byte placeholder. Matches scaffolding names by
 * basename (last path segment), not the full relative path, so this works whether
 * `folderPath` is one leaf destination folder (e.g. "Table 3/inner") or omitted entirely
 * for a whole-event recursive check (the rename-warning case, Section 8's ID/Name change).
 * The event's own change-log CSV is also excluded from a whole-event check - renaming
 * moves it along with everything else, it's never at risk of being lost.
 */
export async function listRealFiles({ year, eventId, eventName, folderPath }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const prefix = folderPath ? `${eventFolder}/${folderPath}/` : `${eventFolder}/`;
  const realFiles = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    const relativePath = blob.name.slice(prefix.length);
    const filename = relativePath.split("/").pop();
    // _GUID.json (Step 7, Section 25.6) is app-generated metadata, same treatment as
    // the change log - it moves with everything else on a rename and was never
    // something a user manually uploaded, so it shouldn't count toward "you'll lose
    // files" warnings either.
    if (SCAFFOLD_FILENAMES.has(filename) || filename === CHANGELOG_TEMPLATE_NAME || filename === "_GUID.json") continue;
    if ((filename === "default.png" || filename === "default.mp4") && (blob.properties.contentLength ?? 0) === 0) {
      continue;
    }
    realFiles.push(relativePath);
  }
  return realFiles;
}

/**
 * Step 5 (Web BRD Section 8): renames an event's storage folder when Event ID, Event
 * Name, and/or Year changes. Year is also editable (Section 8's own list), and each
 * year is a separate blob container (see getContainerClient) - so a year change is a
 * cross-container move, not just a prefix rename within one container. Azure Blob
 * Storage has no atomic rename or cross-container copy primitive here (both containers
 * may be on the same account, but the SDK still requires a full read/write per blob) -
 * every blob under the old prefix is downloaded and re-uploaded under the new prefix in
 * the target container, then the old blob is deleted, one at a time, only deleting the
 * old copy after its new copy has landed successfully (so a mid-operation failure never
 * loses data, only leaves some blobs duplicated under both locations for the caller to
 * notice and retry).
 */
export async function renameEventStorage({
  oldYear,
  newYear,
  oldEventId,
  oldEventName,
  newEventId,
  newEventName,
}) {
  const sourceContainer = getContainerClient(String(oldYear));
  const targetContainer = getContainerClient(String(newYear));
  const oldFolder = buildEventFolderName(oldEventId, oldEventName);
  const newFolder = buildEventFolderName(newEventId, newEventName);
  if (oldYear === newYear && oldFolder === newFolder) return;

  await targetContainer.createIfNotExists();

  for await (const blob of sourceContainer.listBlobsFlat({ prefix: `${oldFolder}/` })) {
    const relativePath = blob.name.slice(oldFolder.length);
    const sourceBlob = sourceContainer.getBlockBlobClient(blob.name);
    const targetBlob = targetContainer.getBlockBlobClient(`${newFolder}${relativePath}`);
    const buffer = await sourceBlob.downloadToBuffer();
    const props = await sourceBlob.getProperties();
    await targetBlob.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: props.contentType },
      metadata: props.metadata,
    });
    await sourceContainer.deleteBlob(blob.name);
  }

  return { eventStorageUrl: `${targetContainer.url}/${encodeURIComponent(newFolder)}` };
}

/**
 * Step 7 (Web BRD Section 25.6): writes/overwrites `_GUID.json` in the event's own
 * storage folder root - the same JSON content as the local download the user gets
 * (Section 25.3's "local download and the _GUID.json copy... must always contain
 * identical content"). This is the file the downstream Desktop app reads directly from
 * Azure Storage to validate the event's identity before downloading anything.
 */
export async function writeExportGuidFile({ year, eventId, eventName, content }) {
  const containerClient = getContainerClient(String(year));
  const eventFolder = buildEventFolderName(eventId, eventName);
  const buffer = Buffer.from(JSON.stringify(content, null, 2), "utf8");
  await uploadBuffer(containerClient, `${eventFolder}/_GUID.json`, buffer, "application/json");
}
