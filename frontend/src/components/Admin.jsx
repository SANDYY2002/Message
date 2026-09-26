import { useEffect, useState } from "react";
import { api, post } from "../api";
export default function Admin() {
  const [status, setStatus] = useState(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState("users"),
    [users, setUsers] = useState([]),
    [search, setSearch] = useState(""),
    [person, setPerson] = useState(null),
    [tab, setTab] = useState("profile"),
    [rows, setRows] = useState([]),
    [conversation, setConversation] = useState(null),
    [messages, setMessages] = useState([]),
    [queue, setQueue] = useState({ posts: [], comments: [], reports: [] });
  async function check() {
    const d = await api("/admin/status");
    setStatus(d);
    return d;
  }
  useEffect(() => {
    check().catch((e) => setError(e.message));
    const timer = setInterval(
      () => check().catch(() => setStatus(null)),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      await check().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (page === "users") {
      const d = await api("/admin/users?search=" + encodeURIComponent(search));
      setUsers(d.users);
    } else if (page === "moderation") setQueue(await api("/admin/moderation"));
    else setRows((await api("/admin/audit")).rows);
  }
  useEffect(() => {
    if (status?.unlocked) act(load);
    else {
      setRows([]);
      setUsers([]);
      setMessages([]);
      setQueue({ posts: [], comments: [], reports: [] });
      setPerson(null);
    }
  }, [status?.unlocked, page]);
  async function userTab(u, t) {
    setPerson(u);
    setTab(t);
    setConversation(null);
    setRows((await api(`/admin/users/${u.id}/${t}`)).rows);
  }
  async function chat(cid, before) {
    setConversation(cid);
    const d = await api(
      `/admin/conversations/${cid}` + (before ? `?before=${before}` : ""),
    );
    setMessages((m) => (before ? [...m, ...d.messages] : d.messages));
  }
  return (
    <section className="community-page">
      <header className="social-header">
        <div>
          <span className="small-label">ACCOUNTABILITY BY DESIGN</span>
          <h1>Administration</h1>
          <p>Sensitive access is recorded in the audit log.</p>
        </div>
        {status?.unlocked && (
          <button
            onClick={() =>
              act(async () => {
                await api("/admin/unlock", { method: "DELETE" });
                await check();
              })
            }
          >
            Lock admin
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p>Checking access…</p>
      ) : !status.eligible ? (
        <p>Administrator access has not been configured for this account.</p>
      ) : !status.unlocked ? (
        <form
          className="community-card"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              try {
                await post("/admin/unlock", { password, code });
                await check();
              } finally {
                setPassword("");
                setCode("");
              }
            });
          }}
        >
          <h2>Verify it’s you</h2>
          <p>
            Access expires after 15 minutes. Enter a fresh authenticator code
            each time.
          </p>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>Unlock admin access</button>
        </form>
      ) : (
        <>
          <div className="community-actions">
            {["users", "moderation", "audit"].map((p) => (
              <button
                key={p}
                aria-pressed={page === p}
                onClick={() => {
                  setPerson(null);
                  setPage(p);
                }}
              >
                {p}
              </button>
            ))}
            <button disabled={busy} onClick={() => act(load)}>
              Refresh
            </button>
          </div>
          {page === "users" ? (
            <>
              <form
                className="community-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(load);
                }}
              >
                <input
                  aria-label="Find user"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search username or name"
                />
                <button disabled={busy}>Search users</button>
              </form>
              <div className="admin-user-list">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => act(() => userTab(u, "profile"))}
                  >
                    {u.displayName} <small>@{u.username}</small>
                  </button>
                ))}
              </div>
              {users.length === 50 && (
                <button
                  onClick={() =>
                    act(async () => {
                      const d = await api(
                        `/admin/users?before=${users.at(-1).id}&search=${encodeURIComponent(search)}`,
                      );
                      setUsers(d.users);
                    })
                  }
                >
                  Next users
                </button>
              )}
              {person && (
                <div className="community-card">
                  <h2>@{person.username}</h2>
                  <div className="community-actions">
                    {[
                      "profile",
                      "posts",
                      "confessions",
                      "comments",
                      "messages",
                      "followers",
                      "following",
                      "blocks",
                    ].map((t) => (
                      <button
                        key={t}
                        aria-pressed={tab === t}
                        onClick={() => act(() => userTab(person, t))}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {conversation ? (
                    <>
                      <button onClick={() => setConversation(null)}>
                        Back to conversations
                      </button>
                      <p className="privacy-notice">
                        Private message access is audited.
                      </p>
                      {messages.map((m) => (
                        <article className="confession-comment" key={m.id}>
                          <strong>@{m.username}</strong>
                          <small>
                            {" "}
                            · {new Date(m.createdAt).toLocaleString()}
                          </small>
                          <p>{m.deleted ? "Message deleted" : m.text}</p>
                          {m.media &&
                            (m.media.mime.startsWith("video/") ? (
                              <video controls src={m.media.url} />
                            ) : (
                              <img src={m.media.url} alt="Shared media" />
                            ))}
                        </article>
                      ))}
                      {messages.length > 0 && messages.length % 50 === 0 && (
                        <button
                          onClick={() =>
                            act(() => chat(conversation, messages.at(-1).id))
                          }
                        >
                          Older messages
                        </button>
                      )}
                    </>
                  ) : (
                    rows.map((r, i) => (
                      <article className="confession-comment" key={r.id || i}>
                        {tab === "messages" ? (
                          <button onClick={() => act(() => chat(r.id))}>
                            Open{" "}
                            {r.kind === "group"
                              ? r.name
                              : `conversation #${r.id}`}{" "}
                            · {r.request_status}
                          </button>
                        ) : (
                          <>
                            <dl>
                              {Object.entries(r)
                                .filter(
                                  ([k]) =>
                                    !["avatarUrl", "avatarPreset"].includes(k),
                                )
                                .map(([k, v]) => (
                                  <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>{String(v ?? "—")}</dd>
                                  </div>
                                ))}
                            </dl>
                            {tab === "confessions" && (
                              <a
                                href={`/api/admin/media/confessions/${r.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open attachment, if present
                              </a>
                            )}
                          </>
                        )}
                      </article>
                    ))
                  )}
                </div>
              )}
            </>
          ) : page === "moderation" ? (
            <>
              {!queue.posts.length && !queue.comments.length && (
                <p className="community-card">Nothing waiting for review.</p>
              )}
              {["posts", "comments"].flatMap((kind) =>
                queue[kind].map((p) => (
                  <article className="community-card" key={kind + p.id}>
                    <strong>
                      {kind === "posts" ? "Confession" : "Comment"} #{p.id} · @
                      {p.username}
                    </strong>
                    <p>{p.text}</p>
                    {p.has_media &&
                      (p.media_mime.startsWith("video/") ? (
                        <video
                          controls
                          src={`/api/admin/media/confessions/${p.id}`}
                        />
                      ) : (
                        <img
                          src={`/api/admin/media/confessions/${p.id}`}
                          alt="Review attachment"
                        />
                      ))}
                    {queue.reports
                      .filter((r) => kind === "posts" && r.post_id === p.id)
                      .map((r) => (
                        <p key={r.id}>Report: {r.reason}</p>
                      ))}
                    <div className="community-actions">
                      {["published", "rejected"].map((s) => (
                        <button
                          disabled={busy}
                          key={s}
                          onClick={() =>
                            act(async () => {
                              await post(`/admin/moderation/${kind}/${p.id}`, {
                                status: s,
                              });
                              await load();
                            })
                          }
                        >
                          {s === "published" ? "Approve" : "Reject"}
                        </button>
                      ))}
                    </div>
                  </article>
                )),
              )}
            </>
          ) : (
            <div className="community-card">
              {rows.map((r) => (
                <p key={r.id}>
                  <strong>{r.action}</strong> · @{r.username || r.admin_id} ·{" "}
                  {r.target_id || "—"} ·{" "}
                  {new Date(r.created_at).toLocaleString()}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
