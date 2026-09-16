import { createHash, randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";
import { query } from "./db.js";
import { config } from "./config.js";
import { HttpError } from "./validation.js";
export const cookieName = "message_session";
const options = {
  httpOnly: true,
  secure: config.secure,
  sameSite: "strict",
  path: "/",
};
export function sessionHash(headers) {
  const token = parse(headers.cookie || "")[cookieName];
  return token && /^[a-f0-9]{64}$/.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;
}
export async function authenticate(headers) {
  const hash = sessionHash(headers);
  if (!hash) throw new HttpError(401, "Please sign in.");
  const [row] = await query(
    "SELECT u.id,u.username,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)",
    [hash],
  );
  if (!row)
    throw new HttpError(401, "Your session expired. Please sign in again.");
  return {
    user: { id: row.id, username: row.username, displayName: row.display_name },
    hash,
    expires: row.expires_at,
  };
}
export async function requireAuth(req, res, next) {
  try {
    req.auth = await authenticate(req.headers);
    next();
  } catch (e) {
    next(e);
  }
}
export async function issueSession(res, userId) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await query(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
    [hash, userId, new Date(Date.now() + config.sessionMs)],
  );
  res.setHeader(
    "Set-Cookie",
    serialize(cookieName, token, {
      ...options,
      maxAge: config.sessionMs / 1000,
    }),
  );
}
export function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    serialize(cookieName, "", { ...options, maxAge: 0 }),
  );
}
