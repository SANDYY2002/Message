import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io as connect } from "socket.io-client";
if (!process.env.DB_NAME?.endsWith("_test"))
  throw new Error("Use a dedicated _test database.");
process.env.NODE_ENV = "test";
process.env.PUBLIC_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
let runtime, base, a, b, c;
const sockets = [];
async function req(route, user, method = "GET", body) {
  const r = await fetch(base + "/api" + route, {
    method,
    headers: {
      Origin: process.env.PUBLIC_ORIGIN,
      ...(user ? { Cookie: user.cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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
    username: `${label}_${Date.now().toString().slice(-8)}`,
    displayName: label,
    password: "safe-password-123",
  });
  assert.equal(r.status, 201);
  return { ...r.data.user, cookie: r.cookie };
}
async function socket(user) {
  const s = connect(base, {
    transports: ["websocket"],
    extraHeaders: { Cookie: user.cookie, Origin: process.env.PUBLIC_ORIGIN },
  });
  sockets.push(s);
  await new Promise((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
async function send(cid, user, text) {
  return req(`/conversations/${cid}/messages`, user, "POST", {
    text,
    clientId: randomUUID(),
  });
}
before(async () => {
  const { migrate } = await import("../src/migrate.js");
  await migrate();
  const { start } = await import("../src/server.js");
  runtime = await start(0);
  base = `http://127.0.0.1:${runtime.server.address().port}`;
  a = await register("sociala");
  b = await register("socialb");
  c = await register("socialc");
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  await runtime?.close();
});
test("social interactions are persistent, idempotent and protected by blocking", async () => {
  assert.equal((await req("/posts", null)).status, 401);
  assert.equal((await req("/posts", a, "POST", { text: " " })).status, 400);
  const p = await req("/posts", a, "POST", { text: "A real community post" });
  assert.equal(p.status, 201);
  const pid = p.data.id;
  const sa = await socket(a);
  const events = [];
  sa.on("activity:new", (n) => events.push(n));
  assert.equal((await req(`/people/${a.id}/follow`, b, "PUT")).status, 204);
  for (let i = 0; i < 2; i++)
    assert.equal((await req(`/posts/${pid}/like`, b, "PUT")).status, 204);
  assert.equal(
    (
      await req(`/posts/${pid}/comments`, b, "POST", {
        text: "Hello community",
      })
    ).status,
    201,
  );
  assert.equal((await req(`/posts/${pid}/repost`, b, "POST")).status, 204);
  assert.equal((await req(`/posts/${pid}/bookmark`, b, "PUT")).status, 204);
  const detail = (await req(`/posts/${pid}`, b)).data.post;
  assert.equal(detail.likes, 1);
  assert.equal(detail.comments, 1);
  assert.equal(detail.reposts, 1);
  assert.equal(detail.bookmarked, 1);
  const activities = (await req("/activities", a)).data;
  assert.equal(activities.items.filter((n) => n.actor.id === b.id).length, 4);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(events.length, 4);
  assert.equal(
    (await req("/posts?mode=following", b)).data.posts.some(
      (p) => p.id === pid,
    ),
    true,
  );
  assert.equal(
    (await req("/posts?mode=saved", b)).data.posts.some((p) => p.id === pid),
    true,
  );
  const comment = (await req(`/posts/${pid}/comments`, b)).data.comments[0];
  assert.equal((await req(`/comments/${comment.id}`, c, "DELETE")).status, 404);
  assert.equal((await req(`/posts/${pid}`, b, "DELETE")).status, 404);
  await req("/activities/read", a, "POST", { through: activities.items[0].id });
  assert.equal((await req("/activities", a)).data.unread, 0);
  assert.equal((await req(`/blocks/${b.id}`, a, "PUT")).status, 204);
  for (const [route, method, body] of [
    [`/posts/${pid}`, "GET"],
    [`/posts/${pid}/like`, "PUT"],
    [`/posts/${pid}/comments`, "POST", { text: "Not allowed" }],
    [`/posts/${pid}/repost`, "POST"],
    [`/people/${a.id}/follow`, "PUT"],
    ["/conversations", "POST", { userId: a.id }],
  ])
    assert.equal((await req(route, b, method, body)).status, 403, route);
  assert.equal(
    (await req("/posts", b)).data.posts.some(
      (p) => p.id === pid || p.original?.id === pid,
    ),
    false,
  );
  assert.equal(
    (await req("/people", b)).data.users.some((u) => u.id === a.id),
    false,
  );
  assert.equal(
    (await req(`/posts/${pid}/comments`, a)).data.comments.length,
    0,
  );
  assert.equal(
    (await req("/activities", a)).data.items.some((n) => n.actor.id === b.id),
    false,
  );
  assert.equal((await req(`/blocks/${b.id}`, a, "DELETE")).status, 204);
  assert.equal((await req(`/posts/${pid}`, b)).status, 200);
  assert.equal((await req(`/posts/${pid}`, b)).data.post.following, 0);
  assert.equal((await req(`/posts/${pid}`, a, "DELETE")).status, 204);
  assert.equal((await req(`/posts/${pid}`, b)).status, 404);
});
test("requests require recipient consent; replies accept, declines close, and blocks stop existing chats", async () => {
  const created = await req("/conversations", a, "POST", { userId: b.id });
  assert.equal(created.status, 201);
  const cid = created.data.id;
  assert.equal(
    (await req(`/conversations/${cid}/accept`, a, "POST", {})).status,
    403,
  );
  assert.equal((await send(cid, a, "Please accept my request")).status, 201);
  assert.equal((await send(cid, a, "Cannot flood requests")).status, 403);
  const listed = (await req("/conversations", b)).data.conversations.find(
    (c) => c.id === cid,
  );
  assert.equal(listed.incomingRequest, true);
  const sa = await socket(a);
  const call = await new Promise((r) =>
    sa.emit("call:start", { conversationId: cid, kind: "voice" }, r),
  );
  assert.equal(call.ok, false);
  assert.equal((await send(cid, b, "Reply accepts the request")).status, 201);
  assert.equal(
    (await req("/conversations", b)).data.conversations.find(
      (c) => c.id === cid,
    ).requestStatus,
    "accepted",
  );
  assert.equal((await send(cid, a, "Now normal chat works")).status, 201);
  assert.equal((await req(`/blocks/${a.id}`, b, "PUT")).status, 204);
  assert.equal((await send(cid, a, "Blocked message")).status, 403);
  assert.equal((await req(`/conversations/${cid}/messages`, a)).status, 403);
  assert.equal(
    (await req(`/conversations/${cid}/search?q=hello`, a)).status,
    403,
  );
  assert.equal(
    (await req("/conversations", a)).data.conversations.some(
      (c) => c.id === cid,
    ),
    false,
  );
  const other = await req("/conversations", c, "POST", { userId: b.id });
  const declined = other.data.id;
  assert.equal((await send(declined, c, "Review this")).status, 201);
  assert.equal(
    (await req(`/conversations/${declined}/decline`, b, "POST", {})).status,
    204,
  );
  assert.equal((await send(declined, c, "No more messages")).status, 403);
  assert.equal(
    (await req("/conversations", c, "POST", { userId: b.id })).status,
    403,
  );
  await req(`/blocks/${a.id}`, b, "DELETE");
});
test("blocking filters shared group history, search and live events", async () => {
  const group = await req("/groups", c, "POST", {
    name: "Shared circle",
    userIds: [a.id, b.id],
  });
  assert.equal(group.status, 201);
  const cid = group.data.id;
  assert.equal((await send(cid, a, "Before blocking")).status, 201);
  const sb = await socket(b),
    events = [];
  sb.on("message:new", (m) => events.push(m));
  await req(`/blocks/${a.id}`, b, "PUT");
  assert.equal((await send(cid, a, "Hidden from blocked member")).status, 201);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(
    events.some((m) => m.senderId === a.id),
    false,
  );
  assert.equal(
    (await req(`/conversations/${cid}/messages`, b)).data.messages.some(
      (m) => m.senderId === a.id,
    ),
    false,
  );
  assert.equal(
    (await req(`/conversations/${cid}/search?q=Hidden`, b)).data.messages
      .length,
    0,
  );
  assert.equal(
    (await req("/groups", a, "POST", { name: "Bypass", userIds: [b.id] }))
      .status,
    403,
  );
  assert.equal(
    (await req(`/conversations/${cid}/messages`, c)).data.messages.length,
    2,
  );
});
