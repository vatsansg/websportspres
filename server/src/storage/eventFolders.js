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

export function buildEventFolderName(eventId, eventName) {
  return `${eventId} - ${eventName}`;
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

  const [keepaliveBuf, changelogBuf, sponsorSeqBuf] = await Promise.all([
    downloadTemplateBuffer(KEEPALIVE_TEMPLATE_NAME),
    downloadTemplateBuffer(CHANGELOG_TEMPLATE_NAME),
    downloadTemplateBuffer(SPONSOR_SEQUENCE_TEMPLATE_NAME),
  ]);

  // Event-level defaults: keepalive.txt + the change log (Section 7 - event level only).
  await uploadBuffer(containerClient, `${eventFolder}/keepalive.txt`, keepaliveBuf, "text/plain");
  await uploadBuffer(
    containerClient,
    `${eventFolder}/${CHANGELOG_TEMPLATE_NAME}`,
    changelogBuf,
    "text/csv"
  );

  // rpi folder - once per event, not per table (Section 6 Step 4).
  await uploadBuffer(containerClient, `${eventFolder}/rpi/keepalive.txt`, keepaliveBuf, "text/plain");

  for (const table of tables) {
    const tableFolder = `${eventFolder}/Table ${table.tableNumber}`;
    await uploadBuffer(containerClient, `${tableFolder}/keepalive.txt`, keepaliveBuf, "text/plain");

    if (table.innerLed) {
      const innerFolder = `${tableFolder}/${LED_FOLDER_NAMES.inner}`;
      await uploadBuffer(containerClient, `${innerFolder}/keepalive.txt`, keepaliveBuf, "text/plain");
      // Section 7.1: sponsorsequence.csv placeholder per table per Inner/Outer folder -
      // supersedes the older single-file-per-event design (see the pre-existing sample
      // event, which predates this BRD revision and is not a pattern to replicate here).
      await uploadBuffer(
        containerClient,
        `${innerFolder}/${SPONSOR_SEQUENCE_TEMPLATE_NAME}`,
        sponsorSeqBuf,
        "text/csv"
      );
    }
    if (table.outerLed) {
      const outerFolder = `${tableFolder}/${LED_FOLDER_NAMES.outer}`;
      await uploadBuffer(containerClient, `${outerFolder}/keepalive.txt`, keepaliveBuf, "text/plain");
      await uploadBuffer(
        containerClient,
        `${outerFolder}/${SPONSOR_SEQUENCE_TEMPLATE_NAME}`,
        sponsorSeqBuf,
        "text/csv"
      );
    }
    if (table.mainLed) {
      const mainFolder = `${tableFolder}/${LED_FOLDER_NAMES.main}`;
      // No sponsorsequence.csv for MainLED (Section 7.1 - Sponsor Ads never apply to Main LED).
      await uploadBuffer(containerClient, `${mainFolder}/keepalive.txt`, keepaliveBuf, "text/plain");
    }
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
