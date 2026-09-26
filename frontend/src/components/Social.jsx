import { useConfirm } from "./ConfirmDialog";
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
import { useViewedActivities } from "../useViewedActivities";
import { presetImage } from "./Profile";
const followLabel = (p) =>
  p.following ? "Unfollow" : p.followsYou ? "Follow Back" : "Follow";
function Face({ user, onClick }) {
  const src = user.avatarUrl || presetImage(user.avatarPreset);
  return (
    <button
      type="button"
      className="avatar profile-face"
      onClick={onClick}
      aria-label={`View @${user.username} profile`}
    >
      {src ? <img src={src} alt="" /> : user.displayName.slice(0, 1)}
    </button>
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
  focusProfile,
  onProfile,
  onCloseProfile,
}) {
  const confirm = useConfirm();
  const root = useRef(null);
  const [profile, setProfile] = useState(null);
  const [connections, setConnections] = useState(null);
  const loadSequence = useRef(0);
  const [posts, setPosts] = useState([]),
    [people, setPeople] = useState([]),
    [activities, setActivities] = useState([]);
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
  useViewedActivities(
    activities,
    page === "activity",
    setActivities,
    onActivityCount,
    root,
  );
  async function showConnections(kind, more = false) {
    const d = await api(
      `/people/${focusProfile}/connections?kind=${kind}${more && connections?.nextBefore ? `&before=${connections.nextBefore}` : ""}`,
    );
    setConnections((old) => ({
      ...d,
      kind,
      users: more ? [...old.users, ...d.users] : d.users,
    }));
  }
  async function load(more = false) {
    const seq = ++loadSequence.current;
    const suffix = more && next ? `&before=${next}` : "";
    if (page === "activity") {
      const d = await api(`/activities?${suffix}`);
      if (seq !== loadSequence.current) return;
      setActivities((old) => (more ? [...old, ...d.items] : d.items));
      setNext(d.nextBefore);
      onActivityCount(d.unread);
    } else if (focusProfile) {
      const [d, p] = await Promise.all([
        api(`/posts?author=${focusProfile}${suffix}`),
        api(`/people/${focusProfile}`),
      ]);
      if (seq !== loadSequence.current) return;
      setProfile(p.profile);
      setPosts((old) => (more ? [...old, ...d.posts] : d.posts));
      setNext(d.nextBefore);
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
    setProfile(null);
    setConnections(null);
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
  }, [page, mode, focusPost, focusProfile]);
  useEffect(() => {
    const changed = () => {
      load().catch((e) => setError(e.message));
      api(`/people?q=${encodeURIComponent(search)}`)
        .then((d) => setPeople(d.users))
        .catch(() => {});
    };
    const relationships = () => {
      setProfile(null);
      setConnections(null);
      setComments({});
      setPosts([]);
      setPeople([]);
      changed();
    };
    const read = ({ ids, through }) => {
      setActivities((old) =>
        old.map((a) =>
          (ids ? ids.includes(a.id) : a.id <= through)
            ? { ...a, read: true }
            : a,
        ),
      );
      api("/activities")
        .then((d) => onActivityCount(d.unread))
        .catch(() => {});
    };
    socket?.on("user:updated", changed);
    socket?.on("social:changed", changed);
    socket?.on("relationships:changed", relationships);
    socket?.on("activity:new", changed);
    socket?.on("activity:read", read);
    return () => {
      socket?.off("user:updated", changed);
      socket?.off("social:changed", changed);
      socket?.off("relationships:changed", relationships);
      socket?.off("activity:new", changed);
      socket?.off("activity:read", read);
    };
  }, [socket, page, mode, focusPost, focusProfile, search]);
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
      if (connections) await showConnections(connections.kind);
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
      !(await confirm({
        title: `Block @${person.username}?`,
        description:
          "This stops new messages, calls and social interactions. Existing chats remain readable. You can unblock them from Settings.",
        confirmLabel: "Block user",
      }))
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
      ref={root}
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
          {focusProfile && page !== "activity" && (
            <>
              <button className="text-button" onClick={onCloseProfile}>
                <ArrowLeft size={16} />
                Back to feed
              </button>
              {profile && (
                <section className="public-profile" aria-label="User profile">
                  <div className="profile-cover" />
                  <div className="profile-body">
                    <Face user={profile} />
                    <h2>{profile.displayName}</h2>
                    <p className="profile-handle">@{profile.username}</p>
                    <p className="profile-bio">
                      {profile.bio || "No bio yet."}
                    </p>
                    <div className="profile-stats">
                      <span>
                        <strong>{profile.postCount}</strong> Posts
                      </span>
                      <button
                        onClick={() =>
                          showConnections("followers").catch((e) =>
                            setError(e.message),
                          )
                        }
                      >
                        <strong>{profile.followers}</strong> Followers
                      </button>
                      <button
                        onClick={() =>
                          showConnections("following").catch((e) =>
                            setError(e.message),
                          )
                        }
                      >
                        <strong>{profile.followingCount}</strong> Following
                      </button>
                    </div>
                    {profile.id !== user.id && (
                      <div className="profile-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              change(
                                `/people/${profile.id}/follow`,
                                profile.following ? "DELETE" : "PUT",
                              ),
                            )
                          }
                        >
                          {followLabel(profile)}
                        </button>
                        <button
                          className="secondary"
                          onClick={() => onMessage(profile.id)}
                        >
                          Message
                        </button>
                      </div>
                    )}
                  </div>
                  {connections && (
                    <section
                      className="profile-connections"
                      aria-label={connections.kind}
                    >
                      <header>
                        <h3>
                          {connections.kind === "followers"
                            ? "Followers"
                            : "Following"}
                        </h3>
                        <button onClick={() => setConnections(null)}>
                          Close
                        </button>
                      </header>
                      {!connections.users.length && <p>No people yet.</p>}
                      {connections.users.map((p) => (
                        <div className="connection-row" key={p.id}>
                          <Face user={p} onClick={() => onProfile(p.id)} />
                          <button
                            className="profile-link"
                            onClick={() => onProfile(p.id)}
                          >
                            {p.displayName}
                            <small>@{p.username}</small>
                          </button>
                          {p.id !== user.id && (
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
                              {followLabel(p)}
                            </button>
                          )}
                        </div>
                      ))}
                      {connections.nextBefore && (
                        <button
                          onClick={() =>
                            showConnections(connections.kind, true).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          More people
                        </button>
                      )}
                    </section>
                  )}
                </section>
              )}
            </>
          )}

          {page !== "activity" && !focusProfile && (
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
                  <Face user={user} onClick={() => onProfile(user.id)} />
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
                  data-activity-id={a.id}
                  key={a.id}
                  className={`activity-card ${a.read ? "" : "unread"}`}
                >
                  <Face user={a.actor} onClick={() => onProfile(a.actor.id)} />
                  <div>
                    <button
                      className="profile-link"
                      onClick={() => onProfile(a.actor.id)}
                    >
                      <strong>{a.actor.displayName}</strong>
                    </button>
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
                        <button
                          className="profile-link"
                          onClick={() => onProfile(item.author.id)}
                        >
                          {item.author.displayName}
                        </button>{" "}
                        reposted{" "}
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
                      <Face
                        user={p.author}
                        onClick={() => onProfile(p.author.id)}
                      />
                      <div>
                        <button
                          className="profile-link"
                          onClick={() => onProfile(p.author.id)}
                        >
                          <strong>{p.author.displayName}</strong>
                        </button>
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
                          {followLabel(p)}
                        </button>
                      ) : (
                        <button
                          aria-label="Delete post"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "Delete this post?",
                                description:
                                  "This permanently removes the post, its comments and reposts. This cannot be undone.",
                                confirmLabel: "Delete post",
                              })
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
                            <button
                              className="profile-link"
                              onClick={() => onProfile(c.author.id)}
                            >
                              <strong>{c.author.displayName}</strong>
                            </button>
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
                <Face user={p} onClick={() => onProfile(p.id)} />
                <div>
                  <button
                    className="profile-link"
                    onClick={() => onProfile(p.id)}
                  >
                    <strong>{p.displayName}</strong>
                  </button>
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
                  {followLabel(p)}
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
          <p className="group-help">Manage blocked users in Settings.</p>
        </aside>
      </div>
    </section>
  );
}
