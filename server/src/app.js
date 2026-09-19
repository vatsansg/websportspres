import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./auth/routes.js";
import { healthRouter } from "./routes/health.js";
import { configRouter } from "./routes/config.js";
import { eventsRouter } from "./events/routes.js";
import { sponsorAdsRouter } from "./sponsorAds/routes.js";
import { ovrTriggersRouter } from "./ovrTriggers/routes.js";
import { rpiRouter } from "./ovrTriggers/rpiRoutes.js";
import { assetRulesRouter } from "./assetRules/routes.js";
import { usersRouter } from "./users/routes.js";
import { settingsRouter } from "./settings/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  // App Service sits behind exactly one hop (Azure's front-end proxy) - without this,
  // express-rate-limit (and req.ip generally) would see the proxy's own IP for every
  // request instead of the real client. Confirmed via a temporary debug endpoint that
  // Azure's X-Forwarded-For here is always a single "ip:port" entry, never a chain, so
  // trusting exactly one hop is correct (the real bug that made the rate limiter not
  // count anything - see auth/routes.js's ipOnly() - was the :port suffix, not this).
  app.set("trust proxy", 1);

  // helmet()'s default CSP restricts connect-src to 'self', which silently blocks the
  // browser's fetch() call to Azure AD's token endpoint during Azure AD sign-in
  // (MSAL's authorization-code-for-token exchange) - manifests as a generic
  // "TypeError: Failed to fetch" with no explanation, easy to mistake for a network
  // problem. Explicitly allow only what MSAL needs, nothing broader.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "connect-src": ["'self'", "https://login.microsoftonline.com"],
        },
      },
    })
  );
  // Security Checklist C4: no wildcard origin. In production, Angular is served from the
  // same App Service as this API, so same-origin requests need no CORS header at all -
  // this only matters for local development (Angular dev server on a different port).
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:4200").split(",");
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/auth", authRouter);
  app.use("/api/health", healthRouter);
  app.use("/api/config", configRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/events/:eventId/tables/:tableNumber/sponsor-ads", sponsorAdsRouter);
  app.use("/api/events/:eventId/tables/:tableNumber/ovr-triggers", ovrTriggersRouter);
  app.use("/api/events/:eventId/ovr-triggers/rpi", rpiRouter);
  app.use("/api/asset-rules", assetRulesRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/system-settings", settingsRouter);

  app.use(errorHandler);
  return app;
}
