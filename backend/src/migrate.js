import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
export async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [locks] = await conn.query(
      "SELECT GET_LOCK('message_schema_migration',30) AS acquired",
    );
    if (!locks[0].acquired)
      throw new Error("Could not acquire schema migration lock");
    await conn.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    );
    const [rows] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=1",
    );
    if (!rows.length) {
      const sql = await readFile(
        new URL("../../database/schema.sql", import.meta.url),
        "utf8",
      );
      for (const statement of sql.split(";").filter((x) => x.trim()))
        await conn.query(statement);
      await conn.query("INSERT INTO schema_migrations(version) VALUES (1)");
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('message_schema_migration')");
    conn.release();
  }
}
try {
  await migrate();
  console.log("Database schema is ready.");
} finally {
  await pool.end();
}
