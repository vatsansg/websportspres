// One-time bootstrap: run as the MySQL AAD Administrator (my own AAD identity, via az cli token)
// to create the databases and the AAD-mapped MySQL users for the App Service's two managed identities.
// This is NOT part of the running application - it is an operator script, run once by hand.
import mysql from "mysql2/promise";
import { execSync } from "node:child_process";

const HOST = "mysql-sportspres-assetmgmt.mysql.database.azure.com";
const ADMIN_LOGIN = "vatsan@worldtabletennis.com";

const PROD_APP_PRINCIPAL_ID = "33a4e55a-eeb0-46a2-bd58-81ec7ed80c16";
const DEV_APP_PRINCIPAL_ID = "375425bf-bec2-4d1c-8b53-a5852174095c";
const PROD_MYSQL_USER = "app-sportspres-assetmgmt";
const DEV_MYSQL_USER = "app-sportspres-assetmgmt-dev";
const PROD_DB = "assetmgmt";
const DEV_DB = "assetmgmt_dev";

function getAadToken() {
  const out = execSync(
    "az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv",
    { encoding: "utf8" }
  );
  return out.trim();
}

async function main() {
  const token = getAadToken();
  const conn = await mysql.createConnection({
    host: HOST,
    user: ADMIN_LOGIN,
    password: token,
    ssl: { minVersion: "TLSv1.2" },
    enableCleartextPlugin: true,
    database: undefined,
  });

  console.log("Connected as AAD admin. Creating databases...");
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${PROD_DB}\``);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DEV_DB}\``);

  console.log("Creating AAD-mapped MySQL users for App Service managed identities...");
  // Requires the server's user-assigned managed identity to hold the Directory Readers
  // role in Entra ID, so it can validate these object IDs against the tenant. If that role
  // has not been granted yet, this step will fail - do not work around it by disabling
  // aad_auth_validate_oids_in_tenant without the user's explicit sign-off (see workflow.md).
  await conn.query(
    `CREATE AADUSER IF NOT EXISTS '${PROD_MYSQL_USER}' IDENTIFIED BY '${PROD_APP_PRINCIPAL_ID}'`
  );
  await conn.query(
    `CREATE AADUSER IF NOT EXISTS '${DEV_MYSQL_USER}' IDENTIFIED BY '${DEV_APP_PRINCIPAL_ID}'`
  );

  console.log("Granting least-privilege access...");
  await conn.query(
    `GRANT ALL PRIVILEGES ON \`${PROD_DB}\`.* TO '${PROD_MYSQL_USER}'@'%'`
  );
  await conn.query(
    `GRANT ALL PRIVILEGES ON \`${DEV_DB}\`.* TO '${DEV_MYSQL_USER}'@'%'`
  );
  await conn.query(`FLUSH PRIVILEGES`);

  console.log("Done.");
  await conn.end();
}

main().catch((err) => {
  console.error("Bootstrap failed:", err.message);
  process.exit(1);
});
