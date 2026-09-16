// Operator script: applies db/migrations/*.sql in order, tracked in schema_migrations.
// Run by hand (or from a deploy step) against a target database, authenticating as
// whichever AAD identity the caller is logged in as (az login locally, Managed Identity
// in Azure once wired into a deployment task).
import mysql from "mysql2/promise";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

const HOST = process.env.MYSQL_HOST ?? "mysql-sportspres-assetmgmt.mysql.database.azure.com";
const DATABASE = process.env.MIGRATE_DATABASE;
const AAD_LOGIN = process.env.MIGRATE_AAD_LOGIN ?? "vatsan@worldtabletennis.com";

if (!DATABASE) {
  console.error("Set MIGRATE_DATABASE=assetmgmt (or assetmgmt_dev) before running.");
  process.exit(1);
}

function getAadToken() {
  return execSync("az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv", {
    encoding: "utf8",
  }).trim();
}

async function main() {
  const conn = await mysql.createConnection({
    host: HOST,
    user: AAD_LOGIN,
    password: getAadToken(),
    database: DATABASE,
    ssl: { minVersion: "TLSv1.2" },
    // Safe here only because ssl above enforces TLS for the whole connection - the AAD
    // token is never sent outside an encrypted channel. Required by Azure MySQL Flexible
    // Server's AAD auth plugin, which authenticates via mysql_clear_password.
    enableCleartextPlugin: true,
    multipleStatements: true,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [appliedRows] = await conn.query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    console.log(`apply ${file}`);
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await conn.query(sql);
    await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
  }

  console.log(`Migrations applied against database "${DATABASE}".`);
  await conn.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
