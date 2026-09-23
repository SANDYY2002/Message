import { query, transaction } from "./db.js";
import { id, HttpError } from "./validation.js";
import { publicUser } from "./users.js";
import { allowInteraction, lockUsers, visibleTo } from "./relationships.js";
function content(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `Write between 1 and ${max} characters.`);
  return value.trim();
}
async function notify(q, recipient, actor, kind, postId, key) {
  if (recipient === actor) return;
  const result = await q(
    "INSERT IGNORE INTO activities(recipient_id,actor_id,kind,post_id,event_key) VALUES(?,?,?,?,?)",
    [recipient, actor, kind, postId, key],
  );
  return result.affectedRows ? result.insertId : null;
}
export function mountSocial(app, io, limiter) {
  const limit = limiter(90, 60_000, (req) => String(req.auth.user.id));
  async function activity(uid, activityId) {
    if (!Number.isInteger(activityId)) return;
    const [row] = await query(
      "SELECT id,kind,actor_id AS senderId FROM activities WHERE recipient_id=? AND id=?",
      [uid, activityId],
    );
    if (row) io.to(`user:${uid}`).emit("activity:new", row);
  }
  const changed = () => io.emit("social:changed");
  async function postRow(pid, uid, q = query) {
    const [p] = await q("SELECT * FROM posts WHERE id=?", [pid]);
    if (!p) throw new HttpError(404, "Post not found.");
    await allowInteraction(uid, p.author_id, q);
    if (p.repost_of) {
      const [original] = await q("SELECT author_id FROM posts WHERE id=?", [
        p.repost_of,
      ]);
      if (!original) throw new HttpError(404, "Post not found.");
      await allowInteraction(uid, original.author_id, q);
    }
    return p;
  }
  async function present(p, uid) {
    const [u] = await query("SELECT * FROM users WHERE id=?", [p.author_id]);
    const [stats] = await query(
      `SELECT
      (SELECT COUNT(*) FROM post_likes x WHERE x.post_id=? AND ${visibleTo(uid, "x.user_id")}) AS likes,
      (SELECT COUNT(*) FROM post_comments x WHERE x.post_id=? AND ${visibleTo(uid, "x.author_id")}) AS comments,
      (SELECT COUNT(*) FROM posts x WHERE x.repost_of=? AND ${visibleTo(uid, "x.author_id")}) AS reposts,
      EXISTS(SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?) AS liked,
      EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id=? AND user_id=?) AS bookmarked,
      EXISTS(SELECT 1 FROM posts WHERE repost_of=? AND author_id=?) AS reposted,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?) AS following,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?) AS followsYou`,
      [
        p.id,
        p.id,
        p.id,
        p.id,
        uid,
        p.id,
        uid,
        p.id,
        uid,
        uid,
        p.author_id,
        p.author_id,
        uid,
      ],
    );
    return {
      id: p.id,
      text: p.text,
      author: publicUser(u),
      createdAt: p.created_at,
      ...stats,
      original: p.repost_of
        ? await present(await postRow(p.repost_of, uid), uid)
        : null,
    };
  }
  app.get("/api/posts", async (req, res) => {
    const uid = req.auth.user.id,
      before = req.query.before ? id(req.query.before) : 4294967295;
    const author = req.query.author ? id(req.query.author) : null;
    if (author) await allowInteraction(uid, author);
    const mode = req.query.mode || "all";
    const filter = author
      ? ` AND p.author_id=${author}`
      : mode === "mine"
        ? ` AND p.author_id=${uid}`
        : mode === "following"
          ? ` AND (p.author_id=${uid} OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=${uid} AND f.followed_id=p.author_id))`
          : mode === "saved"
            ? ` AND EXISTS(SELECT 1 FROM post_bookmarks b WHERE b.post_id=p.id AND b.user_id=${uid})`
            : "";
    const rows = await query(
      `SELECT p.* FROM posts p WHERE p.id<? AND ${visibleTo(uid, "p.author_id")} AND (p.repost_of IS NULL OR EXISTS(SELECT 1 FROM posts o WHERE o.id=p.repost_of AND ${visibleTo(uid, "o.author_id")})) ${filter} ORDER BY p.id DESC LIMIT 21`,
      [before],
    );
    res.json({
      posts: await Promise.all(rows.slice(0, 20).map((p) => present(p, uid))),
      nextBefore: rows.length > 20 ? rows[19].id : null,
    });
  });
  app.get("/api/posts/:id", async (req, res) =>
    res.json({
      post: await present(
        await postRow(id(req.params.id), req.auth.user.id),
        req.auth.user.id,
      ),
    }),
  );
  app.post("/api/posts", limit, async (req, res) => {
    const text = content(req.body?.text, 4000);
    const r = await query("INSERT INTO posts(author_id,text) VALUES(?,?)", [
      req.auth.user.id,
      text,
    ]);
    changed();
    res.status(201).json({ id: r.insertId });
  });
  app.delete("/api/posts/:id", limit, async (req, res) => {
    const r = await query("DELETE FROM posts WHERE id=? AND author_id=?", [
      id(req.params.id),
      req.auth.user.id,
    ]);
    if (!r.affectedRows) throw new HttpError(404, "Post not found.");
    changed();
    res.sendStatus(204);
  });
  async function mutate(req, fn) {
    const uid = req.auth.user.id,
      pid = id(req.params.id),
      p = await postRow(pid, uid);
    if (p.repost_of)
      throw new HttpError(400, "Interact with the original post.");
    const activityId = await transaction(async (q) => {
      await lockUsers(q, [uid, p.author_id]);
      const current = await postRow(pid, uid, q);
      await q("SELECT id FROM posts WHERE id=? FOR UPDATE", [pid]);
      return fn(q, current, uid);
    });
    changed();
    if (p.author_id !== uid) await activity(p.author_id, activityId);
  }
  for (const action of ["like", "bookmark"]) {
    const table = action === "like" ? "post_likes" : "post_bookmarks";
    app.put(`/api/posts/:id/${action}`, limit, async (req, res) => {
      await mutate(req, async (q, p, uid) => {
        await q(`INSERT IGNORE INTO ${table}(post_id,user_id) VALUES(?,?)`, [
          p.id,
          uid,
        ]);
        if (action === "like")
          return notify(
            q,
            p.author_id,
            uid,
            "like",
            p.id,
            `like:${uid}:${p.id}`,
          );
      });
      res.sendStatus(204);
    });
    app.delete(`/api/posts/:id/${action}`, limit, async (req, res) => {
      await mutate(req, (q, p, uid) =>
        q(`DELETE FROM ${table} WHERE post_id=? AND user_id=?`, [p.id, uid]),
      );
      res.sendStatus(204);
    });
  }
  app.post("/api/posts/:id/repost", limit, async (req, res) => {
    await mutate(req, async (q, p, uid) => {
      await q(
        "INSERT IGNORE INTO posts(author_id,text,repost_of) VALUES(?,'',?)",
        [uid, p.id],
      );
      return notify(
        q,
        p.author_id,
        uid,
        "repost",
        p.id,
        `repost:${uid}:${p.id}`,
      );
    });
    res.sendStatus(204);
  });
  app.delete("/api/posts/:id/repost", limit, async (req, res) => {
    await mutate(req, (q, p, uid) =>
      q("DELETE FROM posts WHERE author_id=? AND repost_of=?", [uid, p.id]),
    );
    res.sendStatus(204);
  });
  app.get("/api/posts/:id/comments", async (req, res) => {
    const uid = req.auth.user.id,
      p = await postRow(id(req.params.id), uid),
      before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      `SELECT c.*,u.username,u.display_name,u.avatar_preset,u.avatar_path,u.avatar_revision FROM post_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? AND c.id<? AND ${visibleTo(uid, "c.author_id")} ORDER BY c.id DESC LIMIT 31`,
      [p.id, before],
    );
    res.json({
      comments: rows.slice(0, 30).map((c) => ({
        id: c.id,
        text: c.text,
        createdAt: c.created_at,
        author: publicUser({ ...c, id: c.author_id }),
      })),
      nextBefore: rows.length > 30 ? rows[29].id : null,
    });
  });
  app.post("/api/posts/:id/comments", limit, async (req, res) => {
    const text = content(req.body?.text, 1000);
    await mutate(req, async (q, p, uid) => {
      const r = await q(
        "INSERT INTO post_comments(post_id,author_id,text) VALUES(?,?,?)",
        [p.id, uid, text],
      );
      return notify(
        q,
        p.author_id,
        uid,
        "comment",
        p.id,
        `comment:${r.insertId}`,
      );
    });
    res.status(201).json({ ok: true });
  });
  app.delete("/api/comments/:id", limit, async (req, res) => {
    const r = await query(
      "DELETE FROM post_comments WHERE id=? AND author_id=?",
      [id(req.params.id), req.auth.user.id],
    );
    if (!r.affectedRows) throw new HttpError(404, "Comment not found.");
    changed();
    res.sendStatus(204);
  });
  app.get("/api/people", async (req, res) => {
    const uid = req.auth.user.id,
      term = String(req.query.q || "")
        .trim()
        .toLowerCase()
        .slice(0, 60);
    const rows = await query(
      `SELECT u.*,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.followed_id=u.id) AS following,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=u.id AND f.followed_id=?) AS followsYou,(SELECT COUNT(*) FROM follows f WHERE f.followed_id=u.id) AS followers FROM users u WHERE u.id<>? AND ${visibleTo(uid, "u.id")} AND (LOCATE(?,u.username)>0 OR LOCATE(?,LOWER(u.display_name))>0) ORDER BY u.id DESC LIMIT 30`,
      [uid, uid, uid, term, term],
    );
    res.json({
      users: rows.map((u) => ({
        ...publicUser(u),
        following: !!u.following,
        followsYou: !!u.followsYou,
        followers: Number(u.followers),
      })),
    });
  });
  app.get("/api/people/:id", async (req, res) => {
    const uid = req.auth.user.id,
      peer = id(req.params.id);
    await allowInteraction(uid, peer);
    const [u] = await query("SELECT * FROM users WHERE id=?", [peer]);
    if (!u) throw new HttpError(404, "Profile not found.");
    const [stats] = await query(
      `SELECT
      (SELECT COUNT(*) FROM posts p WHERE p.author_id=? AND (p.repost_of IS NULL OR EXISTS(SELECT 1 FROM posts o WHERE o.id=p.repost_of AND ${visibleTo(uid, "o.author_id")}))) AS postCount,
      (SELECT COUNT(*) FROM follows f WHERE f.followed_id=? AND ${visibleTo(uid, "f.follower_id")}) AS followers,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id=? AND ${visibleTo(uid, "f.followed_id")}) AS followingCount,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?) AS following,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?) AS followsYou`,
      [peer, peer, peer, uid, peer, peer, uid],
    );
    res.json({ profile: { ...publicUser(u), ...stats } });
  });
  app.get("/api/people/:id/connections", async (req, res) => {
    const uid = req.auth.user.id,
      peer = id(req.params.id),
      before = req.query.before ? id(req.query.before) : 4294967295;
    await allowInteraction(uid, peer);
    if (!["followers", "following"].includes(req.query.kind))
      throw new HttpError(400, "Choose followers or following.");
    const incoming = req.query.kind === "followers";
    const rows = await query(
      `SELECT u.*,EXISTS(SELECT 1 FROM follows x WHERE x.follower_id=? AND x.followed_id=u.id) AS following,EXISTS(SELECT 1 FROM follows x WHERE x.follower_id=u.id AND x.followed_id=?) AS followsYou FROM follows f JOIN users u ON u.id=f.${incoming ? "follower_id" : "followed_id"} WHERE f.${incoming ? "followed_id" : "follower_id"}=? AND u.id<? AND ${visibleTo(uid, "u.id")} ORDER BY u.id DESC LIMIT 31`,
      [uid, uid, peer, before],
    );
    res.json({
      users: rows
        .slice(0, 30)
        .map((u) => ({
          ...publicUser(u),
          following: !!u.following,
          followsYou: !!u.followsYou,
        })),
      nextBefore: rows.length > 30 ? rows[29].id : null,
    });
  });
  for (const method of ["put", "delete"])
    app[method]("/api/people/:id/follow", limit, async (req, res) => {
      const uid = req.auth.user.id,
        peer = id(req.params.id);
      if (uid === peer) throw new HttpError(400, "Choose another user.");
      const activityId = await transaction(async (q) => {
        await lockUsers(q, [uid, peer]);
        await allowInteraction(uid, peer, q);
        if (method === "put") {
          await q(
            "INSERT IGNORE INTO follows(follower_id,followed_id) VALUES(?,?)",
            [uid, peer],
          );
          return notify(q, peer, uid, "follow", null, `follow:${uid}:${peer}`);
        } else
          await q("DELETE FROM follows WHERE follower_id=? AND followed_id=?", [
            uid,
            peer,
          ]);
      });
      changed();
      if (method === "put") await activity(peer, activityId);
      res.sendStatus(204);
    });
  app.get("/api/activities", async (req, res) => {
    const uid = req.auth.user.id,
      before = req.query.before ? id(req.query.before) : 4294967295;
    const rows = await query(
      `SELECT a.*,u.username,u.display_name,u.avatar_preset,u.avatar_path,u.avatar_revision FROM activities a JOIN users u ON u.id=a.actor_id WHERE a.recipient_id=? AND a.id<? AND ${visibleTo(uid, "a.actor_id")} ORDER BY a.id DESC LIMIT 31`,
      [uid, before],
    );
    const [n] = await query(
      `SELECT COUNT(*) AS unread FROM activities a WHERE a.recipient_id=? AND a.is_read=FALSE AND ${visibleTo(uid, "a.actor_id")}`,
      [uid],
    );
    res.json({
      unread: Number(n.unread),
      items: rows.slice(0, 30).map((a) => ({
        id: a.id,
        kind: a.kind,
        postId: a.post_id,
        read: !!a.is_read,
        createdAt: a.created_at,
        actor: publicUser({ ...a, id: a.actor_id }),
      })),
      nextBefore: rows.length > 30 ? rows[29].id : null,
    });
  });
  app.post("/api/activities/read", async (req, res) => {
    let update;
    if (req.body?.ids !== undefined) {
      if (
        !Array.isArray(req.body.ids) ||
        !req.body.ids.length ||
        req.body.ids.length > 30
      )
        throw new HttpError(400, "Choose up to 30 notifications.");
      const ids = [...new Set(req.body.ids.map(id))];
      await query(
        `UPDATE activities SET is_read=TRUE WHERE recipient_id=? AND id IN (${ids.map(() => "?").join(",")})`,
        [req.auth.user.id, ...ids],
      );
      update = { ids };
    } else {
      const through = id(req.body?.through);
      await query(
        "UPDATE activities SET is_read=TRUE WHERE recipient_id=? AND id<=?",
        [req.auth.user.id, through],
      );
      update = { through };
    }
    io.to(`user:${req.auth.user.id}`).emit("activity:read", update);
    res.sendStatus(204);
  });
}
