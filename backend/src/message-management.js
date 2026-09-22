import { transaction, query } from "./db.js";
import { member, emitConversation } from "./chat.js";
import { HttpError, id, publicMessage, editInput } from "./validation.js";
import { drainMediaDeletions } from "./media-cleanup.js";

export function mountMessageManagement(app, io, limiter) {
  app.get("/api/conversations/:id/search", async (req, res) => {
    const cid = id(req.params.id);
    await member(cid, req.auth.user.id);
    if (
      typeof req.query.q !== "string" ||
      !req.query.q.trim() ||
      req.query.q.trim().length > 120
    )
      throw new HttpError(400, "Search must be 1–120 characters.");
    const term = req.query.q.trim().toLowerCase();
    const before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      "SELECT m.*,u.display_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.deleted_at IS NULL AND m.id<? AND LOCATE(?,LOWER(m.text))>0 ORDER BY m.id DESC LIMIT 31",
      [cid, before, term],
    );
    const matches = rows.slice(0, 30);
    res.json({
      messages: matches.map(publicMessage),
      nextBefore: rows.length > 30 ? matches.at(-1).id : null,
    });
  });
  const writeLimit = limiter(60, 60_000, (req) => String(req.auth.user.id));
  async function owned(req, q) {
    const uid = req.auth.user.id,
      cid = id(req.params.id),
      mid = id(req.params.messageId);
    // Keep lock order consistent with sends so deletion and quota checks cannot race.
    await q("SELECT id FROM users WHERE id=? FOR UPDATE", [uid]);
    const conversation = await member(cid, uid, q, true);
    const [message] = await q(
      "SELECT * FROM messages WHERE id=? AND conversation_id=? AND sender_id=? FOR UPDATE",
      [mid, cid, uid],
    );
    if (!message) throw new HttpError(404, "Message not found.");
    return { conversation, message };
  }
  app.patch(
    "/api/conversations/:id/messages/:messageId",
    writeLimit,
    async (req, res) => {
      const input = editInput(req.body);
      const result = await transaction(async (q) => {
        const { conversation, message } = await owned(req, q);
        if (message.deleted_at)
          throw new HttpError(409, "This message has been deleted.");
        if (input.revision !== message.revision)
          throw new HttpError(
            409,
            "This message changed in another window. Close the editor and try again.",
          );
        if (!input.text && !message.media_path)
          throw new HttpError(400, "A text message cannot be empty.");
        if (input.text !== message.text) {
          await q(
            "UPDATE messages SET text=?,edited_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE id=?",
            [input.text, message.id],
          );
        }
        const [updated] = await q("SELECT * FROM messages WHERE id=?", [
          message.id,
        ]);
        return { conversation, message: updated };
      });
      const message = publicMessage({
        ...result.message,
        sender_name: req.auth.user.displayName,
      });
      await emitConversation(
        io,
        result.conversation,
        "message:updated",
        message,
      );
      res.json({ message });
    },
  );
  app.delete(
    "/api/conversations/:id/messages/:messageId",
    writeLimit,
    async (req, res) => {
      const result = await transaction(async (q) => {
        const { conversation, message } = await owned(req, q);
        if (message.deleted_at) return { conversation, message };
        // Persist a retryable file deletion before clearing its database reference.
        if (message.media_path)
          await q("INSERT IGNORE INTO media_deletions(path) VALUES(?)", [
            message.media_path,
          ]);
        await q(
          "UPDATE messages SET text='',media_path=NULL,media_name=NULL,media_mime=NULL,media_size=NULL,deleted_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE id=?",
          [message.id],
        );
        const [deleted] = await q("SELECT * FROM messages WHERE id=?", [
          message.id,
        ]);
        return { conversation, message: deleted };
      });
      const message = publicMessage({
        ...result.message,
        sender_name: req.auth.user.displayName,
      });
      await emitConversation(
        io,
        result.conversation,
        "message:updated",
        message,
      );
      await drainMediaDeletions();
      res.json({ message });
    },
  );
}
