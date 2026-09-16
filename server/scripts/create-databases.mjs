// One-time: create the two application databases (prod + dev, sharing one MySQL server
// per the approved plan). Run as the AAD administrator.
import mysql from "mysql2/promise";
import { execSync } from "node:child_process";

const HOST = "mysql-sportspres-assetmgmt.mysql.database.azure.com";
const ADMIN_LOGIN = "vatsan@worldtabletennis.com";

function getAadToken() {
  return execSync("az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv", {
    encoding: "utf8",
  }).trim();
}

async function main() {
  const conn = await mysql.createConnection({
    host: HOST,
    user: ADMIN_LOGIN,
    password: getAadToken(),
    ssl: { minVersion: "TLSv1.2" },
    enableCleartextPlugin: true,
  });

  await conn.query("CREATE DATABASE IF NOT EXISTS `assetmgmt`");
  await conn.query("CREATE DATABASE IF NOT EXISTS `assetmgmt_dev`");
  console.log("Databases ready: assetmgmt, assetmgmt_dev");
  await conn.end();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
