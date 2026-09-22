// Runs against a real, dedicated MySQL database. Never point this at production.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { io as connect } from "socket.io-client";
import { video } from "./video-fixture.js";
if (!process.env.DB_NAME?.endsWith("_test"))
  throw new Error("Set DB_NAME to a dedicated database ending in _test.");
process.env.NODE_ENV = "test";
process.env.PUBLIC_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
process.env.MAX_UPLOAD_MB = "1";
const dir = await mkdtemp(path.join(tmpdir(), "message-test-"));
process.env.UPLOAD_DIR = dir;
const { query, pool } = await import("../src/db.js");
let runtime, base, alice, bob, eve, conversation, message, media;
const sockets = [];
let legacyMessageId;
async function request(
  route,
  {
    user,
    body,
    method = body ? "POST" : "GET",
    origin = process.env.PUBLIC_ORIGIN,
    form,
  } = {},
) {
  const res = await fetch(base + "/api" + route, {
    method: form ? "POST" : method,
    headers: {
      ...(user ? { Cookie: user.cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  if (res.headers.get("content-type")?.includes("application/json"))
    data = await res.json();
  return { res, data };
}
async function register(name) {
  const { res, data } = await request("/auth/register", {
    body: {
      username: `${name}_${Date.now().toString().slice(-8)}`,
      displayName: name,
      password: "safe-password-123",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(data));
  return { ...data.user, cookie: res.headers.get("set-cookie").split(";")[0] };
}
async function socketFor(user, origin = process.env.PUBLIC_ORIGIN) {
  const socket = connect(base, {
    transports: ["websocket"],
    extraHeaders: { Cookie: user.cookie, Origin: origin },
    reconnection: false,
    timeout: 3000,
  });
  sockets.push(socket);
  return socket;
}
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`Timed out waiting for ${name}`));
    }, 4000);
    const handler = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    socket.once(name, handler);
  });
}
function form(
  text = "caption",
  file = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
  name = "photo.png",
  mime = "image/png",
) {
  const data = new FormData();
  data.append("text", text);
  data.append("clientId", randomUUID());
  data.append("file", new Blob([file], { type: mime }), name);
  return data;
}
before(async () => {
  // Seed the original v1 schema before upgrading; keep this test compatible with repeat runs.
  const schema = await readFile(
    new URL("../../database/schema.sql", import.meta.url),
    "utf8",
  );
  for (const statement of schema.split(";").filter((s) => s.trim()))
    await query(statement);
  await query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  );
  await query("INSERT IGNORE INTO schema_migrations(version) VALUES(1)");
  const suffix = Date.now().toString().slice(-8);
  const legacyA = await query(
    "INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)",
    [`legacy_a_${suffix}`, "Legacy A", "unused-test-hash"],
  );
  const legacyB = await query(
    "INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)",
    [`legacy_b_${suffix}`, "Legacy B", "unused-test-hash"],
  );
  const legacyC = await query(
    "INSERT INTO conversations(user_low,user_high) VALUES(?,?)",
    [legacyA.insertId, legacyB.insertId],
  );
  const legacyM = await query(
    "INSERT INTO messages(conversation_id,sender_id,client_id,text) VALUES(?,?,?,?)",
    [legacyC.insertId, legacyA.insertId, randomUUID(), "Keep this old message"],
  );
  legacyMessageId = legacyM.insertId;
  const partial = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages' AND COLUMN_NAME='edited_at'",
  );
  if (!partial.length)
    await query("ALTER TABLE messages ADD COLUMN edited_at DATETIME(3) NULL");

  const migrated = spawnSync(process.execPath, ["src/migrate.js"], {
    cwd: new URL("../", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  const again = spawnSync(process.execPath, ["src/migrate.js"], {
    cwd: new URL("../", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(again.status, 0, again.stderr);
  const [kept] = await query("SELECT * FROM messages WHERE id=?", [
    legacyMessageId,
  ]);
  assert.equal(kept.text, "Keep this old message");
  assert.equal(kept.revision, 0);
  assert.equal(kept.deleted_at, null);

  const { start } = await import("../src/server.js");
  runtime = await start(0);
  base = `http://127.0.0.1:${runtime.server.address().port}`;
  alice = await register("alice");
  bob = await register("bob");
  eve = await register("eve");
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  if (runtime) await runtime.close();
  else await pool.end();
  await rm(dir, { recursive: true, force: true });
});
test("real MySQL authentication, chat, media, sockets, and access controls", async (t) => {
  await t.test(
    "cookies are HttpOnly and protected endpoints reject unauthenticated requests",
    async () => {
      const r = await request("/auth/login", {
        body: { username: alice.username, password: "safe-password-123" },
      });
      assert.equal(r.res.status, 200);
      assert.match(r.res.headers.get("set-cookie"), /HttpOnly/);
      assert.match(r.res.headers.get("set-cookie"), /SameSite=Strict/);
      assert.equal((await request("/conversations")).res.status, 401);
      assert.equal(
        (
          await request("/auth/login", {
            body: { username: alice.username, password: "wrong-password" },
          })
        ).res.status,
        401,
      );
      assert.equal(
        (
          await request("/auth/register", {
            body: {
              username: alice.username.toUpperCase(),
              displayName: "Duplicate",
              password: "safe-password-123",
            },
          })
        ).res.status,
        409,
      );
    },
  );
  await t.test(
    "cross-origin writes and socket handshakes are rejected",
    async () => {
      assert.equal(
        (
          await request("/conversations", {
            user: alice,
            origin: "https://evil.example",
            body: { userId: bob.id },
          })
        ).res.status,
        403,
      );
      const socket = await socketFor(alice, "https://evil.example");
      await event(socket, "connect_error");
      assert.equal(socket.connected, false);
    },
  );
  await t.test(
    "a pair shares exactly one conversation, independent of creator",
    async () => {
      const a = await request("/conversations", {
        user: alice,
        body: { userId: bob.id },
      });
      assert.equal(a.res.status, 201);
      conversation = a.data.id;
      const b = await request("/conversations", {
        user: bob,
        body: { userId: alice.id },
      });
      assert.equal(b.data.id, conversation);
      assert.equal(
        (
          await request(`/conversations/${conversation}/messages`, {
            user: eve,
          })
        ).res.status,
        404,
      );
    },
  );
  let aliceSocket, bobSocket;
  await t.test(
    "text sends emit in real time and retries do not duplicate MySQL rows",
    async () => {
      aliceSocket = await socketFor(alice);
      await event(aliceSocket, "connect");
      bobSocket = await socketFor(bob);
      await event(bobSocket, "connect");
      const received = event(bobSocket, "message:new");
      const body = { text: "Hello, Bob 👋", clientId: randomUUID() };
      const sent = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        body,
      });
      assert.equal(sent.res.status, 201, JSON.stringify(sent.data));
      message = sent.data.message;
      assert.equal((await received).id, message.id);
      const retry = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        body,
      });
      assert.equal(retry.res.status, 200);
      assert.equal(retry.data.message.id, message.id);
      const history = await request(`/conversations/${conversation}/messages`, {
        user: bob,
      });
      assert.equal(
        history.data.messages.filter((m) => m.id === message.id).length,
        1,
      );
      const list = await request("/conversations", { user: bob });
      assert.equal(list.data.conversations[0].unread, 1);
    },
  );
  await t.test("only participants may send or mark messages read", async () => {
    assert.equal(
      (
        await request(`/conversations/${conversation}/messages`, {
          user: eve,
          body: { text: "intrusion", clientId: randomUUID() },
        })
      ).res.status,
      404,
    );
    assert.equal(
      (
        await request(`/conversations/${conversation}/read`, {
          user: eve,
          body: { messageId: message.id },
        })
      ).res.status,
      404,
    );
    const receipt = event(aliceSocket, "conversation:read");
    assert.equal(
      (
        await request(`/conversations/${conversation}/read`, {
          user: bob,
          body: { messageId: message.id },
        })
      ).res.status,
      204,
    );
    assert.equal((await receipt).messageId, message.id);
    const list = await request("/conversations", { user: bob });
    assert.equal(list.data.conversations[0].unread, 0);
  });
  await t.test(
    "uploads validate contents and media access stays private",
    async () => {
      const sent = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        form: form(),
      });
      assert.equal(sent.res.status, 201, JSON.stringify(sent.data));
      media = sent.data.message;
      const privateMedia = await request(`/media/${media.id}`, { user: bob });
      assert.equal(privateMedia.res.status, 200);
      assert.match(privateMedia.res.headers.get("content-type"), /image\/png/);
      await privateMedia.res.arrayBuffer();
      assert.equal(
        (await request(`/media/${media.id}`, { user: eve })).res.status,
        404,
      );
      assert.equal((await request(`/media/${media.id}`)).res.status, 401);
      const fake = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        form: form("fake", Buffer.from("<script>alert(1)</script>")),
      });
      assert.equal(fake.res.status, 415);
      const oversized = await request(
        `/conversations/${conversation}/messages`,
        { user: alice, form: form("big", Buffer.alloc(1024 * 1024 + 1)) },
      );
      assert.equal(oversized.res.status, 413);
      assert.equal(
        (await readdir(dir)).length,
        1,
        "Rejected uploads must not leave files",
      );
    },
  );
  await t.test("message pagination is stable and chronological", async () => {
    for (let i = 0; i < 52; i++)
      await query(
        "INSERT INTO messages(conversation_id,sender_id,client_id,text) VALUES(?,?,?,?)",
        [conversation, alice.id, randomUUID(), `Page ${i}`],
      );
    const latest = await request(`/conversations/${conversation}/messages`, {
      user: bob,
    });
    assert.equal(latest.data.messages.length, 50);
    assert.equal(latest.data.hasMore, true);
    const older = await request(
      `/conversations/${conversation}/messages?before=${latest.data.messages[0].id}`,
      { user: bob },
    );
    assert.equal(older.data.messages.length, 4);
    assert.equal(older.data.hasMore, false);
    assert.ok(older.data.messages.at(-1).id < latest.data.messages[0].id);
  });
  await t.test(
    "video uploads support authorized byte-range playback",
    async () => {
      const sent = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        form: form("video", video, "clip.mp4", "video/mp4"),
      });
      assert.equal(sent.res.status, 201, JSON.stringify(sent.data));
      const url = base + sent.data.message.media.url;
      const range = await fetch(url, {
        headers: { Cookie: bob.cookie, Range: "bytes=0-99" },
      });
      assert.equal(range.status, 206);
      assert.match(range.headers.get("content-type"), /video\/mp4/);
      assert.equal((await range.arrayBuffer()).byteLength, 100);
      assert.equal(
        (
          await fetch(url, {
            headers: { Cookie: eve.cookie, Range: "bytes=0-99" },
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "same-origin polling works without an Origin header",
    async () => {
      const socket = connect(base, {
        transports: ["polling"],
        extraHeaders: { Cookie: bob.cookie, "Sec-Fetch-Site": "same-origin" },
        reconnection: false,
        timeout: 3000,
      });
      sockets.push(socket);
      await event(socket, "connect");
      assert.equal(socket.connected, true);
      socket.disconnect();
    },
  );
  await t.test(
    "ownership and origin checks protect edits and deletion",
    async () => {
      const route = `/conversations/${conversation}/messages/${message.id}`;
      for (const user of [bob, eve]) {
        assert.equal(
          (
            await request(route, {
              user,
              method: "PATCH",
              body: { text: "not mine", revision: 0 },
            })
          ).res.status,
          404,
        );
        assert.equal(
          (await request(route, { user, method: "DELETE" })).res.status,
          404,
        );
      }
      assert.equal(
        (
          await request(route, {
            method: "PATCH",
            body: { text: "anonymous", revision: 0 },
          })
        ).res.status,
        401,
      );
      assert.equal(
        (
          await request(route, {
            user: alice,
            method: "DELETE",
            origin: "https://evil.example",
          })
        ).res.status,
        403,
      );
    },
  );
  await t.test(
    "edits reach the recipient and reject stale versions",
    async () => {
      const route = `/conversations/${conversation}/messages/${message.id}`;
      const changed = event(bobSocket, "message:updated");
      const edit = await request(route, {
        user: alice,
        method: "PATCH",
        body: { text: "Corrected hello 👋", revision: 0 },
      });
      assert.equal(edit.res.status, 200, JSON.stringify(edit.data));
      assert.equal(edit.data.message.revision, 1);
      assert.ok(edit.data.message.editedAt);
      assert.equal((await changed).text, "Corrected hello 👋");
      assert.equal(
        (
          await request(route, {
            user: alice,
            method: "PATCH",
            body: { text: "stale", revision: 0 },
          })
        ).res.status,
        409,
      );
      assert.equal(
        (
          await request(route, {
            user: alice,
            method: "PATCH",
            body: { text: " ", revision: 1 },
          })
        ).res.status,
        400,
      );
      const caption = await request(
        `/conversations/${conversation}/messages/${media.id}`,
        { user: alice, method: "PATCH", body: { text: "", revision: 0 } },
      );
      assert.equal(caption.res.status, 200);
      assert.equal(caption.data.message.text, "");
      assert.ok(caption.data.message.media);
    },
  );
  await t.test(
    "search is literal, paginated, case-insensitive, and conversation-scoped",
    async () => {
      for (let i = 0; i < 34; i++)
        await query(
          "INSERT INTO messages(conversation_id,sender_id,client_id,text) VALUES(?,?,?,?)",
          [conversation, alice.id, randomUUID(), `TOKEN_% MixedCase ${i}`],
        );
      const first = await request(
        `/conversations/${conversation}/search?q=${encodeURIComponent("token_%")}`,
        { user: bob },
      );
      assert.equal(first.res.status, 200);
      assert.equal(first.data.messages.length, 30);
      assert.ok(first.data.nextBefore);
      const second = await request(
        `/conversations/${conversation}/search?q=${encodeURIComponent("token_%")}&before=${first.data.nextBefore}`,
        { user: bob },
      );
      assert.equal(second.data.messages.length, 4);
      assert.equal(second.data.nextBefore, null);
      assert.equal(
        new Set(
          [...first.data.messages, ...second.data.messages].map((m) => m.id),
        ).size,
        34,
      );
      const literal = await request(
        `/conversations/${conversation}/search?q=%25`,
        { user: bob },
      );
      assert.equal(literal.data.messages.length, 30);
      assert.equal(
        (
          await request(`/conversations/${conversation}/search?q=token`, {
            user: eve,
          })
        ).res.status,
        404,
      );
      assert.equal(
        (
          await request(`/conversations/${conversation}/search?q=`, {
            user: bob,
          })
        ).res.status,
        400,
      );
      const changed = await request(
        `/conversations/${conversation}/search?q=corrected`,
        { user: bob },
      );
      assert.equal(changed.data.messages[0].id, message.id);
    },
  );
  await t.test(
    "deletion is live, idempotent, removes unread counts, and cannot be resurrected",
    async () => {
      const body = {
        text: "Remove this unique message",
        clientId: randomUUID(),
      };
      const sent = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        body,
      });
      const mid = sent.data.message.id,
        route = `/conversations/${conversation}/messages/${mid}`;
      const list = await request("/conversations", { user: bob });
      const before = list.data.conversations.find(
        (c) => c.id === conversation,
      ).unread;
      const changed = event(bobSocket, "message:updated");
      const deleted = await request(route, { user: alice, method: "DELETE" });
      assert.equal(deleted.res.status, 200);
      assert.ok(deleted.data.message.deletedAt);
      assert.equal(deleted.data.message.text, "");
      assert.equal((await changed).id, mid);
      const again = await request(route, { user: alice, method: "DELETE" });
      assert.equal(again.data.message.revision, deleted.data.message.revision);
      const retry = await request(`/conversations/${conversation}/messages`, {
        user: alice,
        body,
      });
      assert.equal(retry.data.message.id, mid);
      assert.ok(retry.data.message.deletedAt);
      assert.equal(
        (
          await request(route, {
            user: alice,
            method: "PATCH",
            body: { text: "restore", revision: 1 },
          })
        ).res.status,
        409,
      );
      const updated = await request("/conversations", { user: bob });
      const c = updated.data.conversations.find((c) => c.id === conversation);
      assert.equal(c.unread, before - 1);
      assert.ok(c.lastMessage.deletedAt);
      const search = await request(
        `/conversations/${conversation}/search?q=Remove`,
        { user: bob },
      );
      assert.equal(search.data.messages.length, 0);
    },
  );
  await t.test(
    "deleting media revokes access and retries failed disk cleanup",
    async () => {
      const [stored] = await query(
        "SELECT media_path FROM messages WHERE id=?",
        [media.id],
      );
      const filePath = path.join(dir, stored.media_path);
      // Simulate a transient filesystem failure without weakening application authorization.
      await rm(filePath);
      await mkdir(filePath);
      const deleted = await request(
        `/conversations/${conversation}/messages/${media.id}`,
        { user: alice, method: "DELETE" },
      );
      assert.equal(deleted.res.status, 200);
      assert.equal(deleted.data.message.media, null);
      assert.equal(
        (await request(`/media/${media.id}`, { user: alice })).res.status,
        404,
      );
      assert.equal(
        (await request(`/media/${media.id}`, { user: bob })).res.status,
        404,
      );
      assert.equal(
        (
          await query("SELECT path FROM media_deletions WHERE path=?", [
            stored.media_path,
          ])
        ).length,
        1,
      );
      await rm(filePath, { recursive: true });
      const { drainMediaDeletions } = await import("../src/media-cleanup.js");
      await drainMediaDeletions();
      assert.equal(
        (
          await query("SELECT path FROM media_deletions WHERE path=?", [
            stored.media_path,
          ])
        ).length,
        0,
      );
      const [row] = await query(
        "SELECT text,media_path,media_size FROM messages WHERE id=?",
        [media.id],
      );
      assert.equal(row.media_path, null);
      assert.equal(row.media_size, null);
      assert.equal(row.text, "");
    },
  );
  await t.test(
    "logout revokes the cookie and closes its live sockets",
    async () => {
      const disconnected = event(aliceSocket, "disconnect");
      assert.equal(
        (await request("/auth/logout", { user: alice, body: {} })).res.status,
        204,
      );
      await disconnected;
      assert.equal(
        (await request("/auth/me", { user: alice })).res.status,
        401,
      );
    },
  );
  await t.test("expired sessions are refused", async () => {
    await query(
      "UPDATE sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE user_id=?",
      [eve.id],
    );
    assert.equal((await request("/auth/me", { user: eve })).res.status, 401);
  });
});

