import mysql from "mysql2/promise";
import { DefaultAzureCredential } from "@azure/identity";
import { config } from "../config/env.js";

// Azure Database for MySQL Flexible Server AAD auth: the "password" is a short-lived AAD
// access token, not a secret we own. DefaultAzureCredential resolves to the App Service's
// Managed Identity in Azure, and to the developer's own `az login` session locally - same
// code path in both places, no connection string or password ever stored in app settings.
const AAD_MYSQL_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const credential = new DefaultAzureCredential();

let cachedToken = null;
let pool = null;

async function getFreshToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOnTimestamp - now > TOKEN_REFRESH_MARGIN_MS) {
    return cachedToken.token;
  }
  const token = await credential.getToken(AAD_MYSQL_SCOPE);
  cachedToken = token;
  return token.token;
}

async function buildPool() {
  const password = await getFreshToken();
  return mysql.createPool({
    host: config.mysql.host,
    user: config.mysql.user,
    password,
    database: config.mysql.database,
    ssl: { minVersion: "TLSv1.2" },
    // Safe here only because ssl above enforces TLS for the whole connection - the AAD
    // token is never sent outside an encrypted channel. Required by Azure MySQL Flexible
    // Server's AAD auth plugin, which authenticates via mysql_clear_password.
    enableCleartextPlugin: true,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
}

// Recreates the pool once the cached token is close to expiry, so callers never hand
// mysql2 a stale AAD token. Cheap to call per-query; buildPool() only runs when needed.
export async function getPool() {
  const now = Date.now();
  const tokenIsStale = !cachedToken || cachedToken.expiresOnTimestamp - now <= TOKEN_REFRESH_MARGIN_MS;
  if (!pool || tokenIsStale) {
    if (pool) {
      await pool.end().catch(() => {});
    }
    pool = await buildPool();
  }
  return pool;
}

export async function query(sql, params) {
  const p = await getPool();
  const [rows] = await p.query(sql, params);
  return rows;
}
