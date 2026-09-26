import sharp from "sharp";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
if (!process.env.DB_NAME?.endsWith("_test"))
  throw new Error("Use a dedicated _test database.");
process.env.NODE_ENV = "test";
process.env.PUBLIC_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
process.env.ADMIN_ENCRYPTION_KEY = "cd".repeat(32);
let runtime,
  base,
  a,
  b,
  c,
  q,
  secret = randomBytes(20),
  totp;
async function req(route, user, method = "GET", body) {
  const form = body instanceof FormData;
  const r = await fetch(base + "/api" + route, {
    method,
    headers: {
      Origin: process.env.PUBLIC_ORIGIN,
      ...(user ? { Cookie: user.cookie } : {}),
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  return {
    status: r.status,
    data: r.headers.get("content-type")?.includes("application/json")
      ? await r.json()
      : null,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(label) {
  const r = await req("/auth/register", null, "POST", {
    username: label + "_" + Date.now().toString().slice(-8),
    displayName: label,
    password: "safe-password-123",
  });
  assert.equal(r.status, 201);
  return { ...r.data.user, cookie: r.cookie };
}
before(async () => {
  const { migrate } = await import("../src/migrate.js");
  await migrate();
  const { start } = await import("../src/server.js");
  runtime = await start(0);
  base = `http://127.0.0.1:${runtime.server.address().port}`;
  q = (await import("../src/db.js")).query;
  const crypto = await import("../src/admin-crypto.js");
  totp = crypto.totp;
  a = await register("confa");
  b = await register("confb");
  c = await register("confc");
  await q("INSERT INTO superadmins(user_id,secret) VALUES(?,?)", [
    c.id,
    crypto.encrypt(secret),
  ]);
});
after(async () => {
  await runtime?.close();
});
test("confession anonymity, media, comments, review and author deletion", async () => {
  assert.equal((await req("/confessions", null)).status, 401);
  const form = new FormData();
  form.append("text", "A quiet confession");
  form.append(
    "file",
    new Blob(
      [
        await sharp({
          create: { width: 2, height: 2, channels: 3, background: "red" },
        })
          .png()
          .toBuffer(),
      ],
      { type: "image/png" },
    ),
    "secret-username.png",
  );
  const r = await req("/confessions", a, "POST", form);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pid = r.data.post.id;
  let p = (await req("/confessions", b)).data.posts.find((x) => x.id === pid);
  assert.equal(p.isOwner, false);
  for (const forbidden of [
    "author_id",
    "authorId",
    "username",
    "avatar",
    "secret-username",
  ])
    assert.equal(JSON.stringify(p).includes(forbidden), false);
  assert.equal((await req(`/confessions/${pid}/media`, b)).status, 200);
  assert.equal((await req(`/confessions/${pid}/media`, null)).status, 401);
  for (let i = 0; i < 2; i++)
    assert.equal((await req(`/confessions/${pid}/like`, b, "PUT")).status, 204);
  p = (await req("/confessions", b)).data.posts.find((x) => x.id === pid);
  assert.equal(p.likes, 1);
  assert.equal(
    (
      await req(`/confessions/${pid}/comments`, b, "POST", {
        text: "A kind thought",
        anonymous: true,
      })
    ).status,
    201,
  );
  let comments = (await req(`/confessions/${pid}/comments`, a)).data.comments;
  assert.equal(comments[0].author, null);
  assert.equal(JSON.stringify(comments).includes(b.username), false);
  assert.equal(
    (
      await req(`/confessions/${pid}/comments`, b, "POST", {
        text: "Named thought",
        anonymous: false,
      })
    ).status,
    201,
  );
  comments = (await req(`/confessions/${pid}/comments`, a)).data.comments;
  assert.equal(comments[0].author.username, b.username);
  const pending = await req("/confessions", a, "POST", {
    text: "fuck this day",
  });
  assert.equal(pending.data.post.status, "pending");
  assert.equal(
    (await req("/confessions", b)).data.posts.some(
      (x) => x.id === pending.data.post.id,
    ),
    false,
  );
  assert.equal(
    (await req(`/confessions/${pending.data.post.id}/comments`, b)).status,
    404,
  );
  assert.equal((await req(`/confessions/${pid}`, b, "DELETE")).status, 404);
  await req(`/blocks/${b.id}`, a, "PUT");
  assert.equal((await req(`/confessions/${pid}/like`, b, "PUT")).status, 404);
  assert.equal((await req(`/confessions/${pid}/media`, b)).status, 404);
  await req(`/blocks/${b.id}`, a, "DELETE");
  assert.equal((await req(`/confessions/${pid}`, a, "DELETE")).status, 204);
  assert.equal((await req(`/confessions/${pid}/media`, a)).status, 404);
});
test("admin access requires password plus fresh TOTP and is bound to session", async () => {
  assert.equal((await req("/admin/status", a)).data.eligible, false);
  assert.equal((await req("/admin/users", a)).status, 403);
  assert.equal((await req("/admin/users", c)).status, 403);
  const code = totp(secret, Math.floor(Date.now() / 30000));
  assert.equal(
    (
      await req("/admin/unlock", c, "POST", {
        password: "wrong-password",
        code,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/admin/unlock", c, "POST", {
        password: "safe-password-123",
        code,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req("/admin/unlock", c, "POST", {
        password: "safe-password-123",
        code,
      })
    ).status,
    403,
  );
  const login = await req("/auth/login", null, "POST", {
    username: c.username,
    password: "safe-password-123",
  });
  assert.equal(
    (await req("/admin/users", { cookie: login.cookie })).status,
    403,
  );
  const users = await req("/admin/users", c);
  assert.equal(users.status, 200);
  assert.equal(JSON.stringify(users.data).includes("password_hash"), false);
  for (const tab of [
    "profile",
    "posts",
    "confessions",
    "comments",
    "messages",
    "followers",
    "following",
    "blocks",
    "activity",
    "saved",
    "reactions",
    "social_comments",
    "calls",
  ]) {
    const view = await req(`/admin/users/${a.id}/${tab}`, c);
    assert.equal(view.status, 200, tab + JSON.stringify(view.data));
  }
  const queue = await req("/admin/moderation", c);
  assert.equal(queue.status, 200);
  const p = queue.data.posts.find((p) => p.author_id === a.id);
  assert.equal(p.username, a.username);
  assert.equal(
    (
      await req(`/admin/moderation/posts/${p.id}`, c, "POST", {
        status: "published",
      })
    ).status,
    204,
  );
  assert.equal(
    (await req("/confessions", b)).data.posts.some((x) => x.id === p.id),
    true,
  );
  const convo = await req("/conversations", a, "POST", { userId: b.id });
  const cid = convo.data.id;
  await req(`/conversations/${cid}/messages`, a, "POST", {
    text: "Private message for audit test",
    clientId: randomUUID(),
  });
  assert.equal((await req(`/admin/conversations/${cid}`, b)).status, 403);
  assert.equal(
    (await req(`/admin/conversations/${cid}`, c)).data.messages[0].text,
    "Private message for audit test",
  );
  const audit = await req("/admin/audit", c);
  assert.ok(
    audit.data.rows.some(
      (r) => r.action === "private_messages" && r.target_id === cid,
    ),
  );
  await q(
    "UPDATE admin_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND)",
  );
  assert.equal((await req("/admin/users", c)).status, 403);
});
test("blocked chats remain readable and deletion hides only the local inbox", async () => {
  const cid = (await req("/conversations", a, "POST", { userId: b.id })).data
    .id;
  await req(`/conversations/${cid}/accept`, b, "POST", {});
  await req(`/blocks/${b.id}`, a, "PUT");
  assert.equal((await req(`/conversations/${cid}/messages`, b)).status, 200);
  assert.equal(
    (
      await req(`/conversations/${cid}/messages`, b, "POST", {
        text: "Blocked",
        clientId: randomUUID(),
      })
    ).status,
    403,
  );
  let listed = (await req("/conversations", a)).data.conversations.find(
    (c) => c.id === cid,
  );
  assert.equal(listed.blockedByMe, true);
  assert.equal((await req(`/conversations/${cid}`, a, "DELETE")).status, 204);
  assert.equal(
    (await req("/conversations", a)).data.conversations.some(
      (c) => c.id === cid,
    ),
    false,
  );
  assert.equal(
    (await req("/conversations", b)).data.conversations.some(
      (c) => c.id === cid,
    ),
    true,
  );
  assert.equal((await req(`/conversations/${cid}`, c, "DELETE")).status, 404);
  await req(`/blocks/${b.id}`, a, "DELETE");
  assert.equal(
    (
      await req(`/conversations/${cid}/messages`, b, "POST", {
        text: "Unblocked",
        clientId: randomUUID(),
      })
    ).status,
    201,
  );
  assert.equal(
    (await req("/conversations", a)).data.conversations.some(
      (c) => c.id === cid,
    ),
    true,
  );
});
