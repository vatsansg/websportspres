import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config"; // local dev only - Azure supplies real values via App Service settings
import express from "express";
import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { seedSuperAdmin } from "./auth/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await seedSuperAdmin();

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
