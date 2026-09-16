import test from "node:test";
import assert from "node:assert/strict";
import {
  credentials,
  id,
  messageInput,
  publicMessage,
} from "../src/validation.js";
test("credentials normalize username and enforce bcrypt byte limit", () => {
  assert.deepEqual(
    credentials(
      {
        username: "  Sandesh_30 ",
        password: "password123",
        displayName: " Sandesh ",
      },
      true,
    ),
    { username: "sandesh_30", password: "password123", displayName: "Sandesh" },
  );
  assert.throws(
    () => credentials({ username: "abc", password: "🙂".repeat(19) }),
    /72 bytes/,
  );
  assert.throws(
    () => credentials({ username: "a b", password: "password123" }),
    /Username/,
  );
  assert.throws(
    () =>
      credentials(
        { username: "abc", password: "password123", displayName: " " },
        true,
      ),
    /Display name/,
  );
});
test("identifiers reject unsafe and malformed numbers", () => {
  for (const value of ["x", 0, -1, 1.5, Infinity, "9007199254740992"])
    assert.throws(() => id(value));
  assert.equal(id("42"), 42);
});
test("message content and retry identifiers are bounded", () => {
  const clientId = "18b8bef8-2904-4ad3-b59d-5f4f3f8b4a61";
  assert.equal(messageInput({ text: " hello ", clientId }).text, "hello");
  assert.throws(
    () => messageInput({ text: "x".repeat(4001), clientId }),
    /4,000/,
  );
  assert.throws(() => messageInput({ text: "Hi", clientId: "not-a-uuid" }));
});
test("public messages never expose storage paths", () => {
  const result = publicMessage({
    id: 1,
    conversation_id: 2,
    sender_id: 3,
    media_path: "private-file-name",
    media_mime: "image/png",
    media_name: "a.png",
    media_size: 68,
  });
  assert.equal(result.media.url, "/api/media/1");
  assert.equal(JSON.stringify(result).includes("private-file-name"), false);
});
