import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";

const DEFAULT_USERNAME = "first_time_admin";
const DEFAULT_PASSWORD = "Admin@123";
const SEED_PLACEHOLDER = "__SEEDED_BY_APPLICATION__";

// Web BRD Section 2.1: a default first-time Super Admin account must exist, with a
// changeable password. The migration inserts the row with a placeholder hash (SQL cannot
// compute bcrypt); this fills in the real hash on first boot, once, idempotently.
export async function seedSuperAdmin() {
  const rows = await query(
    "SELECT id, password_hash FROM users WHERE username = ? AND role = 'SuperAdmin'",
    [DEFAULT_USERNAME]
  );
  if (rows.length === 0) return;
  const row = rows[0];
  if (row.password_hash !== SEED_PLACEHOLDER) return;

  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  await query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, row.id]);
}
