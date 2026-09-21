import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCalls } from "../src/calls.js";
function fixture(t, options = {}) {
  const events = [],
    writes = [],
    rooms = new Map();
  const io = {
    sockets: { adapter: { rooms } },
    to(room) {
      const targets = [room];
      return {
        to(next) {
          targets.push(next);
          return this;
        },
        emit(name, data) {
          events.push({ targets: [...targets], name, data });
        },
      };
    },
  };
  const calls = createCalls(io, {
    db: async (sql, args) => {
      writes.push({ sql, args });
      return [];
    },
    membership: async (cid, uid) => {
      if (cid !== 1 || ![1, 2].includes(uid))
        throw new Error("Conversation not found.");
      return { user_low: 1, user_high: 2 };
    },
    ...options,
  });
  t.after(() => calls.close());
  function socket(uid, sid = `s${uid}`) {
    const s = new EventEmitter();
    s.id = sid;
    s.connected = true;
    s.data = { auth: { user: { id: uid, displayName: `User ${uid}` } } };
    const room = `user:${uid}`;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(sid);
    calls.attach(s);
    s.send = (name, data) =>
      new Promise((resolve) => s.emit(name, data, resolve));
    s.disconnect = () => {
      s.connected = false;
      rooms.get(room).delete(sid);
      s.emit("disconnect");
    };
    return s;
  }
  return { socket, events, writes, calls };
}
test("offline calls are recorded as missed without holding the caller busy", async (t) => {
  const f = fixture(t),
    a = f.socket(1);
  const result = await a.send("call:start", {
    conversationId: 1,
    kind: "voice",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /offline/);
  assert.equal(f.writes[0].args[5], "missed");
  assert.equal(
    f.events.some((e) => e.name === "call:incoming"),
    false,
  );
});
test("declining a call releases both participants and prevents stale signaling", async (t) => {
  const f = fixture(t),
    a = f.socket(1),
    b = f.socket(2);
  const { callId } = await a.send("call:start", {
    conversationId: 1,
    kind: "voice",
  });
  assert.equal((await b.send("call:end", { callId })).ok, true);
  assert.equal(
    f.events.find((e) => e.name === "call:ended").data.status,
    "declined",
  );
  assert.equal(
    (
      await a.send("call:signal", {
        callId,
        signal: { type: "offer", sdp: "stale" },
      })
    ).ok,
    false,
  );
  assert.equal(
    (await b.send("call:start", { conversationId: 1, kind: "video" })).ok,
    true,
  );
});
test("only the answering tab owns a call and disconnect ends it", async (t) => {
  const f = fixture(t),
    a = f.socket(1),
    b = f.socket(2),
    other = f.socket(2, "other-tab");
  const { callId } = await a.send("call:start", {
    conversationId: 1,
    kind: "voice",
  });
  assert.equal((await b.send("call:accept", { callId })).ok, true);
  assert.equal((await other.send("call:end", { callId })).ok, false);
  b.disconnect();
  // This event is serialized after disconnect handling.
  assert.equal((await a.send("call:end", { callId })).ok, false);
  assert.equal(
    f.events.find((e) => e.name === "call:ended").data.status,
    "disconnected",
  );
});
test("unanswered calls time out as missed", async (t) => {
  const f = fixture(t, { ringMs: 1 }),
    a = f.socket(1);
  f.socket(2);
  await a.send("call:start", { conversationId: 1, kind: "voice" });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(
    f.events.find((e) => e.name === "call:ended").data.status,
    "missed",
  );
});
test("concurrent invitations cannot put a participant in two calls", async (t) => {
  const f = fixture(t),
    a = f.socket(1),
    b = f.socket(2);
  const results = await Promise.all(
    [a, b].map((s) =>
      s.send("call:start", { conversationId: 1, kind: "video" }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
});
