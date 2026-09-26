import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32,
  totp,
  verifyCode,
  encrypt,
  decrypt,
} from "../src/admin-crypto.js";
import { needsReview } from "../src/moderation.js";
test("TOTP standard vector, time window and replay prevention", () => {
  const secret = Buffer.from("12345678901234567890");
  assert.equal(base32(Buffer.from("foo")), "MZXW6");
  assert.equal(totp(secret, 1), "287082");
  assert.equal(verifyCode(secret, "287082", -1, 59000), 1);
  assert.equal(verifyCode(secret, "287082", 1, 59000), null);
  assert.equal(verifyCode(secret, "287082", -1, 120000), null);
  assert.equal(verifyCode(secret, "abc123", -1, 59000), null);
});
test("authenticator secret encryption rejects tampering", () => {
  process.env.ADMIN_ENCRYPTION_KEY = "ab".repeat(32);
  const secret = Buffer.from("an authenticator secret"),
    encoded = encrypt(secret);
  assert.deepEqual(decrypt(encoded), secret);
  const changed = Buffer.from(encoded, "base64");
  changed[15] ^= 1;
  assert.throws(() => decrypt(changed.toString("base64")));
});
test("moderation flags abusive phrases without matching harmless substrings", () => {
  assert.equal(needsReview("A beautiful day"), false);
  assert.equal(needsReview("Scunthorpe"), false);
  assert.equal(needsReview("FUCK you"), true);
  assert.equal(needsReview("kill yourself"), true);
  assert.equal(needsReview("मुजी"), true);
});