test("calls enforce membership and device ownership, relay signals, and persist history", async () => {
  const caller = await register("caller"),
    callee = await register("callee"),
    outsider = await register("outsider");
  const created = await request("/conversations", {
    user: caller,
    body: { userId: callee.id },
  });
  assert.equal(created.res.status, 201, JSON.stringify(created.data));
  const cid = created.data.conversation?.id || created.data.id;
  const a = await socketFor(caller),
    b = await socketFor(callee),
    b2 = await socketFor(callee),
    x = await socketFor(outsider);
  await Promise.all(
    [a, b, b2, x].map((s) =>
      s.connected ? Promise.resolve() : event(s, "connect"),
    ),
  );
  const send = (s, name, data) =>
    new Promise((resolve, reject) =>
      s.timeout(4000).emit(name, data, (e, r) => (e ? reject(e) : resolve(r))),
    );
  assert.equal((await request("/calls")).res.status, 401);
  assert.equal(
    (await request("/calls/config", { user: caller })).res.status,
    200,
  );
  assert.equal(
    (await send(x, "call:start", { conversationId: cid, kind: "video" })).ok,
    false,
  );
  const incoming = event(b, "call:incoming");
  const started = await send(a, "call:start", {
    conversationId: cid,
    kind: "video",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal((await incoming).callId, started.callId);
  const callId = started.callId;
  assert.equal((await send(a, "call:accept", { callId })).ok, false);
  assert.equal((await send(x, "call:end", { callId })).ok, false);
  assert.equal(
    (await send(b, "call:start", { conversationId: cid, kind: "voice" })).ok,
    false,
  );
  const accepted = event(a, "call:accepted");
  assert.equal((await send(b, "call:accept", { callId })).ok, true);
  await accepted;
  assert.equal((await send(b2, "call:accept", { callId })).ok, false);
  assert.equal((await send(b2, "call:end", { callId })).ok, false);
  assert.equal(
    (
      await send(x, "call:signal", {
        callId,
        signal: { type: "offer", sdp: "private" },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await send(b, "call:signal", {
        callId,
        signal: { type: "offer", sdp: "wrong-role" },
      })
    ).ok,
    false,
  );
  const signal = event(b, "call:signal");
  assert.equal(
    (
      await send(a, "call:signal", {
        callId,
        signal: { type: "offer", sdp: "test-offer" },
      })
    ).ok,
    true,
  );
  assert.equal((await signal).signal.sdp, "test-offer");
  const ended = event(a, "call:ended");
  assert.equal((await send(b, "call:end", { callId })).ok, true);
  assert.equal((await ended).status, "ended");
  const history = await request("/calls", { user: caller });
  assert.equal(history.data.calls[0].callId, callId);
  assert.equal(history.data.calls[0].status, "ended");
  assert.ok(history.data.calls[0].answeredAt);
  assert.ok(history.data.calls[0].endedAt);
  assert.equal(
    (await request("/calls", { user: outsider })).data.calls.length,
    0,
  );
  assert.equal(
    (
      await send(a, "call:signal", {
        callId,
        signal: { type: "offer", sdp: "stale" },
      })
    ).ok,
    false,
  );
});

test("groups restrict messages, media, search and management to current members", async () => {
  const owner = await register("groupowner"),
    first = await register("groupfirst"),
    second = await register("groupsecond"),
    outsider = await register("groupoutside");
  const created = await request("/groups", {
    user: owner,
    body: { name: "Friends", userIds: [first.id, second.id] },
  });
  assert.equal(created.res.status, 201, JSON.stringify(created.data));
  const cid = created.data.id;
  assert.equal(
    (
      await request("/groups", {
        user: owner,
        body: { name: "", userIds: [first.id, second.id] },
      })
    ).res.status,
    400,
  );
  assert.equal(
    (await request(`/groups/${cid}`, { user: outsider })).res.status,
    404,
  );
  assert.equal(
    (
      await request(`/groups/${cid}`, {
        user: first,
        method: "PATCH",
        body: { name: "Hijacked" },
      })
    ).res.status,
    403,
  );
  assert.equal(
    (
      await request(`/groups/${cid}/members/${owner.id}`, {
        user: owner,
        method: "DELETE",
      })
    ).res.status,
    400,
  );
  const s = await socketFor(first);
  if (!s.connected) await event(s, "connect");
  const delivery = event(s, "message:new");
  const sent = await request(`/conversations/${cid}/messages`, {
    user: owner,
    form: form("Group photo"),
  });
  assert.equal(sent.res.status, 201, JSON.stringify(sent.data));
  const mid = sent.data.message.id;
  assert.equal((await delivery).senderName, "groupowner");
  assert.equal(
    (await request(`/media/${mid}`, { user: first })).res.status,
    200,
  );
  assert.equal(
    (await request(`/media/${mid}`, { user: outsider })).res.status,
    404,
  );
  assert.equal(
    (await request(`/conversations/${cid}/search?q=photo`, { user: first }))
      .data.messages.length,
    1,
  );
  assert.equal(
    (await request(`/conversations/${cid}/messages`, { user: outsider })).res
      .status,
    404,
  );
  const listed = await request("/conversations", { user: first });
  const entry = listed.data.conversations.find((c) => c.id === cid);
  assert.equal(entry.isGroup, true);
  assert.equal(entry.memberCount, 3);
  assert.equal(entry.unread, 1);
  assert.equal(
    (
      await request(`/conversations/${cid}/read`, {
        user: first,
        body: { messageId: mid },
      })
    ).res.status,
    204,
  );
  assert.equal(
    (await request("/conversations", { user: first })).data.conversations.find(
      (c) => c.id === cid,
    ).unread,
    0,
  );
  assert.equal(
    (await request("/conversations", { user: second })).data.conversations.find(
      (c) => c.id === cid,
    ).unread,
    1,
  );
  assert.equal(
    (
      await request(`/groups/${cid}/members`, {
        user: owner,
        body: { userId: outsider.id },
      })
    ).res.status,
    204,
  );
  assert.equal(
    (await request(`/conversations/${cid}/messages`, { user: outsider })).data
      .messages[0].id,
    mid,
  );
  const removed = event(s, "conversation:removed");
  assert.equal(
    (
      await request(`/groups/${cid}/members/${first.id}`, {
        user: owner,
        method: "DELETE",
      })
    ).res.status,
    204,
  );
  assert.equal((await removed).conversationId, cid);
  for (const route of [
    `/conversations/${cid}/messages`,
    `/conversations/${cid}/search?q=photo`,
    `/media/${mid}`,
  ])
    assert.equal((await request(route, { user: first })).res.status, 404);
  assert.equal(
    (
      await request(`/conversations/${cid}/messages`, {
        user: first,
        form: form("Blocked"),
      })
    ).res.status,
    404,
  );
  assert.equal(
    (
      await request(`/conversations/${cid}/messages/${mid}`, {
        user: first,
        method: "PATCH",
        body: { text: "No", revision: 0 },
      })
    ).res.status,
    404,
  );
  assert.equal(
    (await request("/conversations", { user: first })).data.conversations.some(
      (c) => c.id === cid,
    ),
    false,
  );
  const call = await new Promise((resolve) =>
    s.emit("call:start", { conversationId: cid, kind: "voice" }, resolve),
  );
  assert.equal(call.ok, false);
  assert.equal(
    (
      await request(`/groups/${cid}`, {
        user: owner,
        method: "PATCH",
        body: { name: "Weekend friends", ownerId: second.id },
      })
    ).res.status,
    204,
  );
  assert.equal(
    (
      await request(`/groups/${cid}/members/${owner.id}`, {
        user: owner,
        method: "DELETE",
      })
    ).res.status,
    204,
  );
  assert.equal(
    (await request(`/groups/${cid}`, { user: second })).data.ownerId,
    second.id,
  );
  assert.equal(
    (await request(`/groups/${cid}`, { user: owner })).res.status,
    404,
  );
});

test("profile avatars, unique usernames and password session revocation", async () => {
  const person = await register("profile");
  const patch = (route, body) =>
    request(route, { user: person, method: "PATCH", body });
  assert.equal(
    (await patch("/profile/username", { username: bob.username.toUpperCase() }))
      .res.status,
    409,
  );
  assert.equal(
    (await patch("/profile/username", { username: "bad name" })).res.status,
    400,
  );
  const renamed = `renamed_${Date.now().toString().slice(-8)}`;
  const changed = await patch("/profile/username", {
    username: renamed.toUpperCase(),
  });
  assert.equal(changed.data.user.username, renamed);
  assert.equal(changed.data.user.id, person.id);
  assert.equal(
    (await patch("/profile/avatar", { preset: "fox" })).data.user.avatarPreset,
    "fox",
  );
  assert.equal(
    (await patch("/profile/avatar", { preset: "../bad" })).res.status,
    400,
  );
  const sharp = (await import("sharp")).default;
  const input = await sharp({
    create: { width: 600, height: 300, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("avatar", new Blob([input], { type: "image/png" }), "photo.png");
  const uploaded = await request("/profile/avatar", { user: person, form });
  assert.equal(uploaded.res.status, 200, JSON.stringify(uploaded.data));
  const url = uploaded.data.user.avatarUrl;
  assert.equal((await fetch(base + url)).status, 401);
  const response = await fetch(base + url, { headers: { Cookie: bob.cookie } });
  const meta = await sharp(
    Buffer.from(await response.arrayBuffer()),
  ).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.format, "webp");
  const fake = new FormData();
  fake.append(
    "avatar",
    new Blob(["<svg></svg>"], { type: "image/png" }),
    "fake.png",
  );
  assert.equal(
    (await request("/profile/avatar", { user: person, form: fake })).res.status,
    400,
  );
  const oversized = new FormData();
  oversized.append(
    "avatar",
    new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)]),
    "large.png",
  );
  assert.equal(
    (await request("/profile/avatar", { user: person, form: oversized })).res
      .status,
    413,
  );
  assert.equal(
    (await patch("/profile/avatar", { preset: "initials" })).data.user
      .avatarUrl,
    null,
  );
  assert.equal(
    (await fetch(base + url, { headers: { Cookie: bob.cookie } })).status,
    404,
  );
  const secondLogin = await request("/auth/login", {
    body: { username: renamed, password: "safe-password-123" },
  });
  const secondSession = {
    cookie: secondLogin.res.headers.get("set-cookie").split(";")[0],
  };
  assert.equal(
    (
      await request("/profile/password", {
        user: person,
        body: {
          currentPassword: "wrong",
          newPassword: "new-safe-password-123",
        },
      })
    ).res.status,
    400,
  );
  assert.equal((await request("/auth/me", { user: person })).res.status, 200);
  assert.equal(
    (
      await request("/profile/password", {
        user: person,
        body: {
          currentPassword: "safe-password-123",
          newPassword: "new-safe-password-123",
        },
      })
    ).res.status,
    204,
  );
  for (const user of [person, secondSession])
    assert.equal((await request("/auth/me", { user })).res.status, 401);
  assert.equal(
    (
      await request("/auth/login", {
        body: { username: renamed, password: "safe-password-123" },
      })
    ).res.status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", {
        body: { username: renamed, password: "new-safe-password-123" },
      })
    ).res.status,
    200,
  );
});

test("groups can start with one other member but cannot be empty", async () => {
  const created = await request("/groups", {
    user: eve,
    body: { name: "Small group", userIds: [bob.id] },
  });
  assert.equal(created.res.status, 201, JSON.stringify(created.data));
  const details = await request(`/groups/${created.data.id}`, { user: bob });
  assert.equal(details.data.members.length, 2);
  assert.equal(
    (
      await request("/groups", {
        user: eve,
        body: { name: "Empty", userIds: [eve.id] },
      })
    ).res.status,
    400,
  );
});
