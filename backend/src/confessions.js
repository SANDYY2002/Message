import multer from "multer";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { query, transaction } from "./db.js";
import { config } from "./config.js";
import { id, HttpError } from "./validation.js";
import { visibleTo, lockUsers } from "./relationships.js";
import { publicUser } from "./users.js";
import { needsReview } from "./moderation.js";
export function content(value, max = 4000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max)
    throw new HttpError(400, `Enter 1–${max} characters.`);
  return text;
}
export async function confession(pid, uid, q = query) {
  const [p] = await q(
    `SELECT p.* FROM confession_posts p WHERE p.id=? AND (p.status='published' OR p.author_id=?) AND ${visibleTo(uid, "p.author_id")}`,
    [pid, uid],
  );
  if (!p) throw new HttpError(404, "Confession not found.");
  return p;
}
export async function storageUsed(q, uid) {
  const [r] = await q(
    "SELECT (SELECT COALESCE(SUM(media_size),0) FROM messages WHERE sender_id=?)+(SELECT COALESCE(SUM(media_size),0) FROM confession_posts WHERE author_id=?) AS bytes",
    [uid, uid],
  );
  return Number(r.bytes);
}
function serialize(p, uid) {
  return {
    id: p.id,
    text: p.text,
    status: p.status,
    isOwner: p.author_id === uid,
    createdAt: p.created_at,
    likes: Number(p.likes || 0),
    liked: !!p.liked,
    comments: Number(p.comments || 0),
    media: p.media_path
      ? { url: `/api/confessions/${p.id}/media`, mime: p.media_mime }
      : null,
  };
}
export function mountConfessions(app, limiter) {
  const limit = limiter(40, 60000, (r) => String(r.auth.user.id));
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_r, _f, cb) => cb(null, randomUUID()),
    }),
    limits: {
      fileSize: config.maxBytes,
      files: 1,
      fields: 2,
      fieldSize: 20000,
      parts: 3,
    },
  }).single("file");
  app.get("/api/confessions", async (req, res) => {
    const uid = req.auth.user.id,
      before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      `SELECT p.*,(SELECT COUNT(*) FROM confession_likes l WHERE l.post_id=p.id) likes,(SELECT COUNT(*) FROM confession_likes l WHERE l.post_id=p.id AND l.user_id=?) liked,(SELECT COUNT(*) FROM confession_comments c WHERE c.post_id=p.id AND c.status='published' AND ${visibleTo(uid, "c.author_id")}) comments FROM confession_posts p WHERE p.id<? AND (p.status='published' OR p.author_id=?) AND ${visibleTo(uid, "p.author_id")} ORDER BY p.id DESC LIMIT 21`,
      [uid, before, uid],
    );
    res.json({
      posts: rows.slice(0, 20).map((p) => serialize(p, uid)),
      hasMore: rows.length > 20,
    });
  });
  app.post("/api/confessions", limit, upload, async (req, res) => {
    let keep = false;
    try {
      const text =
        typeof req.body.text === "string" ? req.body.text.trim() : "";
      if (text.length > 4000 || (!text && !req.file))
        throw new HttpError(
          400,
          "Add text or a photo/video (up to 4,000 characters).",
        );
      const type = req.file ? await fileTypeFromFile(req.file.path) : null;
      if (
        req.file &&
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/webm",
        ].includes(type?.mime)
      )
        throw new HttpError(400, "Choose JPG, PNG, WebP, GIF, MP4 or WebM.");
      if (
        req.file &&
        type.mime.startsWith("image/") &&
        type.mime !== "image/gif"
      ) {
        let clean;
        try {
          clean = await sharp(req.file.path, { limitInputPixels: 40000000 })
            .rotate()
            .toBuffer();
        } catch {
          throw new HttpError(
            400,
            "This image could not be processed. Choose a smaller, valid image.",
          );
        }
        if (clean.length > config.maxBytes)
          throw new HttpError(413, "Image is too large after processing.");
        await writeFile(req.file.path, clean);
        req.file.size = clean.length;
      }
      const uid = req.auth.user.id;
      const pid = await transaction(async (q) => {
        await lockUsers(q, [uid]);
        if (
          req.file &&
          (await storageUsed(q, uid)) + req.file.size > config.storageBytes
        )
          throw new HttpError(413, "Your media storage allowance is full.");
        const r = await q(
          "INSERT INTO confession_posts(author_id,text,status,media_path,media_mime,media_size) VALUES(?,?,?,?,?,?)",
          [
            uid,
            text,
            needsReview(text) ? "pending" : "published",
            req.file?.filename || null,
            type?.mime || null,
            req.file?.size || null,
          ],
        );
        return r.insertId;
      });
      keep = !!req.file;
      res
        .status(201)
        .json({ post: serialize(await confession(pid, uid), uid) });
    } finally {
      if (req.file && !keep) await unlink(req.file.path).catch(() => {});
    }
  });
  app.get("/api/confessions/:id/media", async (req, res, next) => {
    const p = await confession(id(req.params.id), req.auth.user.id);
    if (!p.media_path) throw new HttpError(404, "Media not found.");
    res
      .type(p.media_mime)
      .sendFile(
        path.join(config.uploadDir, p.media_path),
        { cacheControl: false },
        (e) => {
          if (e) next(e);
        },
      );
  });
  app.delete("/api/confessions/:id", limit, async (req, res) => {
    await transaction(async (q) => {
      const [p] = await q(
        "SELECT * FROM confession_posts WHERE id=? AND author_id=? FOR UPDATE",
        [id(req.params.id), req.auth.user.id],
      );
      if (!p) throw new HttpError(404, "Confession not found.");
      if (p.media_path)
        await q("INSERT IGNORE INTO media_deletions(path) VALUES(?)", [
          p.media_path,
        ]);
      await q("DELETE FROM confession_posts WHERE id=?", [p.id]);
    });
    res.sendStatus(204);
  });
  for (const method of ["put", "delete"])
    app[method]("/api/confessions/:id/like", limit, async (req, res) => {
      const uid = req.auth.user.id,
        p = await confession(id(req.params.id), uid);
      await transaction(async (q) => {
        await lockUsers(q, [uid, p.author_id]);
        const fresh = await confession(p.id, uid, q);
        if (fresh.status !== "published")
          throw new HttpError(403, "This confession is awaiting review.");
        await q(
          method === "put"
            ? "INSERT IGNORE INTO confession_likes(post_id,user_id) VALUES(?,?)"
            : "DELETE FROM confession_likes WHERE post_id=? AND user_id=?",
          [p.id, uid],
        );
      });
      res.sendStatus(204);
    });
  app.get("/api/confessions/:id/comments", async (req, res) => {
    const uid = req.auth.user.id,
      p = await confession(id(req.params.id), uid),
      before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      `SELECT c.*,u.username,u.display_name,u.avatar_preset,u.avatar_path,u.avatar_revision FROM confession_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? AND c.id<? AND (c.status='published' OR c.author_id=?) AND ${visibleTo(uid, "c.author_id")} ORDER BY c.id DESC LIMIT 31`,
      [p.id, before, uid],
    );
    res.json({
      comments: rows.slice(0, 30).map((c) => ({
        id: c.id,
        text: c.text,
        status: c.status,
        anonymous: !!c.anonymous,
        isOwner: c.author_id === uid,
        createdAt: c.created_at,
        author: c.anonymous ? null : publicUser({ ...c, id: c.author_id }),
      })),
      hasMore: rows.length > 30,
    });
  });
  app.post("/api/confessions/:id/comments", limit, async (req, res) => {
    const text = content(req.body.text, 1000),
      anonymous = req.body.anonymous !== false;
    if (
      req.body.anonymous !== undefined &&
      typeof req.body.anonymous !== "boolean"
    )
      throw new HttpError(400, "Choose an anonymity option.");
    const uid = req.auth.user.id,
      p = await confession(id(req.params.id), uid);
    await transaction(async (q) => {
      await lockUsers(q, [uid, p.author_id]);
      const fresh = await confession(p.id, uid, q);
      if (fresh.status !== "published")
        throw new HttpError(403, "This confession is awaiting review.");
      await q(
        "INSERT INTO confession_comments(post_id,author_id,text,anonymous,status) VALUES(?,?,?,?,?)",
        [
          p.id,
          uid,
          text,
          anonymous,
          needsReview(text) ? "pending" : "published",
        ],
      );
    });
    res
      .status(201)
      .json({ status: needsReview(text) ? "pending" : "published" });
  });
  app.delete("/api/confession-comments/:id", limit, async (req, res) => {
    await query("DELETE FROM confession_comments WHERE id=? AND author_id=?", [
      id(req.params.id),
      req.auth.user.id,
    ]);
    res.sendStatus(204);
  });
  app.post("/api/confessions/:id/report", limit, async (req, res) => {
    const p = await confession(id(req.params.id), req.auth.user.id);
    await query(
      "INSERT INTO confession_reports(post_id,user_id,reason) VALUES(?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason),resolved=FALSE",
      [p.id, req.auth.user.id, content(req.body.reason, 500)],
    );
    res.sendStatus(204);
  });
}
