import { logAuthFailure } from "../logging/auditLog.js";

// Server-side RBAC enforcement (Security Checklist A4/A5) - never rely on the UI hiding a
// button. Every route that needs restricting imports this, not just the ones with an
// obviously sensitive name.
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      logAuthFailure("forbidden_role_access", {
        username: req.user?.username ?? "anonymous",
        role: req.user?.role ?? null,
        path: req.path,
        requiredRoles: allowedRoles,
      });
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
