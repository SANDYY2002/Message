import { createCalls } from "./calls.js";
import { authenticate } from "./auth.js";
import { query } from "./db.js";
import { id } from "./validation.js";
import { member, emitConversation } from "./chat.js";
export function setupRealtime(io) {
  const online = new Map();
  const calls = createCalls(io);
  io.endBlockedCalls = (a, b) => calls.block(a, b);
  io.use(async (socket, next) => {
    try {
      socket.data.auth = await authenticate(socket.handshake.headers);
      next();
    } catch {
      next(new Error("Please sign in again."));
    }
  });
  io.on("connection", (socket) => {
    const { user, hash, expires } = socket.data.auth;
    socket.join(`user:${user.id}`);
    socket.join(`session:${hash}`);
    online.set(user.id, (online.get(user.id) || 0) + 1);
    socket.emit("presence:snapshot", [...online.keys()]);
    if (online.get(user.id) === 1)
      io.emit("presence:changed", { userId: user.id, online: true });
    // Revalidate every inbound event, and close idle sockets when the session expires.
    socket.use(async (_event, next) => {
      try {
        await authenticate(socket.handshake.headers);
        next();
      } catch {
        socket.disconnect(true);
      }
    });
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(0, new Date(expires) - Date.now()), 2147483647),
    );
    calls.attach(socket);
    let lastTyping = 0;
    socket.on("typing", async (data) => {
      if (Date.now() - lastTyping < 500) return;
      lastTyping = Date.now();
      try {
        const cid = id(data?.conversationId),
          c = await member(cid, user.id);
        if (c.kind !== "group" && c.request_status !== "accepted") return;
        await emitConversation(io, c, "typing", {
          conversationId: cid,
          userId: user.id,
        });
      } catch {
        /* Invalid typing events never enter another conversation. */
      }
    });
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      const count = (online.get(user.id) || 1) - 1;
      if (count > 0) online.set(user.id, count);
      else {
        online.delete(user.id);
        io.emit("presence:changed", { userId: user.id, online: false });
      }
    });
  });
  const cleanup = setInterval(
    () =>
      query("DELETE FROM sessions WHERE expires_at<=UTC_TIMESTAMP(3)").catch(
        (e) => console.error("Session cleanup failed:", e.code),
      ),
    3600000,
  );
  cleanup.unref();
  return async () => {
    clearInterval(cleanup);
    await calls.close();
  };
}
