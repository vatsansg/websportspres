import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { query } from "../db/pool.js";
import { issueSessionCookie, clearSessionCookie, requireSession } from "./session.js";
import { verifyAzureAdToken } from "./azureAdAuth.js";
import { logAuthFailure } from "../logging/auditLog.js";

export const authRouter = Router();

// Flagged by independent review: the only credential-guessable endpoints (local login,
// change-password) had no brute-force protection, and the Super Admin default account
// name/password are documented in the BRD. Per-IP, generous enough for normal retries,
// tight enough to make guessing impractical.
//
// Azure App Service's X-Forwarded-For includes the client's ephemeral source port
// (e.g. "1.2.3.4:5678"), which is different on every single TCP connection/request.
// express-rate-limit's default key generator uses req.ip as-is, so without stripping
// the port every request was silently treated as a brand-new client and the limiter
// never actually engaged - caught by testing (RateLimit-Remaining stayed at 9 forever
// instead of counting down). Strip a trailing :port, but leave IPv6 addresses (which
// contain multiple colons) alone.
function ipOnly(req) {
  const ip = req.ip || "";
  const lastColon = ip.lastIndexOf(":");
  if (lastColon > 0 && ip.indexOf(":") === lastColon) {
    return ip.slice(0, lastColon);
  }
  return ip;
}

const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipOnly,
  message: { error: "Too many attempts. Please try again later." },
});

// Local login - Super Admin only (Web BRD Section 2.1). Administrator/Normal User must
// use /aad/session instead; this endpoint rejects them even if a row exists for some
// other reason, so there is exactly one path per role.
authRouter.post(
  "/login",
  authAttemptLimiter,
  body("username").isString().trim().notEmpty(),
  body("password").isString().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input" });

    const { username, password } = req.body;
    const rows = await query(
      "SELECT * FROM users WHERE username = ? AND role = 'SuperAdmin' AND auth_provider = 'local'",
      [username]
    );
    if (rows.length === 0) {
      logAuthFailure("local_login_failed", { username, reason: "unknown_user" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      logAuthFailure("local_login_failed", { username, reason: "bad_password" });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
    issueSessionCookie(res, { username: user.username, role: user.role, provider: "local" });
    res.json({ username: user.username, role: user.role });
  }
);

// Super Admin change-password (Web BRD Section 2.1: "the password can subsequently be
// changed"). Administrator/Normal User have no app-level password to change - they are
// pure Azure AD, per the BRD's authoritative Section 2.1 wording (see workflow.md for the
// Implementation Sequence Step 1.4 table inconsistency this resolves).
authRouter.post(
  "/change-password",
  authAttemptLimiter,
  requireSession,
  body("currentPassword").isString().notEmpty(),
  body("newPassword").isString().isLength({ min: 8 }),
  async (req, res) => {
    if (req.user.role !== "SuperAdmin" || req.user.provider !== "local") {
      logAuthFailure("forbidden_role_access", {
        username: req.user.username,
        role: req.user.role,
        path: req.path,
      });
      return res.status(403).json({ error: "Only the local Super Admin account has a password to change" });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input" });

    const rows = await query("SELECT * FROM users WHERE username = ?", [req.user.username]);
    const user = rows[0];
    const ok = await bcrypt.compare(req.body.currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(req.body.newPassword, 12);
    await query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, user.id]);
    res.json({ ok: true });
  }
);

// Exchanges a validated Azure AD access token (obtained client-side by Angular/MSAL, PKCE,
// no client secret involved) for our own session cookie. See azureAdAuth.js for why this
// cannot be exercised end-to-end until AZURE_AD_TENANT_ID/CLIENT_ID are configured.
authRouter.post("/aad/session", async (req, res) => {
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  try {
    const claims = await verifyAzureAdToken(token);
    await query(
      `INSERT INTO users (username, role, auth_provider, azure_ad_object_id, display_name, last_login_at)
       VALUES (?, ?, 'azuread', ?, ?, NOW())
       ON DUPLICATE KEY UPDATE role = VALUES(role), display_name = VALUES(display_name), last_login_at = NOW()`,
      [claims.username, claims.role, claims.azureAdObjectId, claims.displayName]
    );
    issueSessionCookie(res, { username: claims.username, role: claims.role, provider: "azuread" });
    res.json({ username: claims.username, role: claims.role });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

authRouter.post("/logout", requireSession, (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireSession, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, provider: req.user.provider });
});
