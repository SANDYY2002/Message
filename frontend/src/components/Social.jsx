import { useEffect, useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  Share2,
  Send,
  Trash2,
  UserPlus,
  Ban,
  ArrowLeft,
} from "lucide-react";
import { api, post } from "../api";
import { presetImage } from "./Profile";
function Face({ user }) {
  const src = user.avatarUrl || presetImage(user.avatarPreset);
  return (
    <span className="avatar">
      {src ? <img src={src} alt="" /> : user.displayName.slice(0, 1)}
    </span>
  );
}
const date = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function Social({
  page,
  user,
  socket,
  onMessage,
  onActivityCount,
  focusPost,
  onClearPost,
}) {
  const loadSequence = useRef(0);
  const [posts, setPosts] = useState([]),
    [people, setPeople] = useState([]),
    [activities, setActivities] = useState([]),
    [blocks, setBlocks] = useState([]);
  const [mode, setMode] = useState("all"),
    [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [next, setNext] = useState(null);
  const [comments, setComments] = useState({}),
    [commentDrafts, setCommentDrafts] = useState({});
  async function load(more = false) {
    const seq = ++loadSequence.current;
    const suffix = more && next ? `&before=${next}` : "";
    if (page === "activity") {
      const d = await api(`/activities?${suffix}`);
      if (seq !== loadSequence.current) return;
      setActivities((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextBefore);
      onActivityCount(d.unread);
    } else if (focusPost) {
      const d = await api(`/posts/${focusPost}`);
      if (seq !== loadSequence.current) return;
      setPosts([d.post]);
      setNext(null);
    } else {
      const d = await api(`/posts?mode=${mode}${suffix}`);
      if (seq !== loadSequence.current) return;
      setPosts((old) => (more ? [...old, ...d.posts] : d.posts));
      setNext(d.nextBefore);
    }
    setLoading(false);
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setComments({});
    setNext(null);
    load().catch((e) => {
      if (alive) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      loadSequence.current++;
    };
  }, [page, mode, focusPost]);
  useEffect(() => {
    const changed = () => {
      load().catch((e) => setError(e.message));
      api(`/people?q=${encodeURIComponent(search)}`)
        .then((d) => setPeople(d.users))
        .catch(() => {});
    };
    const relationships = () => {
      setComments({});
      setPosts([]);
      setPeople([]);
      changed();
    };
    socket?.on("social:changed", changed);
    socket?.on("relationships:changed", relationships);
    socket?.on("activity:new", changed);
    socket?.on("activity:read", changed);
    return () => {
      socket?.off("social:changed", changed);
      socket?.off("relationships:changed", relationships);
      socket?.off("activity:new", changed);
      socket?.off("activity:read", changed);
    };
  }, [socket, page, mode, focusPost]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        api(`/people?q=${encodeURIComponent(search)}`)
          .then((d) => {
            if (alive) setPeople(d.users);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, page]);
  async function act(fn, message = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      const d = await api(`/people?q=${encodeURIComponent(search)}`);
      setPeople(d.users);
      setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const change = (path, method) => api(path, { method });
  async function block(person) {
    if (
      !window.confirm(
        `Block @${person.username}? You will no longer see or interact with each other's posts and messages.`,
      )
    )
      return;
    await act(() => change(`/blocks/${person.id}`, "PUT"), "User blocked.");
    setComments({});
  }
  async function openComments(pid, more = false) {
    const d = await api(
      `/posts/${pid}/comments${more && comments[pid]?.nextBefore ? `?before=${comments[pid].nextBefore}` : ""}`,
    );
    setComments((old) => ({
      ...old,
      [pid]: {
        ...d,
        comments: more ? [...old[pid].comments, ...d.comments] : d.comments,
      },
    }));
  }
  return (
    <section
      className="social-page"
      aria-label={
        page === "home" ? "Home" : page === "posts" ? "Posts" : "Activity"
      }
    >
      <header className="social-header">
        <div>
          <span className="small-label">YOUR COMMUNITY</span>
          <h1>
            {page === "home" ? "Home" : page === "posts" ? "Posts" : "Activity"}
          </h1>
        </div>
        <span className="social-greeting">Hi, {user.displayName}</span>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="social-notice" role="status">
          {notice}
        </p>
      )}
      <div className="social-layout">
        <div className="feed">
          {page !== "activity" && (
            <>
              <form
                className="post-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await post("/posts", { text: draft });
                    setDraft("");
                    if (focusPost) onClearPost();
                  }, "Post published.");
                }}
              >
                <div className="post-author">
                  <Face user={user} />
                  <div>
                    <strong>{user.displayName}</strong>
                    <small>Share with the community</small>
                  </div>
                </div>
                <textarea
                  aria-label="Write a post"
                  placeholder="What's on your mind?"
                  maxLength={4000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  required
                  disabled={busy}
                />
                <footer>
                  <small>
                    {draft.length}/4000 · Visible to signed-in users
                  </small>
                  <button className="primary" disabled={busy || !draft.trim()}>
                    <Send size={16} />
                    Publish post
                  </button>
                </footer>
              </form>
              {focusPost ? (
                <button className="text-button" onClick={onClearPost}>
                  <ArrowLeft size={16} />
                  Back to feed
                </button>
              ) : (
                <div className="feed-filters" aria-label="Post filters">
                  {[
                    ["all", "Everyone"],
                    ["following", "Following"],
                    ["mine", "My posts"],
                    ["saved", "Saved"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {loading ? (
            <p className="empty-small">Loading…</p>
          ) : page === "activity" ? (
            <>
              <button
                className="text-button"
                disabled={!activities.length || busy}
                onClick={() =>
                  act(
                    () =>
                      post("/activities/read", { through: activities[0].id }),
                    "Marked as read.",
                  )
                }
              >
                Mark all shown as read
              </button>
              {!activities.length && (
                <div className="social-empty">
                  <h2>You're all caught up</h2>
                  <p>
                    New follows, likes, comments and reposts will appear here.
                  </p>
                </div>
              )}
              {activities.map((a) => (
                <article
                  key={a.id}
                  className={`activity-card ${a.read ? "" : "unread"}`}
                >
                  <Face user={a.actor} />
                  <div>
                    <strong>{a.actor.displayName}</strong>
                    <p>
                      {
                        {
                          follow: "started following you",
                          like: "liked your post",
                          comment: "commented on your post",
                          repost: "reposted your post",
                        }[a.kind]
                      }
                    </p>
                    <small>{date(a.createdAt)}</small>
                  </div>
                  {a.postId && (
                    <button onClick={() => onClearPost(a.postId)}>
                      View post
                    </button>
                  )}
                </article>
              ))}
            </>
          ) : (
            <>
              {!posts.length && (
                <div className="social-empty">
                  <h2>
                    {mode === "following"
                      ? "Build your circle"
                      : "A new conversation starts here"}
                  </h2>
                  <p>
                    {mode === "following"
                      ? "Follow people to see their posts here."
                      : "Publish a post or explore another feed."}
                  </p>
                </div>
              )}
              {posts.map((item) => {
                const p = item.original || item;
                return (
                  <article
                    className="post-card"
                    key={item.id}
                    data-post-id={p.id}
                  >
                    {item.original && (
                      <div className="repost-label">
                        <Repeat2 size={14} />
                        {item.author.displayName} reposted{" "}
                        {item.author.id === user.id && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              act(
                                () => change(`/posts/${p.id}/repost`, "DELETE"),
                                "Repost removed.",
                              )
                            }
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    )}
                    <header className="post-author">
                      <Face user={p.author} />
                      <div>
                        <strong>{p.author.displayName}</strong>
                        <small>
                          @{p.author.username} · {date(p.createdAt)}
                        </small>
                      </div>
                      {p.author.id !== user.id ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              change(
                                `/people/${p.author.id}/follow`,
                                p.following ? "DELETE" : "PUT",
                              ),
                            )
                          }
                        >
                          {p.following ? "Following" : "Follow"}
                        </button>
                      ) : (
                        <button
                          aria-label="Delete post"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Delete this post and its comments?",
                              )
                            )
                              act(
                                () => change(`/posts/${p.id}`, "DELETE"),
                                "Post deleted.",
                              );
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </header>
                    <p className="post-text">{p.text}</p>
                    <div className="post-actions">
                      <button
                        aria-label="Like post"
                        aria-pressed={!!p.liked}
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            change(
                              `/posts/${p.id}/like`,
                              p.liked ? "DELETE" : "PUT",
                            ),
                          )
                        }
                      >
                        <Heart size={18} />
                        {p.likes}
                      </button>
                      <button
                        aria-label="Comments"
                        aria-expanded={!!comments[p.id]}
                        onClick={() =>
                          comments[p.id]
                            ? setComments((old) => ({ ...old, [p.id]: null }))
                            : openComments(p.id).catch((e) =>
                                setError(e.message),
                              )
                        }
                      >
                        <MessageCircle size={18} />
                        {p.comments}
                      </button>
                      <button
                        aria-label="Repost"
                        aria-pressed={!!p.reposted}
                        disabled={busy}
                        onClick={() =>
                          act(
                            () =>
                              change(
                                `/posts/${p.id}/repost`,
                                p.reposted ? "DELETE" : "POST",
                              ),
                            p.reposted
                              ? "Repost removed."
                              : "Post shared with the community.",
                          )
                        }
                      >
                        <Repeat2 size={18} />
                        {p.reposts}
                      </button>
                      <button
                        aria-label="Save post"
                        aria-pressed={!!p.bookmarked}
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            change(
                              `/posts/${p.id}/bookmark`,
                              p.bookmarked ? "DELETE" : "PUT",
                            ),
                          )
                        }
                      >
                        <Bookmark size={18} />
                      </button>
                      <button
                        aria-label="Copy post link"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `${location.origin}/?post=${p.id}`,
                            );
                            setNotice("Post link copied.");
                          } catch {
                            setNotice(
                              `Post link: ${location.origin}/?post=${p.id}`,
                            );
                          }
                        }}
                      >
                        <Share2 size={18} />
                      </button>
                      {p.author.id !== user.id && (
                        <button
                          aria-label={`Block ${p.author.username}`}
                          disabled={busy}
                          onClick={() => block(p.author)}
                        >
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                    {comments[p.id] && (
                      <section className="post-comments">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            act(async () => {
                              await post(`/posts/${p.id}/comments`, {
                                text: commentDrafts[p.id],
                              });
                              setCommentDrafts((old) => ({
                                ...old,
                                [p.id]: "",
                              }));
                              await openComments(p.id);
                            }, "Comment added.");
                          }}
                        >
                          <input
                            aria-label="Write a comment"
                            maxLength={1000}
                            value={commentDrafts[p.id] || ""}
                            onChange={(e) =>
                              setCommentDrafts((old) => ({
                                ...old,
                                [p.id]: e.target.value,
                              }))
                            }
                            required
                          />
                          <button
                            disabled={busy || !commentDrafts[p.id]?.trim()}
                          >
                            Comment
                          </button>
                        </form>
                        {comments[p.id].comments.map((c) => (
                          <div className="comment" key={c.id}>
                            <strong>{c.author.displayName}</strong>
                            <p>{c.text}</p>
                            {c.author.id === user.id && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  act(async () => {
                                    await change(`/comments/${c.id}`, "DELETE");
                                    await openComments(p.id);
                                  })
                                }
                              >
                                Delete comment
                              </button>
                            )}
                          </div>
                        ))}
                        {comments[p.id].nextBefore && (
                          <button
                            onClick={() =>
                              openComments(p.id, true).catch((e) =>
                                setError(e.message),
                              )
                            }
                          >
                            Older comments
                          </button>
                        )}
                      </section>
                    )}
                  </article>
                );
              })}
            </>
          )}
          {next && (
            <button
              className="load-older"
              disabled={busy}
              onClick={() => load(true).catch((e) => setError(e.message))}
            >
              Load more
            </button>
          )}
        </div>
        <aside className="people-panel">
          <h2>Find your people</h2>
          <p>Follow someone new or start a conversation.</p>
          <input
            aria-label="Find people"
            placeholder="Search name or username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {people.map((p) => (
            <div className="person-card" key={p.id}>
              <div className="post-author">
                <Face user={p} />
                <div>
                  <strong>{p.displayName}</strong>
                  <small>
                    @{p.username} · {p.followers} followers
                  </small>
                </div>
              </div>
              <div className="person-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      change(
                        `/people/${p.id}/follow`,
                        p.following ? "DELETE" : "PUT",
                      ),
                    )
                  }
                >
                  <UserPlus size={14} />
                  {p.following ? "Following" : "Follow"}
                </button>
                <button disabled={busy} onClick={() => onMessage(p.id)}>
                  Message
                </button>
                <button
                  aria-label={`Block ${p.username}`}
                  disabled={busy}
                  onClick={() => block(p)}
                >
                  <Ban size={14} />
                </button>
              </div>
            </div>
          ))}
          {!people.length && <p>No people found.</p>}
          <details
            onToggle={(e) => {
              if (e.currentTarget.open)
                api("/blocks")
                  .then((d) => setBlocks(d.users))
                  .catch((e) => setError(e.message));
            }}
          >
            <summary>Blocked users</summary>
            {blocks.map((p) => (
              <div className="person-card" key={p.id}>
                <span>@{p.username}</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await change(`/blocks/${p.id}`, "DELETE");
                      setBlocks((old) => old.filter((x) => x.id !== p.id));
                    }, "User unblocked. Following is not restored automatically.")
                  }
                >
                  Unblock
                </button>
              </div>
            ))}
            {!blocks.length && <p>No blocked users.</p>}
          </details>
        </aside>
      </div>
    </section>
  );
}
