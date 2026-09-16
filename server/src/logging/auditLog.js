import winston from "winston";

// Security Checklist G2: failed/rejected actions must be logged for audit, without
// logging sensitive data (never the password itself, only the attempted username).
export const auditLogger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

export function logAuthFailure(event, details) {
  auditLogger.warn({ event, ...details, at: new Date().toISOString() });
}
