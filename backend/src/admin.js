import bcrypt from "bcryptjs";
import path from "node:path";
import { query, transaction } from "./db.js";
import { decrypt, verifyCode } from "./admin-crypto.js";
import { id, HttpError } from "./validation.js";
import { publicUser } from "./users.js";
import { config } from "./config.js";
const audit = (q, uid, action, target = null) =>
  q("INSERT INTO admin_audit(admin_id,action,target_id) VALUES(?,?,?)", [
    uid,
    action,
    target,
  ]);
export function mountAdmin(app, limiter) {
  app.get("/api/admin/status", async (req, res) => {
    const [row] = await query(
      "SELECT s.user_id,a.expires_at FROM superadmins s LEFT JOIN admin_sessions a ON a.token_hash=? AND a.expires_at>UTC_TIMESTAMP(3) WHERE s.user_id=?",
      [req.auth.hash, req.auth.user.id],
    );
    res.json({
      eligible: !!row,
      unlocked: !!row?.expires_at,
      expiresAt: row?.expires_at || null,
    });
  });
  app.post(
    "/api/admin/unlock",
    limiter(8, 15 * 60000),
    limiter(5, 15 * 60000, (r) => String(r.auth.user.id)),
    async (req, res) => {
      const password = req.body?.password,
        code = req.body?.code;
      if (
        typeof password !== "string" ||
        Buffer.byteLength(password) > 72 ||
        typeof code !== "string" ||
        !/^\d{6}$/.test(code)
      )
        throw new HttpError(
          403,
          "Password or authenticator code is incorrect.",
        );
      const uid = req.auth.user.id;
      await transaction(async (q) => {
        const [u] = await q(
          "SELECT password_hash FROM users WHERE id=? FOR UPDATE",
          [uid],
        );
        const [s] = await q(
          "SELECT * FROM superadmins WHERE user_id=? FOR UPDATE",
          [uid],
        );
        if (!s || !(await bcrypt.compare(password, u.password_hash)))
          throw new HttpError(
            403,
            "Password or authenticator code is incorrect.",
          );
        const step = verifyCode(decrypt(s.secret), code, Number(s.last_step));
        if (step === null)
          throw new HttpError(
            403,
            "Password or authenticator code is incorrect, or the code was already used.",
          );
        await q("UPDATE superadmins SET last_step=? WHERE user_id=?", [
          step,
          uid,
        ]);
        await q(
          "INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)",
          [req.auth.hash],
        );
        await audit(q, uid, "unlock");
      });
      res.json({ unlocked: true });
    },
  );
  app.delete("/api/admin/unlock", async (req, res) => {
    await query("DELETE FROM admin_sessions WHERE token_hash=?", [
      req.auth.hash,
    ]);
    res.sendStatus(204);
  });
  app.use("/api/admin", async (req, res, next) => {
    const rows = await query(
      "SELECT a.token_hash FROM admin_sessions a JOIN superadmins s ON s.user_id=? WHERE a.token_hash=? AND a.expires_at>UTC_TIMESTAMP(3)",
      [req.auth.user.id, req.auth.hash],
    );
    if (!rows.length)
      throw new HttpError(
        403,
        "Unlock admin access with your password and authenticator.",
      );
    next();
  });
  app.get("/api/admin/avatars/:id", async (req, res, next) => {
    const uid = id(req.params.id);
    await audit(query, req.auth.user.id, "avatar_view", uid);
    const [u] = await query("SELECT avatar_path FROM users WHERE id=?", [uid]);
    if (!u?.avatar_path) throw new HttpError(404, "Avatar not found.");
    res
      .type("image/webp")
      .sendFile(
        path.join(config.uploadDir, u.avatar_path),
        { cacheControl: false },
        (e) => {
          if (e) next(e);
        },
      );
  });
  app.get("/api/admin/users", async (req, res) => {
    const before = req.query.before ? id(req.query.before) : 4294967295,
      search = String(req.query.search || "").slice(0, 60);
    await audit(query, req.auth.user.id, "users_list");
    const users = await query(
      "SELECT id,username,display_name,bio,avatar_preset,avatar_path,avatar_revision FROM users WHERE id<? AND (LOCATE(?,username)>0 OR LOCATE(?,display_name)>0) ORDER BY id DESC LIMIT 50",
      [before, search, search],
    );
    res.json({ users: users.map(publicUser) });
  });
  app.get("/api/admin/users/:id/:tab", async (req, res) => {
    const uid = id(req.params.id),
      tab = req.params.tab;
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000)
      throw new HttpError(400, "Invalid page.");
    const statements = {
      profile:
        "SELECT id,username,display_name,bio,avatar_preset,avatar_path,avatar_revision FROM users WHERE id=?",
      posts:
        "SELECT id,text,created_at FROM posts WHERE author_id=? ORDER BY id DESC LIMIT 100",
      confessions:
        "SELECT id,text,status,created_at FROM confession_posts WHERE author_id=? ORDER BY id DESC LIMIT 100",
      comments:
        "SELECT id,post_id,text,anonymous,status,created_at FROM confession_comments WHERE author_id=? ORDER BY id DESC LIMIT 100",
      messages:
        "SELECT c.id,c.kind,c.name,c.request_status,c.user_low,c.user_high,c.updated_at FROM conversations c WHERE c.user_low=? OR c.user_high=? OR EXISTS(SELECT 1 FROM group_members g WHERE g.conversation_id=c.id AND g.user_id=?) ORDER BY c.updated_at DESC LIMIT 100",
      followers:
        "SELECT u.id,u.username,u.display_name FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followed_id=? ORDER BY u.id DESC LIMIT 100",
      following:
        "SELECT u.id,u.username,u.display_name FROM follows f JOIN users u ON u.id=f.followed_id WHERE f.follower_id=? ORDER BY u.id DESC LIMIT 100",
      activity:
        "SELECT id,actor_id,kind,post_id,is_read,created_at FROM activities WHERE recipient_id=? ORDER BY id DESC LIMIT 100",
      saved:
        "SELECT p.id,p.text,p.author_id,p.created_at FROM post_bookmarks b JOIN posts p ON p.id=b.post_id WHERE b.user_id=? ORDER BY p.id DESC LIMIT 100",
      reactions:
        "SELECT p.id,p.text,p.author_id FROM post_likes l JOIN posts p ON p.id=l.post_id WHERE l.user_id=? ORDER BY p.id DESC LIMIT 100",
      social_comments:
        "SELECT id,post_id,text,created_at FROM post_comments WHERE author_id=? ORDER BY id DESC LIMIT 100",
      calls:
        "SELECT id,conversation_id,caller_id,callee_id,kind,status,created_at FROM calls WHERE caller_id=? OR callee_id=? ORDER BY id DESC LIMIT 100",
      blocks:
        "SELECT u.id,u.username,u.display_name FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY u.id DESC LIMIT 100",
    };
    if (!statements[tab]) throw new HttpError(404, "Unknown user tab.");
    await audit(query, req.auth.user.id, `user_${tab}`, uid);
    const rows = await query(
      statements[tab].replace("LIMIT 100", `LIMIT 50 OFFSET ${offset}`),
      tab === "messages"
        ? [uid, uid, uid]
        : tab === "calls"
          ? [uid, uid]
          : [uid],
    );
    res.json({
      rows:
        tab === "profile"
          ? rows.map((u) => ({
              ...publicUser(u),
              avatarUrl: u.avatar_path ? `/api/admin/avatars/${u.id}` : null,
            }))
          : rows,
      nextOffset: tab !== "profile" && rows.length === 50 ? offset + 50 : null,
    });
  });
  app.get("/api/admin/conversations/:id", async (req, res) => {
    const cid = id(req.params.id),
      before = req.query.before ? id(req.query.before) : 4294967295;
    await audit(query, req.auth.user.id, "private_messages", cid);
    const rows = await query(
      "SELECT m.id,m.sender_id,u.username,m.text,m.deleted_at,m.created_at,m.media_mime,m.media_path FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT 50",
      [cid, before],
    );
    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        username: m.username,
        text: m.deleted_at ? "" : m.text,
        deleted: !!m.deleted_at,
        createdAt: m.created_at,
        media:
          !m.deleted_at && m.media_path
            ? { url: `/api/admin/media/messages/${m.id}`, mime: m.media_mime }
            : null,
      })),
    });
  });
  app.get("/api/admin/media/:kind/:id", async (req, res, next) => {
    const table =
      req.params.kind === "messages"
        ? "messages"
        : req.params.kind === "confessions"
          ? "confession_posts"
          : null;
    if (!table) throw new HttpError(404, "Media not found.");
    const mid = id(req.params.id);
    await audit(query, req.auth.user.id, `media_${req.params.kind}`, mid);
    const [m] = await query(
      `SELECT media_path,media_mime${table === "messages" ? ",deleted_at" : ""} FROM ${table} WHERE id=?`,
      [mid],
    );
    if (!m?.media_path || m.deleted_at)
      throw new HttpError(404, "Media not found.");
    res
      .type(m.media_mime)
      .sendFile(
        path.join(config.uploadDir, m.media_path),
        { cacheControl: false },
        (e) => {
          if (e) next(e);
        },
      );
  });
  app.get("/api/admin/moderation", async (req, res) => {
    await audit(query, req.auth.user.id, "moderation_list");
    const posts = await query(
      "SELECT p.id,p.text,p.status,p.author_id,u.username,p.media_mime,(p.media_path IS NOT NULL) AS has_media FROM confession_posts p JOIN users u ON u.id=p.author_id WHERE p.status='pending' OR EXISTS(SELECT 1 FROM confession_reports r WHERE r.post_id=p.id AND r.resolved=FALSE) ORDER BY p.id LIMIT 100",
    );
    const comments = await query(
      "SELECT c.id,c.post_id,c.text,c.anonymous,c.author_id,u.username FROM confession_comments c JOIN users u ON u.id=c.author_id WHERE c.status='pending' ORDER BY c.id LIMIT 100",
    );
    const reports = await query(
      "SELECT id,post_id,reason FROM confession_reports WHERE resolved=FALSE ORDER BY id LIMIT 100",
    );
    res.json({ posts, comments, reports });
  });
  app.post("/api/admin/moderation/:kind/:id", async (req, res) => {
    const table =
        req.params.kind === "posts"
          ? "confession_posts"
          : req.params.kind === "comments"
            ? "confession_comments"
            : null,
      status = req.body.status;
    if (!table || !["published", "rejected"].includes(status))
      throw new HttpError(400, "Choose approve or reject.");
    const target = id(req.params.id);
    await transaction(async (q) => {
      await audit(q, req.auth.user.id, `${req.params.kind}_${status}`, target);
      await q(`UPDATE ${table} SET status=? WHERE id=?`, [status, target]);
      if (table === "confession_posts")
        await q("UPDATE confession_reports SET resolved=TRUE WHERE post_id=?", [
          target,
        ]);
    });
    res.sendStatus(204);
  });
  app.get("/api/admin/audit", async (req, res) => {
    await audit(query, req.auth.user.id, "audit_view");
    const rows = await query(
      "SELECT a.*,u.username FROM admin_audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 100",
    );
    res.json({ rows });
  });
}
