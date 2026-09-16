import { Router } from "express";
import { query } from "../db/pool.js";
import { getTemplatesContainerClient } from "../storage/blobClient.js";

export const healthRouter = Router();

healthRouter.get("/", (req, res) => res.json({ ok: true }));

// Proves end-to-end Managed Identity connectivity to MySQL - required before Step 1 can
// be considered complete (Solution Implementation Plan Section 4).
healthRouter.get("/db", async (req, res) => {
  try {
    const rows = await query("SELECT 1 AS ok");
    res.json({ ok: rows[0].ok === 1 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Proves end-to-end Managed Identity connectivity to Storage.
healthRouter.get("/storage", async (req, res) => {
  try {
    const container = getTemplatesContainerClient();
    const exists = await container.exists();
    res.json({ ok: exists });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
