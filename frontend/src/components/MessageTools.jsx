import { useEffect, useRef, useState, useId } from "react";
import {
  Check,
  CheckCheck,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";

const time = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function MessageBubble({
  message: m,
  mine,
  readId,
  showSender,
  onPreview,
  onImageLoad,
  onEdit,
  onDelete,
}) {
  return (
    <div
      className={`message-row ${mine ? "mine" : "theirs"}`}
      data-message-id={m.id}
    >
      <div className="message-bubble">
        {showSender && !mine && (
          <strong className="group-sender">{m.senderName || "Member"}</strong>
        )}
        {m.deletedAt ? (
          <p className="deleted-message">Message deleted</p>
        ) : (
          <>
            {m.media &&
              (m.media.mime.startsWith("image/") ? (
                onPreview ? (
                  <button
                    className="image-message"
                    onClick={() => onPreview(m.media)}
                    aria-label={`View ${m.media.name}`}
                  >
                    <img
                      src={m.media.url}
                      alt={m.media.name}
                      loading="lazy"
                      onLoad={onImageLoad}
                    />
                  </button>
                ) : (
                  <img
                    className="search-image"
                    src={m.media.url}
                    alt={m.media.name}
                    loading="lazy"
                  />
                )
              ) : (
                <video
                  controls
                  preload="metadata"
                  src={m.media.url}
                  aria-label={m.media.name}
                />
              ))}
            {m.text && <p>{m.text}</p>}
          </>
        )}
        <div className="message-meta">
          {m.editedAt && !m.deletedAt && (
            <span
              className="edited-label"
              title={`Edited ${new Date(m.editedAt).toLocaleString()}`}
            >
              Edited
            </span>
          )}
          <time>{time(m.createdAt)}</time>
          {mine &&
            !m.deletedAt &&
            (readId >= m.id ? (
              <CheckCheck
                size={15}
                aria-label="Read"
                className="read-receipt"
              />
            ) : (
              <Check size={14} aria-label="Sent" />
            ))}
        </div>
      </div>
      {mine && !m.deletedAt && onEdit && (
        <div className="message-actions">
          <button
            aria-label="Edit message"
            title="Edit message"
            onClick={() => onEdit(m)}
          >
            <Pencil size={14} />
          </button>
          <button
            aria-label="Delete message"
            title="Delete message"
            onClick={() => onDelete(m)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  onClose,
  busy = false,
  children,
  className = "",
}) {
  const ref = useRef(null),
    titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`message-modal ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <div className="modal-content">
        <header>
          <div>
            <span className="small-label">{subtitle}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function MessageAction({ action, onClose, onUpdated }) {
  const { kind, message } = action;
  const [text, setText] = useState(message.text),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const deleting = kind === "delete";
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const d = await api(
        `/conversations/${message.conversationId}/messages/${message.id}`,
        {
          method: deleting ? "DELETE" : "PATCH",
          ...(deleting
            ? {}
            : {
                body: JSON.stringify({ text, revision: message.revision || 0 }),
              }),
        },
      );
      onUpdated(d.message);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={deleting ? "Delete this message?" : "Edit your message"}
      subtitle="YOUR CONVERSATION"
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        {deleting ? (
          <>
            <p className="modal-explanation">
              This removes the message and its attachment from the conversation
              for both people. They may already have read or saved it.
            </p>
            <blockquote className="delete-preview">
              {message.text || message.media?.name}
            </blockquote>
          </>
        ) : (
          <label className="edit-label">
            {message.media ? "Caption" : "Message"}
            <textarea
              aria-label="Edit message text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              rows={5}
              disabled={busy}
            />
            <span>{text.length}/4,000</span>
          </label>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-buttons">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={deleting ? "danger" : "primary"}
            disabled={busy || (!deleting && !text.trim() && !message.media)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : deleting ? (
              "Delete for everyone"
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MessageSearch({ conversation, userId, changeKey, onClose }) {
  const [term, setTerm] = useState(""),
    [matches, setMatches] = useState([]),
    [nextBefore, setNextBefore] = useState(null),
    [loading, setLoading] = useState(false),
    [moreLoading, setMoreLoading] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const seq = ++generation.current;
    setMatches([]);
    setNextBefore(null);
    setError("");
    setMoreLoading(false);
    if (!term.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const d = await api(
          `/conversations/${conversation.id}/search?q=${encodeURIComponent(term.trim())}`,
        );
        if (seq === generation.current) {
          setMatches(d.messages);
          setNextBefore(d.nextBefore);
        }
      } catch (e) {
        if (seq === generation.current) setError(e.message);
      } finally {
        if (seq === generation.current) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [term, conversation.id, changeKey]);
  async function more() {
    const seq = generation.current;
    setMoreLoading(true);
    try {
      const d = await api(
        `/conversations/${conversation.id}/search?q=${encodeURIComponent(term.trim())}&before=${nextBefore}`,
      );
      if (seq === generation.current) {
        setMatches((p) => [...p, ...d.messages]);
        setNextBefore(d.nextBefore);
      }
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      if (seq === generation.current) setMoreLoading(false);
    }
  }
  return (
    <Modal
      title="Find a message"
      subtitle={`WITH ${conversation.peer.displayName.toUpperCase()}`}
      onClose={onClose}
      className="search-modal"
    >
      <div className="search-box">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Search messages"
          placeholder="Search text and captions"
          value={term}
          maxLength={120}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div className="search-results" aria-live="polite" aria-busy={loading}>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <div className="empty-small">
            <LoaderCircle className="spin" />
            Searching…
          </div>
        ) : !term.trim() ? (
          <div className="empty-small">
            <Search size={28} />
            <p>
              Find something in this conversation, including older messages.
            </p>
          </div>
        ) : !matches.length && !error ? (
          <div className="empty-small">
            <p>No matching messages.</p>
          </div>
        ) : (
          matches.map((m) => (
            <article className="search-match" key={m.id}>
              <div className="search-result-label">
                <strong>
                  {m.senderId === userId
                    ? "You"
                    : conversation.isGroup
                      ? m.senderName || "Member"
                      : conversation.peer.displayName}
                </strong>
                <span>{new Date(m.createdAt).toLocaleDateString()}</span>
              </div>
              <MessageBubble
                message={m}
                mine={m.senderId === userId}
                readId={conversation.peerReadId}
              />
            </article>
          ))
        )}
        {nextBefore && !loading && (
          <button className="load-older" disabled={moreLoading} onClick={more}>
            {moreLoading ? "Loading…" : "More results"}
          </button>
        )}
      </div>
      <footer className="search-note">
        Newest matches first · Only this conversation
      </footer>
    </Modal>
  );
}
