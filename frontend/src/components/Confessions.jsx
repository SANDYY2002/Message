import { useEffect, useState } from "react";
import { Heart, MessageCircle, VenetianMask, RefreshCw } from "lucide-react";
import { api, post } from "../api";
import { useConfirm } from "./ConfirmDialog";
export default function Confessions() {
  const [posts, setPosts] = useState([]),
    [more, setMore] = useState(false),
    [text, setText] = useState(""),
    [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const confirm = useConfirm();
  async function load(append = false) {
    const d = await api(
      "/confessions" +
        (append && posts.length ? `?before=${posts.at(-1).id}` : ""),
    );
    setPosts((p) => (append ? [...p, ...d.posts] : d.posts));
    setMore(d.hasMore);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="community-page">
      <header className="social-header">
        <div>
          <span className="small-label">A LITTLE LESS FILTERED</span>
          <h1>
            <VenetianMask /> Confessions
          </h1>
          <p>Share what’s on your mind. Leave your name behind.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh confessions"
          onClick={() => action(() => load())}
        >
          <RefreshCw />
        </button>
      </header>
      <aside className="privacy-notice">
        Your identity is hidden from other users. Superadmins can identify
        confession authors and anonymous commenters. Photos, videos and details
        you share may reveal your identity. Flagged text waits for review.
      </aside>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        className="community-card post-composer"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          action(async () => {
            const body = new FormData();
            body.append("text", text);
            if (file) body.append("file", file);
            const d = await api("/confessions", { method: "POST", body });
            setNotice(
              d.post.status === "pending"
                ? "Submitted for admin review. Only you can see it until approved."
                : "Your confession is published.",
            );
            setText("");
            setFile(null);
            form.reset();
          });
        }}
      >
        <label htmlFor="confession-text">Your anonymous confession</label>
        <textarea
          id="confession-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="Something you’ve been wanting to say…"
        />
        <div className="community-actions">
          <label className="attachment-label">
            Photo or video
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
              onChange={(e) => setFile(e.target.files[0] || null)}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || (!text.trim() && !file)}
          >
            {busy ? "Publishing…" : "Publish anonymously"}
          </button>
        </div>
      </form>
      {!posts.length && (
        <div className="community-card">
          <h2>A quiet corner, for now</h2>
          <p>Be the first to share a confession.</p>
        </div>
      )}
      {posts.map((p) => (
        <article className="community-card" key={p.id}>
          <header className="community-actions">
            <div>
              <strong>Anonymous</strong>
              <small> · {new Date(p.createdAt).toLocaleString()}</small>
              {p.isOwner && (
                <span className="status-pill">Your confession</span>
              )}
              {p.status !== "published" && (
                <span className="status-pill">
                  {p.status === "pending" ? "Awaiting review" : "Not approved"}
                </span>
              )}
            </div>
            {p.isOwner && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Delete confession?",
                      description:
                        "This removes the confession, comments and attachment permanently.",
                      confirmLabel: "Delete confession",
                    })
                  )
                    action(() =>
                      api(`/confessions/${p.id}`, { method: "DELETE" }),
                    );
                }}
              >
                Delete
              </button>
            )}
          </header>
          <p className="post-text">{p.text}</p>
          {p.media &&
            (p.media.mime.startsWith("video/") ? (
              <video controls preload="metadata" src={p.media.url} />
            ) : (
              <img
                loading="lazy"
                src={p.media.url}
                alt="Confession attachment"
              />
            ))}
          {p.status === "published" && (
            <>
              <div className="community-actions">
                <button
                  disabled={busy}
                  aria-pressed={p.liked}
                  onClick={() =>
                    action(() =>
                      api(`/confessions/${p.id}/like`, {
                        method: p.liked ? "DELETE" : "PUT",
                      }),
                    )
                  }
                >
                  <Heart size={17} /> {p.likes} {p.liked ? "Liked" : "Like"}
                </button>
                <span>
                  <MessageCircle size={16} /> {p.comments} comments
                </span>
              </div>
              <Comments pid={p.id} onChange={load} />
              <Report pid={p.id} />
            </>
          )}
        </article>
      ))}
      {more && (
        <button
          disabled={busy}
          onClick={() => load(true).catch((e) => setError(e.message))}
        >
          Load more confessions
        </button>
      )}
    </section>
  );
}
function Comments({ pid, onChange }) {
  const [open, setOpen] = useState(false),
    [comments, setComments] = useState([]),
    [more, setMore] = useState(false),
    [text, setText] = useState(""),
    [anonymous, setAnonymous] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const confirm = useConfirm();
  async function load(append = false) {
    const d = await api(
      `/confessions/${pid}/comments` +
        (append && comments.length ? `?before=${comments.at(-1).id}` : ""),
    );
    setComments((c) => (append ? [...c, ...d.comments] : d.comments));
    setMore(d.hasMore);
  }
  async function act(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      await onChange();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="confession-comments">
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) act(() => load());
        }}
      >
        {open ? "Hide comments" : "Read and write comments"}
      </button>
      {open && (
        <>
          <p role="status">{notice}</p>
          {comments.map((c) => (
            <div className="confession-comment" key={c.id}>
              <strong>
                {c.anonymous ? "Anonymous" : `@${c.author.username}`}
              </strong>
              {c.status !== "published" && <small> · {c.status}</small>}
              <p>{c.text}</p>
              {c.isOwner && (
                <button
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Delete comment?",
                        description: "This permanently removes your comment.",
                        confirmLabel: "Delete comment",
                      })
                    )
                      act(() =>
                        api(`/confession-comments/${c.id}`, {
                          method: "DELETE",
                        }),
                      );
                  }}
                >
                  Delete comment
                </button>
              )}
            </div>
          ))}
          {more && (
            <button
              onClick={() => load(true).catch((e) => setNotice(e.message))}
            >
              Older comments
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const d = await post(`/confessions/${pid}/comments`, {
                  text,
                  anonymous,
                });
                setText("");
                setNotice(
                  d.status === "pending"
                    ? "Your comment is awaiting review."
                    : "Comment added.",
                );
              });
            }}
          >
            <textarea
              aria-label="Confession comment"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              required
              placeholder="Add a kind thought…"
            />
            <label>
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />{" "}
              Comment anonymously
            </label>
            <button disabled={busy || !text.trim()}>Post comment</button>
          </form>
        </>
      )}
    </div>
  );
}
function Report({ pid }) {
  const [reason, setReason] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Report this confession</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/confessions/${pid}/report`, { reason });
            setNotice("Report sent to the moderation team.");
            setReason("");
          } catch (e) {
            setNotice(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          What should we review?
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
        </label>
        <button disabled={busy}>Send report</button>
        <p role="status">{notice}</p>
      </form>
    </details>
  );
}
