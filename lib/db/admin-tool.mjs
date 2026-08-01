// Small operational helper for granting/revoking admin access.
//
// The admin dashboard gates on `users.is_admin = true` and there is
// intentionally no UI for it (see docs/runbook.md §3) — it must be set
// directly in the database. This script reads DATABASE_URL from the
// api-server .env and lets you list users or flip the admin flag.
//
//   node admin-tool.mjs list
//   node admin-tool.mjs grant <email>
//   node admin-tool.mjs revoke <email>
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../artifacts/api-server/.env");
const envText = readFileSync(envPath, "utf8");
const match = envText.match(/^DATABASE_URL=(.+)$/m);
if (!match) {
  console.error("DATABASE_URL not found in artifacts/api-server/.env");
  process.exit(1);
}
const connectionString = match[1].trim().replace(/^["']|["']$/g, "");

const action = process.argv[2];
const email = process.argv[3];

const client = new Client({ connectionString });
await client.connect();

try {
  if (action === "list") {
    const r = await client.query(
      "SELECT app_user_id, clerk_user_id, email, is_admin, is_tester, created_at FROM users ORDER BY created_at DESC LIMIT 30",
    );
    console.table(r.rows);
  } else if ((action === "grant" || action === "revoke") && email) {
    const value = action === "grant";
    const r = await client.query(
      "UPDATE users SET is_admin = $1 WHERE lower(email) = lower($2) RETURNING app_user_id, clerk_user_id, email, is_admin",
      [value, email],
    );
    console.log(`Rows updated: ${r.rowCount}`);
    console.table(r.rows);
    if (r.rowCount === 0) {
      console.log(
        "No matching user row. The person must sign in to the admin web or mobile app at least once first (that creates the users row).",
      );
    }
  } else {
    console.log("Usage: node admin-tool.mjs list | grant <email> | revoke <email>");
  }
} finally {
  await client.end();
}
