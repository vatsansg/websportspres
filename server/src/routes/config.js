import { Router } from "express";
import { config } from "../config/env.js";

// Public, non-secret runtime config for the Angular SPA (tenant/client IDs are not
// secrets - MSAL's public-client flow depends on them being visible to the browser).
// Lets the same build run against dev/prod slots without a per-environment rebuild.
export const configRouter = Router();

configRouter.get("/", (req, res) => {
  res.json({
    appName: "WTT Asset Management",
    azureAd: {
      tenantId: config.auth.azureAd.tenantId,
      clientId: config.auth.azureAd.clientId,
      configured: Boolean(config.auth.azureAd.tenantId && config.auth.azureAd.clientId),
    },
  });
});
