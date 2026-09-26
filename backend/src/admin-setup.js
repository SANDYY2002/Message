import "./config.js";
import { randomBytes } from "node:crypto";
import { query, pool, transaction } from "./db.js";
import { base32, encrypt } from "./admin-crypto.js";
const username = (process.argv[2] || "").toLowerCase();
try {
  if (!username)
    throw new Error("Usage: node backend/src/admin-setup.js yukin [--reset]");
  const [u] = await query("SELECT id,username FROM users WHERE username=?", [
    username,
  ]);
  if (!u)
    throw new Error(
      "Register this account first, then run setup on the trusted server.",
    );
  const [existing] = await query(
    "SELECT user_id FROM superadmins WHERE user_id=?",
    [u.id],
  );
  if (existing && process.argv[3] !== "--reset")
    throw new Error(
      "Already enrolled. Use --reset only to recover authenticator access.",
    );
  const secret = randomBytes(20);
  await transaction(async (q) => {
    await q(
      "INSERT INTO superadmins(user_id,secret) VALUES(?,?) ON DUPLICATE KEY UPDATE secret=VALUES(secret),last_step=-1",
      [u.id, encrypt(secret)],
    );
    await q(
      "DELETE a FROM admin_sessions a JOIN sessions s ON s.token_hash=a.token_hash WHERE s.user_id=?",
      [u.id],
    );
    await q(
      "INSERT INTO admin_audit(admin_id,action,target_id) VALUES(?,?,?)",
      [u.id, existing ? "mfa_reset" : "admin_enrolled", u.id],
    );
  });
  console.log(
    `Add a time-based account in your authenticator: Message (${u.username})`,
  );
  console.log(`Setup key (keep private): ${base32(secret)}`);
  console.log(
    "Use 6 digits, SHA1, 30 seconds. Refresh Message, open Admin, and enter your password and current code.",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
