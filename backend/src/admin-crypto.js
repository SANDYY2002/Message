import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[19] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function verifyCode(secret, code, lastStep, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const step = Math.floor(now / 30000);
  for (const n of [step, step - 1, step + 1])
    if (
      n > lastStep &&
      timingSafeEqual(Buffer.from(totp(secret, n)), Buffer.from(String(code)))
    )
      return n;
  return null;
}
function key() {
  const s = process.env.ADMIN_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(s || ""))
    throw new Error("Configure ADMIN_ENCRYPTION_KEY before admin setup");
  return Buffer.from(s, "hex");
}
export function encrypt(secret) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(value) {
  const data = Buffer.from(value, "base64"),
    cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}
