import { query } from "./db.js";
import { HttpError } from "./validation.js";
export async function member(conversationId, userId, q = query, lock = false) {
  const [c] = await q(
    `SELECT * FROM conversations WHERE id=? AND (user_low=? OR user_high=?)${lock ? " FOR UPDATE" : ""}`,
    [conversationId, userId, userId],
  );
  if (!c) throw new HttpError(404, "Conversation not found.");
  return c;
}
export const otherUser = (c, userId) =>
  c.user_low === userId ? c.user_high : c.user_low;
export const emitConversation = (io, c, event, data) =>
  io.to(`user:${c.user_low}`).to(`user:${c.user_high}`).emit(event, data);
