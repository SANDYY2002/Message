import { mountGroups } from "./groups.js";
import { mountCalls } from "./calls.js";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import multer from "multer";
import { fileTypeFromFile } from "file-type";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { config, backendDir } from "./config.js";
import { query, transaction } from "./db.js";
import { requireAuth, issueSession, clearSession } from "./auth.js";
import {
  credentials,
  HttpError,
  id,
  messageInput,
  publicMessage,
} from "./validation.js";
import { member, emitConversation } from "./chat.js";

import { mountMessageManagement } from "./message-management.js";
export async function createApp(io) {
  await mkdir(config.uploadDir, { recursive: true });
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-origin" },
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "blob:", "data:"],
          "media-src": ["'self'", "blob:"],
          "connect-src": ["'self'"],
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== config.origin
    )
      return next(new HttpError(403, "Request origin is not allowed."));
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  const limiter = (limit, windowMs, keyGenerator) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      ...(keyGenerator ? { keyGenerator } : {}),
      message: { error: "Too many requests. Please try again shortly." },
    });
  app.use("/api", limiter(600, 60_000));
  app.get("/api/health", async (req, res) => {
    await query("SELECT 1");
    res.json({ status: "ok" });
  });
  mountCalls(app);
  const authLimiter = limiter(20, 15 * 60_000);
  const dummyHash = await bcrypt.hash(randomUUID(), 12);
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const { username, password, displayName } = credentials(req.body, true);
    const hash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = await query(
        "INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)",
        [username, displayName, hash],
      );
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        throw new HttpError(409, "That username is already taken.");
      throw e;
    }
    await issueSession(res, result.insertId);
    res
      .status(201)
      .json({ user: { id: result.insertId, username, displayName } });
  });
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { username, password } = credentials(req.body);
    const [u] = await query("SELECT * FROM users WHERE username=?", [username]);
    const valid = await bcrypt.compare(password, u?.password_hash || dummyHash);
    if (!u || !valid)
      throw new HttpError(401, "Incorrect username or password.");
    await issueSession(res, u.id);
    res.json({
      user: { id: u.id, username: u.username, displayName: u.display_name },
    });
  });
  app.use("/api", requireAuth);
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: req.auth.user, maxUploadBytes: config.maxBytes }),
  );
  app.post("/api/auth/logout", async (req, res) => {
    await query("DELETE FROM sessions WHERE token_hash=?", [req.auth.hash]);
    io.in(`session:${req.auth.hash}`).disconnectSockets(true);
    clearSession(res);
    res.sendStatus(204);
  });
  mountMessageManagement(app, io, limiter);
  mountGroups(app, io, limiter);
  app.get("/api/users", async (req, res) => {
    const search = String(req.query.q || "")
      .trim()
      .toLowerCase()
      .slice(0, 60);
    // LOCATE treats user input literally, including % and _.
    const users = await query(
      "SELECT id,username,display_name AS displayName FROM users WHERE id<>? AND (LOCATE(?,username)>0 OR LOCATE(?,LOWER(display_name))>0) ORDER BY username LIMIT 30",
      [req.auth.user.id, search, search],
    );
    res.json({ users });
  });
  app.get("/api/conversations", async (req, res) => {
    const uid = req.auth.user.id;
    const rows = await query(
      `SELECT c.*,u.id AS peer_id,u.username,u.display_name,
   (SELECT COUNT(*) FROM group_members g WHERE g.conversation_id=c.id) AS member_count,
   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>? AND m.deleted_at IS NULL AND m.id>IF(c.kind='group',gm.read_id,IF(c.user_low=?,c.low_read_id,c.high_read_id))) AS unread,
   (SELECT m.id FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_id,
   (SELECT m.text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_text,
   (SELECT m.media_mime FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_mime,
   (SELECT m.deleted_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_deleted
   FROM conversations c LEFT JOIN users u ON u.id=IF(c.user_low=?,c.user_high,c.user_low)
   LEFT JOIN group_members gm ON gm.conversation_id=c.id AND gm.user_id=?
   WHERE c.user_low=? OR c.user_high=? OR gm.user_id IS NOT NULL ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`,
      [uid, uid, uid, uid, uid, uid],
    );
    res.json({
      conversations: rows.map((c) => ({
        id: c.id,
        isGroup: c.kind === "group",
        ownerId: c.owner_id,
        memberCount: Number(c.member_count),
        peer: {
          id: c.kind === "group" ? c.id : c.peer_id,
          username: c.kind === "group" ? "group" : c.username,
          displayName: c.kind === "group" ? c.name : c.display_name,
        },
        unread: Number(c.unread),
        peerReadId:
          c.kind === "group"
            ? 0
            : uid === c.user_low
              ? c.high_read_id
              : c.low_read_id,
        lastMessage: c.last_id
          ? {
              id: c.last_id,
              text: c.last_text,
              mediaMime: c.last_mime,
              deletedAt: c.last_deleted,
            }
          : null,
        updatedAt: c.updated_at,
      })),
    });
  });
  app.post(
    "/api/conversations",
    limiter(60, 60_000, (r) => String(r.auth.user.id)),
    async (req, res) => {
      const uid = req.auth.user.id,
        peer = id(req.body?.userId);
      if (uid === peer)
        throw new HttpError(400, "Choose someone else to message.");
      if (!(await query("SELECT id FROM users WHERE id=?", [peer])).length)
        throw new HttpError(404, "User not found.");
      await query(
        "INSERT INTO conversations(user_low,user_high) VALUES(?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [Math.min(uid, peer), Math.max(uid, peer)],
      );
      const [c] = await query(
        "SELECT * FROM conversations WHERE user_low=? AND user_high=?",
        [Math.min(uid, peer), Math.max(uid, peer)],
      );
      await emitConversation(io, c, "conversation:changed", {
        conversationId: c.id,
      });
      res.status(201).json({ id: c.id });
    },
  );
  app.get("/api/conversations/:id/messages", async (req, res) => {
    const cid = id(req.params.id),
      uid = req.auth.user.id,
      c = await member(cid, uid);
    const before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      "SELECT m.*,u.display_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT 51",
      [cid, before],
    );
    const hasMore = rows.length > 50;
    res.json({
      messages: rows.slice(0, 50).reverse().map(publicMessage),
      hasMore,
      peerReadId:
        c.kind === "group"
          ? 0
          : c.user_low === uid
            ? c.high_read_id
            : c.low_read_id,
    });
  });
  app.post("/api/conversations/:id/read", async (req, res) => {
    const cid = id(req.params.id),
      uid = req.auth.user.id,
      mid = id(req.body?.messageId);
    const c = await transaction(async (q) => {
      const c = await member(cid, uid, q, true);
      if (
        !(
          await q("SELECT id FROM messages WHERE id=? AND conversation_id=?", [
            mid,
            cid,
          ])
        ).length
      )
        throw new HttpError(
          400,
          "Message does not belong to this conversation.",
        );
      if (c.kind === "group") {
        await q(
          "UPDATE group_members SET read_id=GREATEST(read_id,?) WHERE conversation_id=? AND user_id=?",
          [mid, cid, uid],
        );
        return c;
      }
      const col = c.user_low === uid ? "low_read_id" : "high_read_id";
      await q(`UPDATE conversations SET ${col}=GREATEST(${col},?) WHERE id=?`, [
        mid,
        cid,
      ]);
      return c;
    });
    await emitConversation(io, c, "conversation:read", {
      conversationId: cid,
      userId: uid,
      messageId: mid,
    });
    res.sendStatus(204);
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: {
      fileSize: config.maxBytes,
      files: 1,
      fields: 2,
      fieldSize: 20000,
      parts: 3,
    },
  }).single("file");
  const uploadLimit = limiter(30, 60_000, (r) => String(r.auth.user.id));
  app.post(
    "/api/conversations/:id/messages",
    uploadLimit,
    async (req, res, next) => {
      try {
        req.conversation = await member(id(req.params.id), req.auth.user.id);
        next();
      } catch (e) {
        next(e);
      }
    },
    (req, res, next) => upload(req, res, next),
    async (req, res) => {
      let keepFile = false;
      try {
        const { text, clientId } = messageInput(req.body || {}),
          uid = req.auth.user.id,
          cid = req.conversation.id;
        if (!text && !req.file)
          throw new HttpError(
            400,
            "Write a message or attach a photo or video.",
          );
        let mime = null;
        if (req.file) {
          const detected = await fileTypeFromFile(req.file.path);
          mime = detected?.mime;
          if (
            ![
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "video/mp4",
              "video/webm",
            ].includes(mime)
          )
            throw new HttpError(
              415,
              "Supported files: JPG, PNG, WebP, GIF, MP4, and WebM.",
            );
        }
        const result = await transaction(async (q) => {
          // Serialize sends per sender to enforce quota and idempotency across conversations.
          await q("SELECT id FROM users WHERE id=? FOR UPDATE", [uid]);
          await member(cid, uid, q, true);
          const [existing] = await q(
            "SELECT * FROM messages WHERE sender_id=? AND client_id=?",
            [uid, clientId],
          );
          if (existing) {
            if (existing.conversation_id !== cid)
              throw new HttpError(409, "Retry identifier already used.");
            return { message: existing, created: false };
          }
          if (req.file) {
            const [used] = await q(
              "SELECT COALESCE(SUM(media_size),0) AS bytes FROM messages WHERE sender_id=?",
              [uid],
            );
            if (Number(used.bytes) + req.file.size > config.storageBytes)
              throw new HttpError(413, "Your media storage allowance is full.");
          }
          await member(cid, uid, q, true);
          const row = await q(
            "INSERT INTO messages(conversation_id,sender_id,client_id,text,media_path,media_name,media_mime,media_size) VALUES(?,?,?,?,?,?,?,?)",
            [
              cid,
              uid,
              clientId,
              text,
              req.file?.filename || null,
              req.file
                ? path.basename(req.file.originalname).slice(0, 255)
                : null,
              mime,
              req.file?.size || null,
            ],
          );
          await q(
            "UPDATE conversations SET updated_at=UTC_TIMESTAMP(3) WHERE id=?",
            [cid],
          );
          const [message] = await q("SELECT * FROM messages WHERE id=?", [
            row.insertId,
          ]);
          return { message, created: true };
        });
        keepFile = result.created && !!req.file;
        const message = publicMessage({
          ...result.message,
          sender_name: req.auth.user.displayName,
        });
        if (result.created)
          await emitConversation(io, req.conversation, "message:new", message);
        res.status(result.created ? 201 : 200).json({ message });
      } finally {
        if (req.file && !keepFile) await unlink(req.file.path).catch(() => {});
      }
    },
  );
  app.get("/api/media/:id", async (req, res, next) => {
    const [m] = await query("SELECT * FROM messages WHERE id=?", [
      id(req.params.id),
    ]);
    if (!m?.media_path || m.deleted_at)
      throw new HttpError(404, "Media not found.");
    await member(m.conversation_id, req.auth.user.id);
    res.type(m.media_mime);
    res.setHeader("Content-Disposition", "inline");
    res.sendFile(
      path.join(config.uploadDir, m.media_path),
      { cacheControl: false },
      (err) => {
        if (err) next(err);
      },
    );
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "Endpoint not found.")),
  );
  if (config.production) {
    app.use(express.static(path.join(backendDir, "../frontend/dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(backendDir, "../frontend/dist/index.html")),
    );
  }
  app.use((err, req, res, _next) => {
    if (res.headersSent) return res.end();
    const status =
      err instanceof multer.MulterError
        ? err.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400
        : err.status || 500;
    if (status >= 500)
      console.error("Request failed:", err.code || err.message);
    res.status(status).json({
      error:
        err instanceof multer.MulterError
          ? `Upload rejected. Attach one supported file up to ${config.maxBytes / 1024 / 1024} MB.`
          : status >= 500
            ? "Something went wrong. Please try again."
            : err.message,
    });
  });
  return app;
}
