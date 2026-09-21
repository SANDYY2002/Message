import { randomUUID, createHmac } from "node:crypto";
import { query } from "./db.js";
import { member, otherUser } from "./chat.js";
import { id } from "./validation.js";
import { requireAuth } from "./auth.js";

export function mountCalls(app) {
  app.get("/api/calls/config", requireAuth, (req, res) => {
    const iceServers = [];
    if (process.env.STUN_URL) iceServers.push({ urls: process.env.STUN_URL });
    if (process.env.TURN_URLS && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 14400}:${req.auth.user.id}`;
      iceServers.push({
        urls: process.env.TURN_URLS.split(",").map((s) => s.trim()),
        username,
        credential: createHmac("sha1", process.env.TURN_SECRET)
          .update(username)
          .digest("base64"),
      });
    }
    res.json({ iceServers });
  });
  app.get("/api/calls", requireAuth, async (req, res) => {
    const before = req.query.before ? id(req.query.before) : 4294967295;
    const calls = await query(
      `SELECT c.id,c.call_key AS callId,c.conversation_id AS conversationId,
       c.caller_id AS callerId,c.callee_id AS calleeId,c.kind,c.status,
       c.created_at AS createdAt,c.answered_at AS answeredAt,c.ended_at AS endedAt,
       u.display_name AS peerName FROM calls c JOIN users u
       ON u.id=IF(c.caller_id=?,c.callee_id,c.caller_id)
       WHERE (c.caller_id=? OR c.callee_id=?) AND c.id<? ORDER BY c.id DESC LIMIT 31`,
      [req.auth.user.id, req.auth.user.id, req.auth.user.id, before],
    );
    res.json({ calls: calls.slice(0, 30), hasMore: calls.length > 30 });
  });
}

// One signaling process owns active calls. Deploy one Node instance until shared coordination is added.
export function createCalls(
  io,
  { db = query, membership = member, ringMs = 30000 } = {},
) {
  const active = new Map(),
    busy = new Map(),
    attempts = new Map();
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const notify = (c, event, value) =>
    io.to(`user:${c.callerId}`).to(`user:${c.calleeId}`).emit(event, value);
  async function finish(c, status) {
    if (!active.has(c.callId)) return;
    active.delete(c.callId);
    busy.delete(c.callerId);
    busy.delete(c.calleeId);
    notify(c, "call:ended", { callId: c.callId, status });
    try {
      await db(
        "UPDATE calls SET status=?,ended_at=UTC_TIMESTAMP(3) WHERE call_key=?",
        [status, c.callId],
      );
    } catch (e) {
      console.error("Call history update failed:", e.code || e.message);
    }
    notify(c, "call:history", {});
  }
  const timer = setInterval(() => {
    serial(async () => {
      const now = Date.now();
      for (const c of active.values()) {
        if (now > c.deadline)
          await finish(c, c.status === "ringing" ? "missed" : "ended");
      }
      for (const [user, at] of attempts)
        if (now - at > 60000) attempts.delete(user);
    }).catch(console.error);
  }, 1000);
  timer.unref();
  function attach(socket) {
    const user = socket.data.auth.user;
    let signalCount = 0,
      signalWindow = 0;
    function on(event, fn) {
      socket.on(event, (data, ack) => {
        if (typeof ack !== "function") return;
        serial(async () => {
          if (!socket.connected) throw new Error("Connection lost.");
          return fn(data || {});
        }).then(
          (value) => ack({ ok: true, ...value }),
          (e) => {
            ack({
              ok: false,
              error:
                e.status || !e.code
                  ? e.message
                  : "Call service is unavailable. Try again.",
            });
          },
        );
      });
    }
    function owned(data, calleeMayRing = false) {
      const c = active.get(data.callId);
      if (
        !c ||
        (socket.id !== c.callerSocket &&
          socket.id !== c.calleeSocket &&
          !(calleeMayRing && user.id === c.calleeId && c.status === "ringing"))
      )
        throw new Error("Call is no longer available on this device.");
      return c;
    }
    on("call:start", async (data) => {
      if (!["voice", "video"].includes(data.kind))
        throw new Error("Invalid call type.");
      if (Date.now() - (attempts.get(user.id) || 0) < 5000)
        throw new Error("Wait a few seconds before calling again.");
      attempts.set(user.id, Date.now());
      const conversationId = id(data.conversationId);
      const conversation = await membership(conversationId, user.id);
      const peer = otherUser(conversation, user.id);
      if (busy.has(user.id) || busy.has(peer))
        throw new Error("You or this person is already in a call.");
      if (!socket.connected) throw new Error("Connection lost.");
      const online = io.sockets.adapter.rooms.get(`user:${peer}`)?.size > 0;
      const c = {
        callId: randomUUID(),
        conversationId,
        callerId: user.id,
        calleeId: peer,
        kind: data.kind,
        callerName: user.displayName,
        callerSocket: socket.id,
        calleeSocket: null,
        status: "ringing",
        deadline: Date.now() + ringMs,
      };
      await db(
        "INSERT INTO calls(call_key,conversation_id,caller_id,callee_id,kind,status,ended_at) VALUES(?,?,?,?,?,?,?)",
        [
          c.callId,
          conversationId,
          user.id,
          peer,
          c.kind,
          online ? "ringing" : "missed",
          online ? null : new Date(),
        ],
      );
      notify(c, "call:history", {});
      if (!online)
        throw new Error("This person is offline. A missed call was saved.");
      active.set(c.callId, c);
      busy.set(user.id, c.callId);
      busy.set(peer, c.callId);
      if (!socket.connected) {
        await finish(c, "cancelled");
        throw new Error("Connection lost.");
      }
      io.to(`user:${peer}`).emit("call:incoming", {
        callId: c.callId,
        conversationId,
        callerId: user.id,
        callerName: user.displayName,
        kind: c.kind,
      });
      return { callId: c.callId };
    });
    on("call:accept", async (data) => {
      const c = owned(data, true);
      if (user.id !== c.calleeId || c.status !== "ringing")
        throw new Error("Call is no longer ringing.");
      c.calleeSocket = socket.id;
      c.status = "active";
      c.deadline = Date.now() + 4 * 3600000;
      try {
        await db(
          "UPDATE calls SET status='active',answered_at=UTC_TIMESTAMP(3) WHERE call_key=?",
          [c.callId],
        );
      } catch (e) {
        await finish(c, "failed");
        throw e;
      }
      if (!socket.connected) {
        await finish(c, "disconnected");
        throw new Error("Connection lost.");
      }
      io.to(`user:${c.calleeId}`).emit("call:claimed", {
        callId: c.callId,
        socketId: socket.id,
      });
      io.to(c.callerSocket).emit("call:accepted", { callId: c.callId });
      return {};
    });
    on("call:end", async (data) => {
      const c = owned(data, true);
      await finish(
        c,
        c.status === "ringing"
          ? user.id === c.calleeId
            ? "declined"
            : "cancelled"
          : "ended",
      );
      return {};
    });
    on("call:signal", (data) => {
      const c = owned(data);
      if (c.status !== "active") throw new Error("Call has not been accepted.");
      if (Date.now() - signalWindow > 10000) {
        signalCount = 0;
        signalWindow = Date.now();
      }
      if (++signalCount > 150) throw new Error("Too many call signals.");
      const signal = data.signal;
      if (!signal || JSON.stringify(signal).length > 12000)
        throw new Error("Invalid call signal.");
      if (signal.type === "offer" || signal.type === "answer") {
        if (
          typeof signal.sdp !== "string" ||
          (signal.type === "offer") !== (user.id === c.callerId)
        )
          throw new Error("Invalid call description.");
      } else if (signal.type === "candidate") {
        if (
          !signal.candidate ||
          typeof signal.candidate.candidate !== "string" ||
          signal.candidate.candidate.length > 2048
        )
          throw new Error("Invalid ICE candidate.");
      } else throw new Error("Invalid call signal.");
      io.to(
        socket.id === c.callerSocket ? c.calleeSocket : c.callerSocket,
      ).emit("call:signal", { callId: c.callId, signal });
      return {};
    });
    socket.on("disconnect", () => {
      serial(async () => {
        const c = active.get(busy.get(user.id));
        if (
          c &&
          (socket.id === c.callerSocket ||
            socket.id === c.calleeSocket ||
            (user.id === c.calleeId &&
              !io.sockets.adapter.rooms.get(`user:${user.id}`)?.size))
        )
          await finish(c, "disconnected");
      }).catch(console.error);
    });
  }
  return {
    attach,
    async close() {
      clearInterval(timer);
      await serial(async () => {
        for (const c of active.values()) await finish(c, "disconnected");
      });
    },
  };
}
