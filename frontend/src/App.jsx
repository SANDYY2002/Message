import Confessions from "./components/Confessions";
import Admin from "./components/Admin";
import { VenetianMask, Shield } from "lucide-react";
import { useConfirm } from "./components/ConfirmDialog";
import Social from "./components/Social";
import Profile, { presetImage } from "./components/Profile";
import Groups from "./components/Groups";
import Notifications from "./components/Notifications";
import Calls from "./components/Calls";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  ArrowRight,
  Image,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Monitor,
  Moon,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Settings,
  Home,
  Palette,
  Newspaper,
  Bell,
  Ban,
  Sun,
  Video,
  Users,
  X,
} from "lucide-react";
import { api, post, uploadMessage } from "./api";
import { mergeMessages as merge } from "./messages";
import {
  MessageBubble,
  MessageAction,
  MessageSearch,
} from "./components/MessageTools";
const formatTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (d) =>
  new Date(d).toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const initial = (u) => (u.displayName || u.username).slice(0, 1).toUpperCase();
const shade = (u) => ["mint", "amber", "purple", "blue"][u.id % 4];
function Avatar({ user, online = false, large = false }) {
  return (
    <span className={`avatar ${shade(user)} ${large ? "large" : ""}`}>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" />
      ) : presetImage(user.avatarPreset) ? (
        <img src={presetImage(user.avatarPreset)} alt="" />
      ) : (
        initial(user)
      )}
      {online && <i />}
    </span>
  );
}
function ThemeButton({ theme, setTheme }) {
  const modes = ["system", "light", "dark", "coloured"];
  const Icon = { system: Monitor, light: Sun, dark: Moon, coloured: Palette }[
    theme
  ];
  return (
    <button
      className="icon-button"
      title={`Theme: ${theme}. Click to change.`}
      aria-label={`Theme: ${theme}. Change theme`}
      onClick={() => setTheme(modes[(modes.indexOf(theme) + 1) % modes.length])}
    >
      <Icon size={19} />
    </button>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <MessageCircle size={23} />
      </span>
      <span>
        message<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [startupError, setStartupError] = useState("");
  const [theme, setTheme] = useState(() => {
    try {
      return ["system", "light", "dark", "coloured"].includes(
        localStorage.getItem("message-theme"),
      )
        ? localStorage.getItem("message-theme")
        : "system";
    } catch {
      return "system";
    }
  });
  const [maxUpload, setMaxUpload] = useState(25 * 1024 * 1024);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (m.matches ? "dark" : "light") : theme;
    };
    apply();
    try {
      localStorage.setItem("message-theme", theme);
    } catch {}
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);
  async function bootstrap() {
    setLoading(true);
    setStartupError("");
    try {
      const d = await api("/auth/me");
      setUser(d.user);
      setMaxUpload(d.maxUploadBytes);
    } catch (e) {
      if (e.status !== 401)
        setStartupError(
          "Unable to reach Message. Check your connection and try again.",
        );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    bootstrap();
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function signedIn(u) {
    setUser(u);
    try {
      const d = await api("/auth/me");
      setMaxUpload(d.maxUploadBytes);
      setUser(d.user);
    } catch {}
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Getting things ready…</p>
      </div>
    );
  if (startupError)
    return (
      <div className="loading-screen">
        <Brand />
        <p role="alert">{startupError}</p>
        <button className="primary" onClick={bootstrap}>
          Try again
        </button>
      </div>
    );
  return user ? (
    <Chat
      key={user.id}
      user={user}
      onUserChange={setUser}
      maxUpload={maxUpload}
      onLogout={() => setUser(null)}
      theme={theme}
      setTheme={setTheme}
    />
  ) : (
    <Auth onLogin={signedIn} theme={theme} setTheme={setTheme} />
  );
}
function Auth({ onLogin, theme, setTheme }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const d = await post(`/auth/${register ? "register" : "login"}`, body);
      onLogin(d.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-body">
          <span className="eyebrow">
            <span className="status-dot" /> LITTLE MOMENTS. REAL CONNECTIONS.
          </span>
          <h1>
            A little
            <br />
            closer<span>.</span>
          </h1>
          <p>
            A quick hello. A photo from your day.
            <br />A conversation that feels like being there.
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="art-bubble">
              <MessageCircle size={64} strokeWidth={1.3} />
            </span>
            <span className="art-image">
              <Image size={32} />
            </span>
            <span className="art-video">
              <Video size={28} />
            </span>
            <span className="art-spark">✳</span>
          </div>
        </div>
        <div className="story-footer">
          <ShieldCheck size={16} /> A space for your conversations.
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-top">
          <span>YOUR PEOPLE, ONE PLACE</span>
          <ThemeButton theme={theme} setTheme={setTheme} />
        </div>
        <div className="auth-form-wrap">
          <span className="small-label">LET’S CONNECT</span>
          <h2>{register ? "Make yourself at home." : "Good to see you."}</h2>
          <p>
            {register
              ? "Create an account and start your first conversation."
              : "Sign in to pick up where you left off."}
          </p>
          <div className="auth-tabs">
            <button
              className={!register ? "active" : ""}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              className={register ? "active" : ""}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              Create account
            </button>
          </div>
          <form onSubmit={submit} key={register ? "register" : "login"}>
            {register && (
              <label>
                Your name
                <input
                  name="displayName"
                  autoComplete="name"
                  placeholder="Sandesh Chhetri"
                  required
                  maxLength={60}
                />
              </label>
            )}
            <label>
              Username
              <div className="input-prefix">
                <span>@</span>
                <input
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  placeholder="your_username"
                  required
                  pattern="[a-zA-Z0-9_]{3,24}"
                  minLength={3}
                  maxLength={24}
                />
              </div>
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                placeholder={
                  register ? "At least 8 characters" : "Enter your password"
                }
                required
                minLength={8}
              />
            </label>
            {register && (
              <p className="field-hint">
                Usernames use 3–24 letters, numbers, or underscores.
              </p>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary auth-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {register ? "Create account" : "Sign in"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="auth-note">
            <ShieldCheck size={16} />
            <span>
              Superadmins can access your private messages and shared media.
              Chats are not end-to-end encrypted.
            </span>
          </div>
        </div>
        <footer className="auth-footer">
          Text, photos, and videos. All in one conversation.
        </footer>
      </section>
    </main>
  );
}
function Chat({ user, maxUpload, onLogout, onUserChange, theme, setTheme }) {
  const confirm = useConfirm();
  const [adminEligible, setAdminEligible] = useState(false);
  useEffect(() => {
    api("/admin/status")
      .then((d) => setAdminEligible(d.eligible))
      .catch(() => {});
  }, []);
  const [page, setPage] = useState(() => {
    if (new URL(location.href).searchParams.has("post")) return "posts";
    try {
      const saved = sessionStorage.getItem(`message-page:${user.id}`);
      return ["home", "posts", "activity", "messages"].includes(saved)
        ? saved
        : "home";
    } catch {
      return "home";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`message-page:${user.id}`, page);
    } catch {}
  }, [page, user.id]);
  const pageRef = useRef("home");
  pageRef.current = page;
  const [focusProfile, setFocusProfile] = useState(null);
  const [inbox, setInbox] = useState("inbox");
  const [activityCount, setActivityCount] = useState(0);
  const [focusPost, setFocusPost] = useState(() => {
    const n = Number(new URL(location.href).searchParams.get("post"));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationTarget, setNotificationTarget] = useState(null);
  const [callSocket, setCallSocket] = useState(null);
  const [groupDialog, setGroupDialog] = useState(null);
  const [conversations, setConversations] = useState([]),
    [listLoading, setListLoading] = useState(true),
    [activeId, setActiveId] = useState(null),
    [messages, setMessages] = useState([]),
    [hasMore, setHasMore] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false),
    [olderLoading, setOlderLoading] = useState(false),
    [peerReadId, setPeerReadId] = useState(0);
  const [online, setOnline] = useState(new Set()),
    [connected, setConnected] = useState(false),
    [typing, setTyping] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [newChat, setNewChat] = useState(false),
    [lightbox, setLightbox] = useState(null),
    [messageAction, setMessageAction] = useState(null),
    [searchOpen, setSearchOpen] = useState(false),
    [messageChange, setMessageChange] = useState(0);
  const [text, setText] = useState(""),
    [file, setFile] = useState(null),
    [sending, setSending] = useState(false),
    [progress, setProgress] = useState(0),
    [dragging, setDragging] = useState(false);
  const socket = useRef(null),
    active = useRef(null),
    listSeq = useRef(0),
    historySeq = useRef(0),
    typingTimer = useRef(null),
    scroll = useRef(null),
    draft = useRef({ id: crypto.randomUUID(), text: "", file: null }),
    readSent = useRef(new Map()),
    messageUpdates = useRef(new Map()),
    drafts = useRef(new Map()),
    fileInput = useRef(null),
    bottom = useRef(null),
    sendingRef = useRef(false);
  const selected = conversations.find((c) => c.id === activeId);
  active.current = activeId;
  function latestMessage(m) {
    const update = messageUpdates.current.get(m.id);
    return update && (update.revision || 0) > (m.revision || 0) ? update : m;
  }
  function applyMessageUpdate(m) {
    refreshList();
    setMessageChange((n) => n + 1);
    if (active.current === m.conversationId) {
      messageUpdates.current.set(m.id, latestMessage(m));
      setMessages((previous) =>
        previous.some((p) => p.id === m.id)
          ? merge(previous, [latestMessage(m)])
          : previous,
      );
    }
    if (m.deletedAt) {
      setMessageAction((a) => (a?.message.id === m.id ? null : a));
      setLightbox((current) =>
        current?.url === `/api/media/${m.id}` ? null : current,
      );
    }
  }
  async function refreshList() {
    const seq = ++listSeq.current;
    try {
      const d = await api("/conversations");
      if (seq === listSeq.current) setConversations(d.conversations);
    } catch (e) {
      setError(e.message);
    } finally {
      if (seq === listSeq.current) setListLoading(false);
    }
  }
  async function loadHistory(cid, { reconnect = false } = {}) {
    const seq = ++historySeq.current;
    if (!reconnect) {
      setHistoryLoading(true);
      setMessages([]);
      setHasMore(false);
    }
    try {
      const d = await api(`/conversations/${cid}/messages`);
      if (active.current !== cid || seq !== historySeq.current) return;
      setMessages((current) => merge(current, d.messages.map(latestMessage)));
      setHasMore(d.hasMore);
      setPeerReadId((previous) => Math.max(previous, d.peerReadId));
    } catch (e) {
      if (active.current === cid) setError(e.message);
    } finally {
      if (active.current === cid && seq === historySeq.current)
        setHistoryLoading(false);
    }
  }
  useEffect(() => {
    refreshList();
    const s = io({ autoConnect: true });
    socket.current = s;
    setCallSocket(s);
    s.on("connect", () => {
      setConnected(true);
      setMessageChange((n) => n + 1);
      refreshList();
      if (active.current) loadHistory(active.current);
    });
    s.on("disconnect", () => {
      setConnected(false);
      setOnline(new Set());
    });
    s.on("connect_error", () => setConnected(false));
    s.on("presence:snapshot", (ids) => setOnline(new Set(ids)));
    s.on("presence:changed", (d) =>
      setOnline((previous) => {
        const n = new Set(previous);
        d.online ? n.add(d.userId) : n.delete(d.userId);
        return n;
      }),
    );
    s.on("user:updated", (updated) => {
      if (updated.id === user.id) onUserChange(updated);
      refreshList();
    });
    s.on("session:revoked", () =>
      window.dispatchEvent(new Event("session-expired")),
    );
    const activityRefresh = () =>
      api("/activities")
        .then((d) => setActivityCount(d.unread))
        .catch(() => {});
    activityRefresh();
    s.on("connect", activityRefresh);
    s.on("activity:new", activityRefresh);
    s.on("activity:read", activityRefresh);
    s.on("relationships:changed", () => {
      refreshList();
      activityRefresh();
      setMessages([]);
      setLightbox(null);
      setSearchOpen(false);
      if (active.current) loadHistory(active.current);
    });
    s.on("conversation:changed", refreshList);
    s.on("conversation:removed", ({ conversationId }) => {
      setConversations((old) => old.filter((c) => c.id !== conversationId));
      drafts.current.delete(conversationId);
      if (active.current === conversationId) {
        active.current = null;
        setActiveId(null);
        setMessages([]);
        setText("");
        setFile(null);
        setGroupDialog(null);
        setSearchOpen(false);
        setMessageAction(null);
        setLightbox(null);
      }
    });
    s.on("message:updated", applyMessageUpdate);
    s.on("message:new", (m) => {
      refreshList();
      setMessageChange((n) => n + 1);
      if (active.current === m.conversationId) {
        setMessages((prev) => merge(prev, [latestMessage(m)]));
        setTyping(false);
      }
    });
    s.on("conversation:read", (d) => {
      refreshList();
      if (d.conversationId === active.current && d.userId !== user.id)
        setPeerReadId((prev) => Math.max(prev, d.messageId));
    });
    s.on("typing", (d) => {
      if (d.conversationId === active.current && d.userId !== user.id) {
        setTyping(true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 2500);
      }
    });
    return () => {
      s.disconnect();
      clearTimeout(typingTimer.current);
    };
  }, []);
  useEffect(() => {
    setTyping(false);
    setSearchOpen(false);
    setMessageAction(null);
    setPeerReadId(0);
    setError("");
    if (activeId) loadHistory(activeId);
  }, [activeId]);
  useEffect(() => {
    if (
      page !== "messages" ||
      !activeId ||
      historyLoading ||
      !messages.length ||
      selected?.requestStatus !== "accepted" ||
      selected?.blockedByMe ||
      selected?.blockedByPeer
    )
      return;
    const mark = async () => {
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      const mid = messages.at(-1).id;
      if ((readSent.current.get(activeId) || 0) >= mid) return;
      readSent.current.set(activeId, mid);
      try {
        await post(`/conversations/${activeId}/read`, { messageId: mid });
      } catch {
        readSent.current.delete(activeId);
      }
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    window.addEventListener("focus", mark);
    return () => {
      document.removeEventListener("visibilitychange", mark);
      window.removeEventListener("focus", mark);
    };
  }, [
    activeId,
    messages,
    historyLoading,
    page,
    selected?.requestStatus,
    selected?.blockedByMe,
    selected?.blockedByPeer,
  ]);
  useEffect(() => {
    if (!olderLoading) bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [messages.at(-1)?.id, activeId, typing]);
  useEffect(() => {
    if (!lightbox && !newChat) return;
    const close = (e) => {
      if (e.key === "Escape") {
        setLightbox(null);
        setNewChat(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [lightbox, newChat]);
  function select(cid) {
    setPage("messages");
    if (sendingRef.current || cid === active.current) return;
    if (active.current)
      drafts.current.set(active.current, { text, file, retry: draft.current });
    const saved = drafts.current.get(cid);
    messageUpdates.current.clear();
    active.current = cid;
    setActiveId(cid);
    setMessages([]);
    setText(saved?.text || "");
    setFile(saved?.file || null);
    draft.current = saved?.retry || {
      id: crypto.randomUUID(),
      text: "",
      file: null,
    };
  }
  async function older() {
    if (!selected || !messages.length) return;
    const cid = activeId,
      el = scroll.current,
      height = el.scrollHeight;
    setOlderLoading(true);
    try {
      const d = await api(
        `/conversations/${cid}/messages?before=${messages[0].id}`,
      );
      if (active.current === cid) {
        setMessages((p) => merge(d.messages.map(latestMessage), p));
        setHasMore(d.hasMore);
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - height;
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setOlderLoading(false);
    }
  }
  function attach(f) {
    if (!f) return;
    if (f.size > maxUpload) {
      setError(`Choose a file smaller than ${maxUpload / 1024 / 1024} MB.`);
      return;
    }
    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
      ].includes(f.type)
    ) {
      setError("Choose a JPG, PNG, WebP, GIF, MP4, or WebM file.");
      return;
    }
    setFile(f);
    setError("");
  }
  async function send(e) {
    e.preventDefault();
    if (sendingRef.current || (!text.trim() && !file) || !selected) return;
    const cid = activeId;
    setError("");
    sendingRef.current = true;
    setSending(true);
    setProgress(0);
    if (draft.current.text !== text || draft.current.file !== file)
      draft.current = { id: crypto.randomUUID(), text, file };
    try {
      const d = await uploadMessage(
        cid,
        { text, file, clientId: draft.current.id },
        setProgress,
      );
      if (selected.incomingRequest) setInbox("inbox");
      if (active.current === cid) {
        setMessages((p) => merge(p, [latestMessage(d.message)]));
        setText("");
        setFile(null);
        drafts.current.delete(cid);
        draft.current = { id: crypto.randomUUID(), text: "", file: null };
      }
      refreshList();
    } catch (e) {
      setError(e.message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  async function logout() {
    try {
      await post("/auth/logout", {});
      onLogout();
    } catch (e) {
      setError(e.message);
    }
  }
  async function startMessage(uid) {
    try {
      const c = await post("/conversations", { userId: uid });
      await refreshList();
      setInbox("inbox");
      select(c.id);
    } catch (e) {
      setError(e.message);
      setPage("messages");
    }
  }
  function viewProfile(uid) {
    if (sendingRef.current) return;
    setFocusProfile(uid);
    setFocusPost(null);
    setPage("posts");
  }
  function navigate(next) {
    if (sendingRef.current) return;
    setPage(next);
    setFocusProfile(null);
    setFocusPost(null);
  }
  async function requestAction(action) {
    if (
      action === "decline" &&
      !(await confirm({
        title: "Decline this request?",
        description:
          "This conversation will close and the sender cannot send another introduction in it.",
        confirmLabel: "Decline request",
      }))
    )
      return;
    try {
      await post(`/conversations/${activeId}/${action}`, {});
      await refreshList();
      if (action === "decline") select(null);
      else setInbox("inbox");
    } catch (e) {
      setError(e.message);
    }
  }
  async function blockPeer() {
    if (
      !selected ||
      selected.isGroup ||
      !(await confirm({
        title: `Block @${selected.peer.username}?`,
        description:
          "This stops messages, calls and social interactions. You can unblock them from Settings or this chat.",
        confirmLabel: "Block user",
      }))
    )
      return;
    try {
      await api(`/blocks/${selected.peer.id}`, { method: "PUT" });
      await refreshList();
    } catch (e) {
      setError(e.message);
    }
  }
  const blocked = !!(selected?.blockedByMe || selected?.blockedByPeer);
  async function unblockPeer() {
    try {
      await api(`/blocks/${selected.peer.id}`, { method: "DELETE" });
      await refreshList();
    } catch (e) {
      setError(e.message);
    }
  }
  async function deleteChat() {
    if (
      !(await confirm({
        title: "Delete chat from your inbox?",
        description:
          "This hides the conversation for you. It does not delete the other person’s copy. A new message can bring it back if neither of you is blocked.",
        confirmLabel: "Delete chat",
      }))
    )
      return;
    try {
      await api(`/conversations/${activeId}`, { method: "DELETE" });
      select(null);
      await refreshList();
    } catch (e) {
      setError(e.message);
    }
  }
  const requestCount = conversations.filter(
    (c) => c.incomingRequest && c.lastMessage,
  ).length;
  const filtered = conversations
    .filter((c) =>
      inbox === "requests"
        ? c.incomingRequest && c.lastMessage
        : !c.incomingRequest,
    )
    .filter((c) =>
      `${c.peer.displayName} ${c.peer.username}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <main
      className={`chat-shell ${page !== "messages" ? "social-mode" : ""} ${selected ? "conversation-open" : ""}`}
    >
      <nav className="rail" aria-label="Main navigation">
        <div className="rail-logo">
          <MessageCircle size={24} />
        </div>
        <div className="primary-nav-links">
          <button
            className={`icon-button ${page === "confessions" ? "rail-active" : ""}`}
            aria-label="Confessions"
            title="Confessions"
            onClick={() => navigate("confessions")}
          >
            <VenetianMask size={22} />
            <span>Confess</span>
          </button>
          {adminEligible && (
            <button
              className={`icon-button ${page === "admin" ? "rail-active" : ""}`}
              aria-label="Administration"
              title="Administration"
              onClick={() => navigate("admin")}
            >
              <Shield size={22} />
              <span>Admin</span>
            </button>
          )}
          <button
            className={`icon-button ${page === "home" ? "rail-active" : ""}`}
            aria-label="Home"
            title="Home"
            aria-current={page === "home" ? "page" : undefined}
            onClick={() => navigate("home")}
          >
            <Home size={22} />
            <span>Home</span>
          </button>
          <button
            className={`icon-button ${page === "posts" ? "rail-active" : ""}`}
            aria-label="Posts"
            title="Posts"
            aria-current={page === "posts" ? "page" : undefined}
            onClick={() => navigate("posts")}
          >
            <Newspaper size={22} />
            <span>Posts</span>
          </button>
          <button
            className={`icon-button ${page === "activity" ? "rail-active" : ""}`}
            aria-label="Activity"
            title="Activity"
            aria-current={page === "activity" ? "page" : undefined}
            onClick={() => navigate("activity")}
          >
            <Bell size={22} />
            <span>Activity</span>
            {activityCount > 0 && (
              <b className="nav-count">
                {activityCount > 99 ? "99+" : activityCount}
              </b>
            )}
          </button>
          <button
            className={`icon-button ${page === "messages" ? "rail-active" : ""}`}
            aria-label="Conversations"
            onClick={() => {
              if (!sending) {
                setPage("messages");
                select(null);
              }
            }}
          >
            <MessageCircle size={22} />
            <span>Chats</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button
            className="icon-button nav-settings"
            aria-label="Settings"
            title="Settings"
            aria-haspopup="dialog"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen(true)}
          >
            <Settings size={21} />
          </button>
          <ThemeButton theme={theme} setTheme={setTheme} />
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={logout}
            disabled={sending}
          >
            <LogOut size={19} />
          </button>
          <button
            className="nav-profile"
            aria-label="Your profile"
            title="Your profile"
            onClick={() => viewProfile(user.id)}
          >
            <Avatar user={user} />
          </button>
        </div>
      </nav>
      {page === "confessions" && <Confessions />}
      {page === "admin" && <Admin />}
      {["home", "posts", "activity"].includes(page) && (
        <Social
          page={page}
          user={user}
          socket={callSocket}
          onMessage={startMessage}
          onActivityCount={setActivityCount}
          focusPost={focusPost}
          focusProfile={focusProfile}
          onProfile={viewProfile}
          onCloseProfile={() => setFocusProfile(null)}
          onClearPost={(pid) => {
            setFocusProfile(null);
            const url = new URL(location.href);
            if (pid) url.searchParams.set("post", pid);
            else url.searchParams.delete("post");
            history.replaceState(null, "", url.pathname + url.search);
            setFocusPost(pid || null);
            if (pid) setPage("posts");
          }}
        />
      )}
      <aside className="sidebar">
        <header className="sidebar-header">
          <Brand />
          <span className={`connection ${connected ? "" : "offline"}`}>
            <i />
            {connected ? "Connected" : "Reconnecting"}
          </span>
        </header>
        <Notifications
          settingsTarget={notificationTarget}
          socket={callSocket}
          user={user}
          activeId={page === "messages" ? activeId : null}
          onActivity={() => navigate("activity")}
          conversations={conversations}
          onOpen={select}
          sending={sending}
        />
        <button
          className="group-new"
          disabled={sending}
          onClick={() => setGroupDialog({ create: true })}
        >
          <Users size={17} /> New group
        </button>
        <div className="inbox-heading">
          <div>
            <span className="small-label">YOUR EVERYDAY CONNECTIONS</span>
            <h1>
              Messages<span>{conversations.length}</span>
            </h1>
          </div>
          <button
            className="new-button"
            aria-label="New conversation"
            onClick={() => setNewChat(true)}
            disabled={sending}
          >
            <Plus size={23} />
          </button>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="inbox-tabs">
          <button
            aria-pressed={inbox === "inbox"}
            onClick={() => setInbox("inbox")}
          >
            Inbox
          </button>
          <button
            aria-pressed={inbox === "requests"}
            onClick={() => setInbox("requests")}
          >
            Message Requests {requestCount > 0 ? `(${requestCount})` : ""}
          </button>
        </div>
        <div className="list-label">
          ALL CONVERSATIONS
          <span>
            {conversations.reduce((n, c) => n + c.unread, 0) > 0
              ? "UNREAD"
              : ""}
          </span>
        </div>
        <div className="conversation-list">
          {listLoading ? (
            <div className="empty-small">
              <LoaderCircle className="spin" />
              Loading conversations…
            </div>
          ) : filtered.length ? (
            filtered.map((c) => (
              <button
                key={c.id}
                disabled={sending}
                className={`conversation ${c.id === activeId ? "selected" : ""}`}
                onClick={() => select(c.id)}
              >
                <Avatar
                  user={c.peer}
                  online={!c.isGroup && online.has(c.peer.id)}
                />
                <div className="conversation-copy">
                  <div className="conversation-title">
                    <strong>{c.peer.displayName}</strong>
                    <time>{formatTime(c.updatedAt)}</time>
                  </div>
                  <div className="conversation-preview">
                    <span>
                      {c.lastMessage?.deletedAt
                        ? "Message deleted"
                        : c.lastMessage?.text ||
                          (c.lastMessage?.mediaMime?.startsWith("image/")
                            ? "Photo"
                            : c.lastMessage?.mediaMime
                              ? "Video"
                              : "Say hello 👋")}
                    </span>
                    {c.unread > 0 && <b>{c.unread > 99 ? "99+" : c.unread}</b>}
                  </div>
                  <small>
                    {c.blockedByMe || c.blockedByPeer
                      ? "Blocked"
                      : c.requestStatus === "pending"
                        ? c.incomingRequest
                          ? "Wants to message you"
                          : "Request sent · Awaiting acceptance"
                        : c.isGroup
                          ? `${c.memberCount} members`
                          : `@${c.peer.username}`}
                  </small>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-small">
              <MessageCircle size={30} />
              <strong>
                {search
                  ? "No conversations found"
                  : inbox === "requests"
                    ? "No message requests"
                    : "Your next hello starts here"}
              </strong>
              <p>
                {search
                  ? "Try a different name."
                  : inbox === "requests"
                    ? "New introductions appear here for you to accept or decline."
                    : "Find a friend by username and start talking."}
              </p>
              {!search && (
                <button
                  className="text-button"
                  onClick={() => setNewChat(true)}
                >
                  Start a conversation <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="profile">
          <Avatar user={user} />
          <div>
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <button
            className="icon-button mobile-logout"
            title="Sign out"
            aria-label="Sign out"
            disabled={sending}
            onClick={logout}
          >
            <LogOut size={18} />
          </button>
        </footer>
      </aside>
      <section className="chat-main">
        <Calls
          socket={callSocket}
          selected={
            blocked || selected?.requestStatus !== "accepted" ? null : selected
          }
          user={user}
          connected={connected}
        />
        {selected ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button back-button"
                aria-label="Back to conversations"
                disabled={sending}
                onClick={() => select(null)}
              >
                <ArrowLeft />
              </button>
              <Avatar
                user={selected.peer}
                online={!selected.isGroup && online.has(selected.peer.id)}
              />
              <div className="chat-person">
                <h2>
                  {selected.isGroup ? (
                    selected.peer.displayName
                  ) : (
                    <button
                      className="profile-link"
                      onClick={() => viewProfile(selected.peer.id)}
                    >
                      {selected.peer.displayName}
                    </button>
                  )}
                </h2>
                <span>
                  {selected.isGroup ? (
                    `${selected.memberCount} members · Group`
                  ) : online.has(selected.peer.id) ? (
                    <>
                      <i className="status-dot" />
                      Online now
                    </>
                  ) : (
                    `@${selected.peer.username} · Offline`
                  )}
                </span>
              </div>
              {!selected.isGroup && !selected.blockedByMe && (
                <button
                  className="icon-button"
                  aria-label="Block user"
                  title="Block user"
                  onClick={blockPeer}
                >
                  <Ban size={18} />
                </button>
              )}
              {selected.isGroup && (
                <button
                  className="icon-button"
                  aria-label="Group details"
                  onClick={() => setGroupDialog({ conversation: selected })}
                >
                  <Users size={19} />
                </button>
              )}
              <span className="private-label">
                <ShieldCheck size={15} />
                Member conversation
              </span>
              <button
                className="icon-button chat-search-button"
                aria-label="Search this conversation"
                title="Search messages"
                disabled={blocked}
                onClick={() => setSearchOpen(true)}
              >
                <Search size={19} />
              </button>
              <ThemeButton theme={theme} setTheme={setTheme} />
            </header>
            <div className="message-area" ref={scroll}>
              {historyLoading ? (
                <div className="empty-small">
                  <LoaderCircle className="spin" />
                  Loading your messages…
                </div>
              ) : (
                <>
                  {hasMore && (
                    <button
                      className="load-older"
                      disabled={olderLoading}
                      onClick={older}
                    >
                      {olderLoading ? "Loading…" : "Load earlier messages"}
                    </button>
                  )}
                  {!messages.length && (
                    <div className="conversation-intro">
                      <Avatar user={selected.peer} large />
                      <h2>This is the start of something.</h2>
                      <p>Say hello to {selected.peer.displayName}.</p>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={m.id}>
                      {(!i ||
                        day(messages[i - 1].createdAt) !==
                          day(m.createdAt)) && (
                        <div className="date-divider">
                          <span>{day(m.createdAt)}</span>
                        </div>
                      )}
                      <MessageBubble
                        message={m}
                        mine={m.senderId === user.id}
                        readId={selected.isGroup ? 0 : peerReadId}
                        showSender={selected.isGroup}
                        onPreview={setLightbox}
                        onImageLoad={() => {
                          const el = scroll.current;
                          if (
                            el &&
                            el.scrollHeight - el.scrollTop - el.clientHeight <
                              400
                          )
                            bottom.current?.scrollIntoView();
                        }}
                        onEdit={(message) =>
                          setMessageAction({ kind: "edit", message })
                        }
                        onDelete={(message) =>
                          setMessageAction({ kind: "delete", message })
                        }
                      />
                    </div>
                  ))}
                  {typing && (
                    <div className="typing-indicator" aria-live="polite">
                      <span />
                      <span />
                      <span />
                      <small>
                        {selected.isGroup
                          ? "Someone"
                          : selected.peer.displayName}{" "}
                        is typing
                      </small>
                    </div>
                  )}
                  <div ref={bottom} />
                </>
              )}
            </div>
            {!blocked && selected.requestStatus === "pending" && (
              <div className="request-banner" role="status">
                <strong>
                  {selected.incomingRequest
                    ? "Message request"
                    : "Awaiting acceptance"}
                </strong>
                <p>
                  {selected.incomingRequest
                    ? "Accept to chat or reply below to accept automatically. You can also decline or block this person."
                    : "You can send one introduction. Calls and further messages unlock after acceptance."}
                </p>
                {selected.incomingRequest && (
                  <div>
                    <button onClick={() => requestAction("accept")}>
                      Accept request
                    </button>
                    <button onClick={() => requestAction("decline")}>
                      Decline request
                    </button>
                  </div>
                )}
              </div>
            )}
            <p className="chat-privacy-note">
              Superadmins can access your private messages and shared media.
              Chats are not end-to-end encrypted.
            </p>
            {blocked ? (
              <div className="request-banner blocked-banner" role="status">
                <strong>
                  {selected.blockedByMe
                    ? "You blocked this person"
                    : "Messaging is blocked"}
                </strong>
                <p>
                  Message history remains available. New messages and calls are
                  disabled.
                </p>
                {error && <p role="alert">{error}</p>}
                <div>
                  {selected.blockedByMe && (
                    <button onClick={unblockPeer}>Unblock person</button>
                  )}
                  <button onClick={deleteChat}>Delete chat</button>
                </div>
              </div>
            ) : (
              <div
                className="composer-area"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!sending) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!sending) attach(e.dataTransfer.files[0]);
                }}
              >
                {error && (
                  <div role="alert" className="error dismissable">
                    {error}
                    <button
                      aria-label="Dismiss error"
                      onClick={() => setError("")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {file && (
                  <Attachment
                    file={file}
                    disabled={sending}
                    remove={() => setFile(null)}
                  />
                )}
                <form
                  onSubmit={send}
                  className={`composer ${dragging ? "dragging" : ""}`}
                >
                  <input
                    type="file"
                    ref={fileInput}
                    hidden
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                    onChange={(e) => {
                      attach(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Attach photo or video"
                    title={`Attach photo or video (up to ${maxUpload / 1024 / 1024} MB)`}
                    disabled={sending}
                    onClick={() => fileInput.current.click()}
                  >
                    <Paperclip size={21} />
                  </button>
                  <textarea
                    aria-label="Message"
                    placeholder={
                      dragging
                        ? "Drop a photo or video here…"
                        : "Write a message…"
                    }
                    value={text}
                    maxLength={4000}
                    disabled={sending}
                    rows={1}
                    onChange={(e) => {
                      setText(e.target.value);
                      socket.current?.emit("typing", {
                        conversationId: activeId,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send(e);
                      }
                    }}
                  />
                  <button
                    className="send-button"
                    aria-label="Send message"
                    disabled={sending || (!text.trim() && !file)}
                  >
                    {sending ? (
                      <LoaderCircle className="spin" size={20} />
                    ) : (
                      <Send size={20} />
                    )}
                  </button>
                </form>
                <div className="composer-note">
                  <span>
                    {sending
                      ? `Sending${file ? ` · ${progress}%` : ""}…`
                      : `Photos & videos up to ${maxUpload / 1024 / 1024} MB`}
                  </span>
                  <span>Enter to send · Shift + Enter for a new line</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="welcome">
            <span className="welcome-icon">
              <MessageCircle size={58} strokeWidth={1.3} />
              <i>✳</i>
            </span>
            <span className="small-label">LESS DISTANCE. MORE CONNECTION.</span>
            <h1>
              Good conversations
              <br />
              start with a hello<span>.</span>
            </h1>
            <p>
              Find your people. Share a moment.
              <br />
              Make their day a little brighter.
            </p>
            <button className="primary" onClick={() => setNewChat(true)}>
              <Plus size={18} />
              New conversation
            </button>
            <div className="welcome-features">
              <span>
                <MessageCircle size={17} />
                Real-time messages
              </span>
              <span>
                <Image size={17} />
                Photos & videos
              </span>
            </div>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
          </div>
        )}
      </section>
      {messageAction && (
        <MessageAction
          key={`${messageAction.kind}:${messageAction.message.id}`}
          action={messageAction}
          onClose={() => setMessageAction(null)}
          onUpdated={applyMessageUpdate}
        />
      )}
      {searchOpen && selected && (
        <MessageSearch
          conversation={selected}
          userId={user.id}
          changeKey={messageChange}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {profileOpen && (
        <Profile
          user={user}
          notificationHost={setNotificationTarget}
          onUpdate={onUserChange}
          onLogout={onLogout}
          onSignOut={logout}
          theme={theme}
          setTheme={setTheme}
          close={() => setProfileOpen(false)}
        />
      )}
      {groupDialog && (
        <Groups
          conversation={groupDialog.conversation}
          userId={user.id}
          close={() => setGroupDialog(null)}
          onChanged={refreshList}
          onCreated={async (cid) => {
            await refreshList();
            select(cid);
          }}
        />
      )}
      {newChat && (
        <UserPicker
          close={() => setNewChat(false)}
          onSelect={async (peer) => {
            const c = await post("/conversations", { userId: peer.id });
            await refreshList();
            select(c.id);
            setNewChat(false);
          }}
        />
      )}
      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightbox(null)}
        >
          <button
            className="lightbox-close"
            autoFocus
            aria-label="Close image preview"
            onClick={() => setLightbox(null)}
          >
            <X />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            onClick={(e) => e.stopPropagation()}
          />
          <span>{lightbox.name}</span>
        </div>
      )}
    </main>
  );
}
function Attachment({ file, remove, disabled }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="attachment">
      {file.type.startsWith("image/") ? (
        <img src={url} alt="Selected attachment" />
      ) : (
        <Video size={30} />
      )}
      <div>
        <strong>{file.name}</strong>
        <small>{(file.size / 1024 / 1024).toFixed(1)} MB · Ready to send</small>
      </div>
      <button
        className="icon-button"
        disabled={disabled}
        aria-label="Remove attachment"
        onClick={remove}
      >
        <X size={18} />
      </button>
    </div>
  );
}
function UserPicker({ close, onSelect }) {
  const [search, setSearch] = useState(""),
    [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const d = await api(`/users?q=${encodeURIComponent(search)}`);
        if (alive) setUsers(d.users);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search]);
  async function pick(u) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSelect(u);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  function trap(e) {
    if (e.key !== "Tab") return;
    const elements = dialog.current.querySelectorAll(
      "button:not(:disabled),input",
    );
    const first = elements[0],
      last = elements[elements.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  return (
    <div className="modal-backdrop" onClick={() => !busy && close()}>
      <section
        className="user-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        ref={dialog}
        onKeyDown={trap}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="small-label">MAKE A CONNECTION</span>
            <h2 id="picker-title">A new hello.</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close new conversation"
            onClick={close}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        <div className="search-box">
          <Search size={18} />
          <input
            autoFocus
            aria-label="Search people"
            placeholder="Search name or username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <div className="picker-results">
          {loading ? (
            <div className="empty-small">
              <LoaderCircle className="spin" />
            </div>
          ) : users.length ? (
            users.map((u) => (
              <button
                disabled={busy}
                className="person-result"
                key={u.id}
                onClick={() => pick(u)}
              >
                <Avatar user={u} />
                <span>
                  <strong>{u.displayName}</strong>
                  <small>@{u.username}</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))
          ) : (
            <div className="empty-small">
              <Search size={26} />
              <strong>No people found yet</strong>
              <p>
                Ask your friend to create an account, then search for their
                username.
              </p>
            </div>
          )}
        </div>
        <footer>
          Showing up to 30 people. Search to find someone specific.
        </footer>
      </section>
    </div>
  );
}
