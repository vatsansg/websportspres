// One-time verification script (QA doc TC-10): proves the event_tables CHECK
// constraints actually reject the invalid LED combinations from Web BRD Section 3.1.
// Not part of the running app - run by hand, connects as the AAD admin.
import mysql from "mysql2/promise";
import { execSync } from "node:child_process";

const HOST = "mysql-sportspres-assetmgmt.mysql.database.azure.com";
const ADMIN_LOGIN = "vatsan@worldtabletennis.com";
const DATABASE = "assetmgmt_dev";

function getAadToken() {
  return execSync("az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv", {
    encoding: "utf8",
  }).trim();
}

async function expectReject(conn, label, sql, params) {
  try {
    await conn.query(sql, params);
    console.log(`FAIL  ${label}: insert succeeded, expected a CHECK constraint violation`);
    return false;
  } catch (err) {
    if (err.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      console.log(`PASS  ${label}: rejected as expected (${err.sqlMessage})`);
      return true;
    }
    console.log(`FAIL  ${label}: rejected, but with an unexpected error: ${err.code} ${err.message}`);
    return false;
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: HOST,
    user: ADMIN_LOGIN,
    password: getAadToken(),
    database: DATABASE,
    ssl: { minVersion: "TLSv1.2" },
    enableCleartextPlugin: true,
  });

  // Temporary event row to satisfy the FK, deleted at the end regardless of outcome.
  await conn.query(
    `INSERT INTO events (event_id, event_name, year, status) VALUES ('TST1', 'Constraint Test Event', 2026, 'Active')`
  );

  const insertSql = `INSERT INTO event_tables (event_id, table_number, inner_led, outer_led, main_led) VALUES (?, ?, ?, ?, ?)`;

  // Post-004: a single rule - Outer can never be selected without Inner. Main is
  // independently free (resolves the BRD Section 3.1 rule 2 vs. rule 7 contradiction;
  // see workflow.md and 004_fix_outer_led_constraint.sql for the full reasoning).
  let allPassed = true;
  allPassed &= await expectReject(
    conn,
    "outer alone (no inner/main)",
    insertSql,
    ["TST1", 1, 0, 1, 0]
  );
  allPassed &= await expectReject(
    conn,
    "outer + main, no inner",
    insertSql,
    ["TST1", 1, 0, 1, 1]
  );
  allPassed &= await expectReject(
    conn,
    "no LED type selected at all",
    insertSql,
    ["TST1", 1, 0, 0, 0]
  );

  // Sanity checks: valid combinations must still succeed.
  for (const [label, inner, outer, main] of [
    ["inner alone", 1, 0, 0],
    ["inner+outer", 1, 1, 0],
    ["inner+main", 1, 0, 1],
    ["inner+outer+main (rule 7 - this is the one 003 used to wrongly reject)", 1, 1, 1],
    ["main alone", 0, 0, 1],
  ]) {
    try {
      await conn.query(insertSql, ["TST1", Math.floor(Math.random() * 1000) + 2, inner, outer, main]);
      console.log(`PASS  valid combination (${label}) was accepted, as expected`);
    } catch (err) {
      console.log(`FAIL  valid combination (${label}) was rejected unexpectedly: ${err.message}`);
      allPassed = false;
    }
  }

  await conn.query(`DELETE FROM events WHERE event_id = 'TST1'`); // cascades to event_tables
  await conn.end();

  console.log(allPassed ? "\nAll TC-10 checks passed." : "\nSome TC-10 checks FAILED.");
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test script failed:", err.message);
  process.exit(1);
});
