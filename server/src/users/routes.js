import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { query } from "../db/pool.js";
import { requireSession } from "../auth/session.js";
import { requireRole } from "../auth/requireRole.js";
import { searchDirectoryUsers } from "./graphClient.js";

// User Management (Step 5 follow-up, 2026-09-18, per the user's explicit request):
// Administrator/NormalUser accounts are Azure AD-authenticated but no longer
// self-provisioning (see auth/routes.js's /aad/session) - someone has to add them here
// first. Permission matrix, exactly as specified: SuperAdmin can add/edit/remove
// Administrator or NormalUser accounts; Administrator can only add/edit/remove NormalUser
// accounts. Neither role can touch the seeded local SuperAdmin account through this
// router - that stays a single, deliberately-manual BRD Section 2.1 account.
export const usersRouter = Router();

usersRouter.use(requireSession, requireRole("SuperAdmin", "Administrator"));

// Security Checklist E5 (Step 5): even though every route below is already gated behind
// requireRole (an attacker needs valid Admin/SuperAdmin credentials first), a compromised
// or malicious admin session shouldn't be able to loop-provision/deprovision accounts
// unbounded - same rate-limiter shape as events/routes.js's eventEditLimiter, keyed by
// username rather than IP for the same reason (abuse here is about one account, not one
// network address).
const userMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.username ?? req.ip,
  message: { error: "Too many user management changes recently. Please try again later." },
});

function assertRoleAllowed(actingRole, targetRole, res) {
  if (!["Administrator", "NormalUser"].includes(targetRole)) {
    res.status(400).json({ error: 'Role must be "Administrator" or "NormalUser"' });
    return false;
  }
  if (actingRole === "Administrator" && targetRole !== "NormalUser") {
    res.status(403).json({ error: "Administrators can only add or edit Normal User accounts" });
    return false;
  }
  return true;
}

usersRouter.get("/", async (req, res) => {
  const rows = await query(
    `SELECT id, username, role, auth_provider, display_name, added_by, last_login_at, created_at
     FROM users ORDER BY created_at DESC`
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      authProvider: r.auth_provider,
      displayName: r.display_name,
      addedBy: r.added_by,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
    }))
  );
});

usersRouter.get("/directory-search", async (req, res) => {
  const q = (req.query.q ?? "").toString().trim();
  if (q.length < 2) {
    return res.status(400).json({ error: "Search query must be at least 2 characters" });
  }
  try {
    const candidates = await searchDirectoryUsers(q);
    const existing = await query("SELECT username FROM users WHERE auth_provider = 'azuread'");
    const existingUsernames = new Set(existing.map((r) => r.username.toLowerCase()));
    res.json(candidates.filter((c) => !existingUsernames.has(c.email.toLowerCase())));
  } catch (err) {
    console.error("Directory search failed:", err);
    err.status = 502;
    err.message = "Directory search is temporarily unavailable. Please try again.";
    throw err;
  }
});

usersRouter.post(
  "/",
  userMutationLimiter,
  // Deliberately not domain-restricted (see graphClient.js's comment) - real WTT
  // collaborators are frequently Azure AD B2B guest accounts with an external email.
  // The actual security boundary is Azure AD sign-in itself (auth/routes.js's
  // /aad/session): adding a row here only makes someone *eligible*, it never bypasses
  // needing them to actually authenticate as that Azure AD identity.
  body("username").isString().trim().notEmpty().isEmail().withMessage("Must be a valid email address"),
  body("role").isString().trim().notEmpty(),
  body("displayName").optional().isString().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }

    const username = req.body.username.trim();
    const role = req.body.role.trim();
    const displayName = req.body.displayName?.trim() || null;

    if (!assertRoleAllowed(req.user.role, role, res)) return;

    const existing = await query("SELECT id FROM users WHERE username = ?", [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `"${username}" has already been added` });
    }

    try {
      await query(
        `INSERT INTO users (username, role, auth_provider, display_name, added_by)
         VALUES (?, ?, 'azuread', ?, ?)`,
        [username, role, displayName, req.user.username]
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: `"${username}" has already been added` });
      }
      throw err;
    }

    res.status(201).json({ username, role });
  }
);

usersRouter.put(
  "/:id",
  userMutationLimiter,
  body("role").isString().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Invalid input", details: errors.array() });
    }

    const role = req.body.role.trim();
    if (!assertRoleAllowed(req.user.role, role, res)) return;

    const rows = await query("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const target = rows[0];

    if (target.auth_provider !== "azuread") {
      return res.status(403).json({ error: "The local Super Admin account cannot be edited here" });
    }
    if (target.username === req.user.username) {
      return res.status(400).json({ error: "You cannot change your own role" });
    }
    // An Administrator can only ever have touched NormalUser rows to begin with (POST
    // above enforces this at creation time), but re-checked here too in case an
    // Administrator-created row was later promoted by a SuperAdmin.
    if (req.user.role === "Administrator" && target.role !== "NormalUser") {
      return res.status(403).json({ error: "Administrators can only edit Normal User accounts" });
    }

    await query("UPDATE users SET role = ? WHERE id = ?", [role, target.id]);
    res.json({ id: target.id, username: target.username, role });
  }
);

usersRouter.delete("/:id", userMutationLimiter, async (req, res) => {
  const rows = await query("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "User not found" });
  const target = rows[0];

  if (target.auth_provider !== "azuread") {
    return res.status(403).json({ error: "The local Super Admin account cannot be removed here" });
  }
  if (target.username === req.user.username) {
    return res.status(400).json({ error: "You cannot remove your own account" });
  }
  if (req.user.role === "Administrator" && target.role !== "NormalUser") {
    return res.status(403).json({ error: "Administrators can only remove Normal User accounts" });
  }

  await query("DELETE FROM users WHERE id = ?", [target.id]);
  res.json({ ok: true });
});
