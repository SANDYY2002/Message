import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const backendDir = fileURLToPath(new URL("..", import.meta.url));
dotenv.config({ path: path.join(backendDir, ".env"), quiet: true });
const integer = (key, fallback, min, max) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${key}`);
  return n;
};
const production = process.env.NODE_ENV === "production";
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:5173";
if (new URL(origin).origin !== origin)
  throw new Error("PUBLIC_ORIGIN must be an origin with no trailing slash");
const secure = process.env.COOKIE_SECURE === "true";
if (production && (!secure || !origin.startsWith("https://")))
  throw new Error(
    "Production requires an HTTPS PUBLIC_ORIGIN and COOKIE_SECURE=true",
  );
export const config = {
  production,
  origin,
  secure,
  port: integer("PORT", 4000, 1, 65535),
  trustProxy: integer("TRUST_PROXY", 0, 0, 5),
  uploadDir: path.resolve(backendDir, process.env.UPLOAD_DIR || "uploads"),
  maxBytes: integer("MAX_UPLOAD_MB", 25, 1, 200) * 1024 * 1024,
  storageBytes: integer("MAX_USER_STORAGE_MB", 1024, 1, 100000) * 1024 * 1024,
  sessionMs: integer("SESSION_DAYS", 7, 1, 30) * 86400000,
};
