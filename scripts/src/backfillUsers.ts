import { db, usersTable, userTokensTable, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[backfillUsers] starting");
  const result = await db.execute(sql`
    INSERT INTO ${usersTable} (app_user_id)
    SELECT DISTINCT ${userTokensTable.appUserId}
    FROM ${userTokensTable}
    LEFT JOIN ${usersTable}
      ON ${userTokensTable.appUserId} = ${usersTable.appUserId}
    WHERE ${usersTable.appUserId} IS NULL
    ON CONFLICT (app_user_id) DO NOTHING
  `);
  const inserted =
    typeof (result as { rowCount?: number | null }).rowCount === "number"
      ? (result as { rowCount: number }).rowCount
      : "?";
  console.log(`[backfillUsers] inserted ${inserted} row(s)`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfillUsers] failed:", err);
    await pool.end().catch((shutdownErr) =>
      console.error("[backfillUsers] pool.end failed:", shutdownErr),
    );
    process.exit(1);
  });
