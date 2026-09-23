import { allowInteraction, visibleTo } from "./relationships.js";
import { query } from "./db.js";
import { HttpError } from "./validation.js";
export async function member(conversationId, userId, q = query, lock = false) {
  const [c] = await q(
    `SELECT * FROM conversations WHERE id=?${lock ? " FOR UPDATE" : ""}`,
    [conversationId],
  );
  if (!c) throw new HttpError(404, "Conversation not found.");
  if (c.kind === "group") {
    const [membership] = await q(
      "SELECT read_id FROM group_members WHERE conversation_id=? AND user_id=?",
      [conversationId, userId],
    );
    if (!membership) throw new HttpError(404, "Conversation not found.");
    c.read_id = membership.read_id;
  } else if (c.user_low !== userId && c.user_high !== userId)
    throw new HttpError(404, "Conversation not found.");
  if (c.kind !== "group") {
    await allowInteraction(userId, otherUser(c, userId), q);
    if (c.request_status === "declined")
      throw new HttpError(403, "This message request is closed.");
  }
  return c;
}
export const otherUser = (c, userId) =>
  c.user_low === userId ? c.user_high : c.user_low;
export async function emitConversation(io, c, event, data) {
  const users =
    c.kind === "group"
      ? (
          await query(
            "SELECT user_id FROM group_members WHERE conversation_id=?",
            [c.id],
          )
        ).map((r) => r.user_id)
      : [c.user_low, c.user_high];
  const actor = data?.senderId || data?.userId;
  const eligible = [];
  for (const uid of users) {
    try {
      if (actor) await allowInteraction(uid, actor);
      if (c.kind !== "group") await allowInteraction(c.user_low, c.user_high);
      eligible.push(uid);
    } catch {
      /* Blocked users never receive each other's message events. */
    }
  }
  if (eligible.length)
    io.to(eligible.map((uid) => `user:${uid}`)).emit(event, data);
}
