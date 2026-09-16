import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

// One session-cookie format for both auth paths: Super Admin (local password) and
// Administrator/Normal User (Azure AD). Angular never needs to know which one was used -
// it just holds an httpOnly cookie, same as any other session.
export function issueSessionCookie(res, { username, role, provider }) {
  const token = jwt.sign({ username, role, provider }, config.auth.sessionSecret, {
    expiresIn: Math.floor(config.auth.sessionMaxAgeMs / 1000),
  });
  res.cookie(config.auth.sessionCookieName, token, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: config.auth.sessionMaxAgeMs,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.auth.sessionCookieName);
}

export function requireSession(req, res, next) {
  const token = req.cookies?.[config.auth.sessionCookieName];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, config.auth.sessionSecret);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid" });
  }
}
