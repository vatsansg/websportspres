import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./auth/routes.js";
import { healthRouter } from "./routes/health.js";
import { configRouter } from "./routes/config.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());
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

  app.use(errorHandler);
  return app;
}
