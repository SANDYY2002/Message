import { query, transaction } from "./db.js";
import { member, emitConversation } from "./chat.js";
import { id, HttpError } from "./validation.js";
function groupName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 60)
    throw new HttpError(400, "Group name must be 1–60 characters.");
  return value.trim();
}
async function group(cid, uid, q = query, lock = false) {
  const c = await member(cid, uid, q, lock);
  if (c.kind !== "group") throw new HttpError(404, "Group not found.");
  return c;
}
function owner(c, uid) {
  if (c.owner_id !== uid)
    throw new HttpError(403, "Only the group owner can do this.");
}
export function mountGroups(app, io, limiter) {
  const limit = limiter(30, 60000, (req) => String(req.auth.user.id));
  app.post("/api/groups", limit, async (req, res) => {
    const name = groupName(req.body?.name),
      uid = req.auth.user.id;
    if (!Array.isArray(req.body?.userIds) || req.body.userIds.length > 49)
      throw new HttpError(400, "Choose 2–49 other people.");
    const users = [...new Set(req.body.userIds.map(id))].filter(
      (x) => x !== uid,
    );
    if (users.length < 2)
      throw new HttpError(400, "Choose at least two other people.");
    const c = await transaction(async (q) => {
      const rows = await q(
        `SELECT id FROM users WHERE id IN (${users.map(() => "?").join(",")})`,
        users,
      );
      if (rows.length !== users.length)
        throw new HttpError(400, "One or more people no longer exist.");
      const r = await q(
        "INSERT INTO conversations(kind,name,owner_id,user_low,user_high) VALUES('group',?,?,NULL,NULL)",
        [name, uid],
      );
      for (const user of [uid, ...users])
        await q(
          "INSERT INTO group_members(conversation_id,user_id) VALUES(?,?)",
          [r.insertId, user],
        );
      return { id: r.insertId, kind: "group" };
    });
    await emitConversation(io, c, "conversation:changed", {
      conversationId: c.id,
    });
    res.status(201).json({ id: c.id });
  });
  app.get("/api/groups/:id", async (req, res) => {
    const c = await group(id(req.params.id), req.auth.user.id);
    const members = await query(
      "SELECT u.id,u.username,u.display_name AS displayName FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.conversation_id=? ORDER BY u.display_name,u.id",
      [c.id],
    );
    res.json({ id: c.id, name: c.name, ownerId: c.owner_id, members });
  });
  app.patch("/api/groups/:id", limit, async (req, res) => {
    const cid = id(req.params.id),
      uid = req.auth.user.id;
    const c = await transaction(async (q) => {
      const c = await group(cid, uid, q, true);
      owner(c, uid);
      if (req.body.name !== undefined)
        await q("UPDATE conversations SET name=? WHERE id=?", [
          groupName(req.body.name),
          cid,
        ]);
      if (req.body.ownerId !== undefined) {
        const next = id(req.body.ownerId);
        if (
          !(
            await q(
              "SELECT user_id FROM group_members WHERE conversation_id=? AND user_id=?",
              [cid, next],
            )
          ).length
        )
          throw new HttpError(400, "Choose an existing member as owner.");
        await q("UPDATE conversations SET owner_id=? WHERE id=?", [next, cid]);
      }
      return c;
    });
    await emitConversation(io, c, "conversation:changed", {
      conversationId: cid,
    });
    res.sendStatus(204);
  });
  app.post("/api/groups/:id/members", limit, async (req, res) => {
    const cid = id(req.params.id),
      uid = req.auth.user.id,
      next = id(req.body?.userId);
    const c = await transaction(async (q) => {
      const c = await group(cid, uid, q, true);
      owner(c, uid);
      if (
        (
          await q(
            "SELECT user_id FROM group_members WHERE conversation_id=? AND user_id=?",
            [cid, next],
          )
        ).length
      )
        return c;
      const [count] = await q(
        "SELECT COUNT(*) AS n FROM group_members WHERE conversation_id=?",
        [cid],
      );
      if (count.n >= 50)
        throw new HttpError(400, "Groups can have at most 50 members.");
      if (!(await q("SELECT id FROM users WHERE id=?", [next])).length)
        throw new HttpError(404, "User not found.");
      await q(
        "INSERT INTO group_members(conversation_id,user_id) VALUES(?,?)",
        [cid, next],
      );
      return c;
    });
    await emitConversation(io, c, "conversation:changed", {
      conversationId: cid,
    });
    res.sendStatus(204);
  });
  app.delete("/api/groups/:id/members/:userId", limit, async (req, res) => {
    const cid = id(req.params.id),
      uid = req.auth.user.id,
      target = id(req.params.userId);
    const c = await transaction(async (q) => {
      const c = await group(cid, uid, q, true);
      if (target !== uid) owner(c, uid);
      if (target === c.owner_id)
        throw new HttpError(
          400,
          "Transfer ownership to another member before leaving.",
        );
      await q(
        "DELETE FROM group_members WHERE conversation_id=? AND user_id=?",
        [cid, target],
      );
      return c;
    });
    io.to(`user:${target}`).emit("conversation:removed", {
      conversationId: cid,
    });
    await emitConversation(io, c, "conversation:changed", {
      conversationId: cid,
    });
    res.sendStatus(204);
  });
}
