import "./config.js";
import mysql from "mysql2/promise";
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "message",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "message",
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "Z",
  dateStrings: false,
});
pool.on("connection", (conn) => conn.query("SET time_zone = '+00:00'"));
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(async (sql, args = []) => {
      const [r] = await conn.execute(sql, args);
      return r;
    });
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
