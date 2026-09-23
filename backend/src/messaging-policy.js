import { query, transaction } from "./db.js";
import { id, HttpError } from "./validation.js";
import { allowInteraction, lockUsers } from "./relationships.js";
import { member, emitConversation } from "./chat.js";
import { publicUser } from "./users.js";
export function mountMessagingPolicy(app, io, limiter) {
  const limit = limiter(60, 60_000, (req) => String(req.auth.user.id));
  app.get("/api/blocks", async (req, res) => {
    const rows = await query(
      "SELECT u.* FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC",
      [req.auth.user.id],
    );
    res.json({ users: rows.map(publicUser) });
  });
  app.put("/api/blocks/:id", limit, async (req, res) => {
    const uid = req.auth.user.id,
      peer = id(req.params.id);
    if (uid === peer) throw new HttpError(400, "You cannot block yourself.");
    const conversations = await transaction(async (q) => {
      await lockUsers(q, [uid, peer]);
      await q(
        "INSERT IGNORE INTO user_blocks(blocker_id,blocked_id) VALUES(?,?)",
        [uid, peer],
      );
      await q(
        "DELETE FROM follows WHERE (follower_id=? AND followed_id=?) OR (follower_id=? AND followed_id=?)",
        [uid, peer, peer, uid],
      );
      await q(
        "DELETE FROM activities WHERE (recipient_id=? AND actor_id=?) OR (recipient_id=? AND actor_id=?)",
        [uid, peer, peer, uid],
      );
      const rows = await q(
        "SELECT id FROM conversations WHERE user_low=? AND user_high=? FOR UPDATE",
        [Math.min(uid, peer), Math.max(uid, peer)],
      );
      await q(
        "UPDATE conversations SET request_status='declined' WHERE user_low=? AND user_high=?",
        [Math.min(uid, peer), Math.max(uid, peer)],
      );
      return rows;
    });
    await io.endBlockedCalls?.(uid, peer);
    for (const c of conversations)
      io.to([`user:${uid}`, `user:${peer}`]).emit("conversation:removed", {
        conversationId: c.id,
      });
    io.to([`user:${uid}`, `user:${peer}`]).emit("relationships:changed");
    res.sendStatus(204);
  });
  app.delete("/api/blocks/:id", limit, async (req, res) => {
    const uid = req.auth.user.id,
      peer = id(req.params.id);
    await transaction(async (q) => {
      await lockUsers(q, [uid, peer]);
      await q("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?", [
        uid,
        peer,
      ]);
    });
    io.to([`user:${uid}`, `user:${peer}`]).emit("relationships:changed");
    res.sendStatus(204);
  });
  for (const action of ["accept", "decline"])
    app.post(`/api/conversations/:id/${action}`, limit, async (req, res) => {
      const uid = req.auth.user.id,
        cid = id(req.params.id);
      const c = await transaction(async (q) => {
        const c = await member(cid, uid, q, true);
        if (c.kind === "group" || c.request_sender === uid)
          throw new HttpError(
            403,
            "Only the recipient can review this request.",
          );
        if (c.request_status === "accepted") return c;
        if (c.request_status !== "pending")
          throw new HttpError(409, "This request is no longer pending.");
        await q("UPDATE conversations SET request_status=? WHERE id=?", [
          action === "accept" ? "accepted" : "declined",
          cid,
        ]);
        return c;
      });
      await emitConversation(io, c, "conversation:changed", {
        conversationId: cid,
      });
      res.sendStatus(204);
    });
}
export async function prepareSend(c, uid, q) {
  if (c.kind === "group") return;
  if (c.request_status === "declined")
    throw new HttpError(403, "This message request is closed.");
  if (c.request_status === "pending") {
    if (c.request_sender === uid) {
      if (
        (
          await q("SELECT id FROM messages WHERE conversation_id=? LIMIT 1", [
            c.id,
          ])
        ).length
      )
        throw new HttpError(
          403,
          "Wait until your message request is accepted.",
        );
    } else
      await q("UPDATE conversations SET request_status='accepted' WHERE id=?", [
        c.id,
      ]);
  }
}
