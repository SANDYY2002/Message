import { migrateSocial } from "./social-migration.js";
import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { fileURLToPath } from "node:url";
export const LATEST_SCHEMA_VERSION = 7;
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
    const [v2] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=2",
    );
    if (!v2.length) {
      // MySQL DDL is not transactional. Introspection makes a partially applied upgrade resumable.
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages'",
      );
      const names = new Set(columns.map((c) => c.COLUMN_NAME));
      for (const [name, definition] of [
        ["edited_at", "DATETIME(3) NULL"],
        ["deleted_at", "DATETIME(3) NULL"],
        ["revision", "INT UNSIGNED NOT NULL DEFAULT 0"],
      ]) {
        if (!names.has(name))
          await conn.query(
            `ALTER TABLE messages ADD COLUMN ${name} ${definition}`,
          );
      }
      await conn.query(
        "CREATE TABLE IF NOT EXISTS media_deletions (path VARCHAR(80) PRIMARY KEY, queued_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB",
      );
      await conn.query("INSERT INTO schema_migrations(version) VALUES (2)");
    }
    const [v3] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=3",
    );
    if (!v3.length) {
      await conn.query(`CREATE TABLE IF NOT EXISTS calls (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        call_key CHAR(36) CHARACTER SET ascii NOT NULL UNIQUE,
        conversation_id INT UNSIGNED NOT NULL,
        caller_id INT UNSIGNED NOT NULL,
        callee_id INT UNSIGNED NOT NULL,
        kind ENUM('voice','video') NOT NULL,
        status VARCHAR(20) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        answered_at DATETIME(3) NULL,
        ended_at DATETIME(3) NULL,
        INDEX caller_history (caller_id,id), INDEX callee_history (callee_id,id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (caller_id) REFERENCES users(id),
        FOREIGN KEY (callee_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await conn.query("INSERT INTO schema_migrations(version) VALUES (3)");
    }
    const [v4] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=4",
    );
    if (!v4.length) {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='conversations'",
      );
      const names = new Set(columns.map((c) => c.COLUMN_NAME));
      for (const [name, definition] of [
        ["kind", "VARCHAR(10) NOT NULL DEFAULT 'direct'"],
        ["name", "VARCHAR(60) NULL"],
        ["owner_id", "INT UNSIGNED NULL"],
      ]) {
        if (!names.has(name))
          await conn.query(
            `ALTER TABLE conversations ADD COLUMN ${name} ${definition}`,
          );
      }
      await conn.query(
        "ALTER TABLE conversations MODIFY user_low INT UNSIGNED NULL, MODIFY user_high INT UNSIGNED NULL",
      );
      await conn.query(`CREATE TABLE IF NOT EXISTS group_members (
        conversation_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        read_id INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id,user_id), INDEX member_groups(user_id,conversation_id),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      ) ENGINE=InnoDB`);
      await conn.query("INSERT INTO schema_migrations(version) VALUES(4)");
    }
    const [v5] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=5",
    );
    if (!v5.length) {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'",
      );
      const names = new Set(columns.map((c) => c.COLUMN_NAME));
      for (const [name, definition] of [
        ["avatar_preset", "VARCHAR(20) NOT NULL DEFAULT 'initials'"],
        ["avatar_path", "VARCHAR(80) NULL"],
        ["avatar_revision", "INT UNSIGNED NOT NULL DEFAULT 0"],
      ])
        if (!names.has(name))
          await conn.query(
            `ALTER TABLE users ADD COLUMN ${name} ${definition}`,
          );
      await conn.query("INSERT INTO schema_migrations(version) VALUES(5)");
    }
    const [v6] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=6",
    );
    if (!v6.length) {
      await migrateSocial(conn);
      await conn.query("INSERT INTO schema_migrations(version) VALUES(6)");
    }
    const [v7] = await conn.query(
      "SELECT version FROM schema_migrations WHERE version=7",
    );
    if (!v7.length) {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='bio'",
      );
      if (!columns.length)
        await conn.query(
          "ALTER TABLE users ADD COLUMN bio VARCHAR(300) NOT NULL DEFAULT ''",
        );
      await conn.query("INSERT INTO schema_migrations(version) VALUES(7)");
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('message_schema_migration')");
    conn.release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await migrate();
    console.log("Database schema is ready.");
  } finally {
    await pool.end();
  }
}
