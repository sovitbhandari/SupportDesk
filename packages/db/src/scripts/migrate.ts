import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "../client.js";

const migrationFiles = [
  "001_init_schema.sql",
  "002_enable_rls.sql",
  "004_fix_rls_recursion.sql",
  "005_add_manual_support_tables.sql",
  "006_hash_legacy_passwords.sql"
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        file_name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    for (const fileName of migrationFiles) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE file_name = $1 LIMIT 1",
        [fileName]
      );
      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
        console.log(`Skipping migration (already applied): ${fileName}`);
        continue;
      }

      const absolutePath = join(process.cwd(), "migrations", fileName);
      const sql = await readFile(absolutePath, "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (file_name) VALUES ($1)", [fileName]);
      await client.query("COMMIT");
      console.log(`Applied migration: ${fileName}`);
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // no-op: rollback may fail if transaction never started
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
