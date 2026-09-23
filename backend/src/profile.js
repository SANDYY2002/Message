import { allowInteraction } from "./relationships.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { query, transaction } from "./db.js";
import { config } from "./config.js";
import { clearSession } from "./auth.js";
import { credentials, HttpError, id } from "./validation.js";
import { publicUser } from "./users.js";
import { drainMediaDeletions } from "./media-cleanup.js";
const presets = new Set([
  "initials",
  "cat",
  "fox",
  "panda",
  "flower",
  "moon",
  "rocket",
]);
export function mountProfile(app, io, limiter) {
  const limit = limiter(20, 15 * 60_000, (req) => String(req.auth.user.id));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  }).single("avatar");
  async function update(req, fn) {
    const user = await transaction(async (q) => {
      const [row] = await q("SELECT * FROM users WHERE id=? FOR UPDATE", [
        req.auth.user.id,
      ]);
      const sessions = await q(
        "SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)",
        [req.auth.hash],
      );
      if (!sessions.length) throw new HttpError(401, "Please sign in again.");
      await fn(q, row);
      const [updated] = await q("SELECT * FROM users WHERE id=?", [row.id]);
      return publicUser(updated);
    });
    io.emit("user:updated", user);
    void drainMediaDeletions();
    return user;
  }
  async function replaceAvatar(req, preset, filename) {
    return update(req, async (q, row) => {
      if (row.avatar_path)
        await q("INSERT IGNORE INTO media_deletions(path) VALUES(?)", [
          row.avatar_path,
        ]);
      await q(
        "UPDATE users SET avatar_preset=?,avatar_path=?,avatar_revision=avatar_revision+1 WHERE id=?",
        [preset, filename, row.id],
      );
    });
  }
  app.patch("/api/profile/bio", limit, async (req, res) => {
    if (typeof req.body?.bio !== "string" || req.body.bio.trim().length > 300)
      throw new HttpError(400, "Bio must be at most 300 characters.");
    const user = await update(req, (q) =>
      q("UPDATE users SET bio=? WHERE id=?", [
        req.body.bio.trim(),
        req.auth.user.id,
      ]),
    );
    res.json({ user });
  });
  app.patch("/api/profile/username", limit, async (req, res) => {
    const { username } = credentials({
      username: req.body?.username,
      password: "validation-only",
    });
    try {
      const user = await update(req, (q) =>
        q("UPDATE users SET username=? WHERE id=?", [
          username,
          req.auth.user.id,
        ]),
      );
      res.json({ user });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        throw new HttpError(409, "That username is already taken.");
      throw e;
    }
  });
  app.patch("/api/profile/avatar", limit, async (req, res) => {
    if (!presets.has(req.body?.preset))
      throw new HttpError(400, "Choose an available avatar.");
    res.json({ user: await replaceAvatar(req, req.body.preset, null) });
  });
  app.post(
    "/api/profile/avatar",
    limit,
    (req, res, next) =>
      upload(req, res, (e) =>
        next(
          e
            ? new HttpError(
                e.code === "LIMIT_FILE_SIZE" ? 413 : 400,
                "Choose one JPG, PNG or WebP image up to 2 MB.",
              )
            : undefined,
        ),
      ),
    async (req, res) => {
      if (!req.file) throw new HttpError(400, "Choose an image.");
      const type = await fileTypeFromBuffer(req.file.buffer);
      if (!["image/jpeg", "image/png", "image/webp"].includes(type?.mime))
        throw new HttpError(400, "Choose a JPG, PNG or WebP image.");
      let image;
      try {
        image = await sharp(req.file.buffer, { limitInputPixels: 16_000_000 })
          .rotate()
          .resize(256, 256, { fit: "cover", position: "centre" })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "Image could not be read. Use an image under 16 megapixels.",
        );
      }
      const filename = `avatar-${randomUUID()}.webp`,
        target = path.join(config.uploadDir, filename);
      await writeFile(target, image, { flag: "wx" });
      let user;
      try {
        user = await replaceAvatar(req, "initials", filename);
      } catch (e) {
        await unlink(target).catch(() => {});
        throw e;
      }
      res.json({ user });
    },
  );
  app.get("/api/avatars/:userId", async (req, res) => {
    await allowInteraction(req.auth.user.id, id(req.params.userId));
    const [row] = await query("SELECT avatar_path FROM users WHERE id=?", [
      id(req.params.userId),
    ]);
    if (!row?.avatar_path) throw new HttpError(404, "Avatar not found.");
    res.type("webp").sendFile(path.join(config.uploadDir, row.avatar_path));
  });
  app.post("/api/profile/password", limit, async (req, res) => {
    const { password } = credentials({
      username: "valid",
      password: req.body?.newPassword,
    });
    const current = req.body?.currentPassword;
    if (typeof current !== "string" || Buffer.byteLength(current) > 72)
      throw new HttpError(400, "Enter your current password.");
    const hash = await bcrypt.hash(password, 12);
    await transaction(async (q) => {
      const [row] = await q(
        "SELECT password_hash FROM users WHERE id=? FOR UPDATE",
        [req.auth.user.id],
      );
      const sessions = await q(
        "SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)",
        [req.auth.hash],
      );
      if (!sessions.length) throw new HttpError(401, "Please sign in again.");
      if (!(await bcrypt.compare(current, row.password_hash)))
        throw new HttpError(400, "Current password is incorrect.");
      await q("UPDATE users SET password_hash=? WHERE id=?", [
        hash,
        req.auth.user.id,
      ]);
      await q("DELETE FROM sessions WHERE user_id=?", [req.auth.user.id]);
    });
    clearSession(res);
    io.to(`user:${req.auth.user.id}`).emit("session:revoked");
    io.in(`user:${req.auth.user.id}`).disconnectSockets(true);
    res.sendStatus(204);
  });
}
