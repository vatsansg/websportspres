import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { query } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { requireRole } from "../auth/requireRole.js";

// User-requested (2026-09-19, see workflow.md): a single global "Force Email Send"
// setting, singleton row (id = 1 always - see db/migrations/010_system_settings.sql).
export const settingsRouter = Router();

const settingsUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many settings changes recently. Please try again later." },
});

// Readable by every signed-in role, not just SuperAdmin/Administrator - the Asset Upload
// page (every role) needs to know whether Send Mail is currently forced, to decide
// whether to warn on navigating away with unsent changes.
settingsRouter.get("/", requireSession, async (req, res) => {
  const rows = await query("SELECT force_email_send FROM system_settings WHERE id = 1");
  res.json({ forceEmailSend: rows.length > 0 ? !!rows[0].force_email_send : true });
});

settingsRouter.put(
  "/",
  requireSession,
  requireRole("SuperAdmin", "Administrator"),
  settingsUpdateLimiter,
  body("forceEmailSend").isBoolean(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }
    await query(
      "INSERT INTO system_settings (id, force_email_send, updated_by) VALUES (1, ?, ?) " +
        "ON DUPLICATE KEY UPDATE force_email_send = VALUES(force_email_send), updated_by = VALUES(updated_by)",
      [req.body.forceEmailSend, req.user.username]
    );
    res.json({ forceEmailSend: req.body.forceEmailSend });
  }
);
