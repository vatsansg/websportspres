import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config"; // local dev only - Azure supplies real values via App Service settings
import express from "express";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { seedSuperAdmin } from "./auth/seed.js";
import { loadTemplatesConfig } from "./ovrTriggers/templatesStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // A MySQL outage (e.g. the Managed Identity -> AAD MySQL user mapping not being fully
  // wired up yet) must not take the whole app down - health/config endpoints and the
  // static frontend should stay reachable for diagnosis even if the DB is unavailable.
  try {
    await seedSuperAdmin();
  } catch (err) {
    console.error("Super Admin seed failed at startup (continuing without it):", err.message);
  }

  // Same reasoning as seedSuperAdmin above - a Storage outage shouldn't block the whole
  // app from starting. OVR Trigger routes will throw a clear error on-demand if this
  // never succeeds, rather than the process refusing to boot at all.
  try {
    await loadTemplatesConfig();
  } catch (err) {
    console.error("Loading asset_management_templates.json failed at startup (continuing without it):", err.message);
  }

  const app = createApp();

  // Serves the built Angular app (npm run build:client) from the same App Service as the
  // API - keeps Step 1's App Service count at one per environment (plus the dev slot),
  // and means production has no cross-origin requests to reason about (see app.js).
  const clientDist = path.join(__dirname, "..", "..", "client", "dist", "client", "browser");
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(config.port, () => {
    console.log(`WTT Asset Management server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
