import { config } from "../config/env.js";

// Security Checklist E5: never leak stack traces, storage account names, or internal
// paths back to the client - log details server-side, return a generic message.
export function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(err.status ?? 500).json({
    error: config.nodeEnv === "production" ? "Internal server error" : err.message,
  });
}
