import { EmailClient } from "@azure/communication-email";
import { config } from "../config/env.js";

// Web BRD Section 29's own architecture note: Azure App Service doesn't reliably support
// direct SMTP, so a transactional email API is required instead - Azure Communication
// Services Email, per the user's kickoff decision (workflow.md Step 1). The connection
// string is an App Service application setting (ACS_EMAIL_CONNECTION_STRING), same
// "no Key Vault needed" posture the BRD's own note explicitly allows for this
// requirement. Lazily constructed (not at module load) so a missing setting degrades
// gracefully instead of crashing the whole process at startup, same pattern as
// seedSuperAdmin()/loadTemplatesConfig() in index.js.
let client = null;
function getClient() {
  if (!config.email.connectionString) {
    throw new Error("ACS_EMAIL_CONNECTION_STRING is not configured");
  }
  if (!client) {
    client = new EmailClient(config.email.connectionString);
  }
  return client;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// User-requested (2026-09-19, see workflow.md): every timestamp shown to a person - here
// and in the Event Log Tab - is in Singapore time (WTT's own timezone), formatted
// dd/mm/yyyy hh:mm, not the raw UTC ISO string the change log stores.
function formatSgt(isoString) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(isoString));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} SGT`;
}

// The change log's own `filename` field folds path context into one string (e.g.
// "Table 1/Inner/foo.png", per Web BRD Section 24's own text) - the email needs File
// name and Folder name as two separate columns (Section 29's literal field list), so
// this splits on the last "/". A file with no folder context (shouldn't normally happen
// for anything this app writes, but defensive) falls back to an empty folder name.
function splitFolderAndFilename(fusedFilename) {
  const lastSlash = fusedFilename.lastIndexOf("/");
  if (lastSlash === -1) return { folder: "", filename: fusedFilename };
  return { folder: fusedFilename.slice(0, lastSlash), filename: fusedFilename.slice(lastSlash + 1) };
}

function buildEmailContent({ eventId, eventName, entries }) {
  const subject = `WTT Asset Management - Change Log Update: ${eventId} - ${eventName}`;

  const rowsHtml = entries
    .map((e) => {
      const { folder, filename } = splitFolderAndFilename(e.filename);
      return `<tr>
        <td style="padding:6px 10px;border:1px solid #ccc;">${escapeHtml(filename)}</td>
        <td style="padding:6px 10px;border:1px solid #ccc;">${escapeHtml(folder)}</td>
        <td style="padding:6px 10px;border:1px solid #ccc;">${escapeHtml(formatSgt(e.changetimestamp))}</td>
        <td style="padding:6px 10px;border:1px solid #ccc;">${escapeHtml(e.status)}</td>
      </tr>`;
    })
    .join("");

  const html = `<div style="font-family:Arial,sans-serif;">
    <p>The following asset change(s) were made to event <strong>${escapeHtml(eventId)} - ${escapeHtml(
    eventName
  )}</strong>:</p>
    <table style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">File name</th>
          <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">Folder name</th>
          <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">Date/time</th>
          <th style="padding:6px 10px;border:1px solid #ccc;text-align:left;">Status</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;

  const plainText = [
    `Asset change(s) for event ${eventId} - ${eventName}:`,
    "",
    ...entries.map((e) => {
      const { folder, filename } = splitFolderAndFilename(e.filename);
      return `- ${filename} (${folder}) - ${e.status} - ${formatSgt(e.changetimestamp)}`;
    }),
  ].join("\n");

  return { subject, html, plainText };
}

/**
 * Web BRD Section 29, redesigned 2026-09-19 per user feedback (see workflow.md): sends
 * one batched email covering every change-log entry accumulated for one event since that
 * event's last Send Mail - triggered manually by the user (POST
 * .../send-change-log-email), not automatically per save. Awaited by its caller (unlike
 * the original fire-and-forget design) so a failure can be surfaced back to the user and
 * the event's pending state left untouched until a retry succeeds.
 */
export async function sendChangeLogEmail({ eventId, eventName, entries }) {
  if (entries.length === 0) return;
  if (!config.email.recipients.length) {
    throw new Error("Change Log Email Notification skipped: no recipients configured (CHANGE_LOG_EMAIL_RECIPIENT).");
  }

  const { subject, html, plainText } = buildEmailContent({ eventId, eventName, entries });
  const emailClient = getClient();
  const poller = await emailClient.beginSend({
    senderAddress: config.email.senderAddress,
    content: { subject, html, plainText },
    recipients: { to: config.email.recipients.map((address) => ({ address })) },
  });
  await poller.pollUntilDone();
}
