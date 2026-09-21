import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";

const preferenceKey = (uid) => `message-notifications:${uid}`;
function readPreference(uid) {
  try {
    return localStorage.getItem(preferenceKey(uid)) === "on";
  } catch {
    return false;
  }
}
async function worker() {
  await navigator.serviceWorker.register("/notifications-sw.js");
  let timer;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Notifications could not start. Please try again."),
            ),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeNotifications(uid, cid) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const notifications = await reg?.getNotifications();
    notifications
      ?.filter(
        (n) =>
          n.data?.userId === uid && (!cid || n.data?.conversationId === cid),
      )
      .forEach((n) => n.close());
  } catch {
    /* Notification support varies by browser. */
  }
}
export default function Notifications({
  socket,
  user,
  activeId,
  conversations,
  onOpen,
  sending,
}) {
  const supported =
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator;
  const [enabled, setEnabled] = useState(() => readPreference(user.id));
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [toast, setToast] = useState(null);
  const latest = useRef(null),
    mounted = useRef(true),
    seen = useRef(new Set());
  latest.current = { enabled, activeId, onOpen, sending };
  const unread = conversations.reduce((sum, c) => sum + c.unread, 0);
  useEffect(() => {
    document.title = unread
      ? `(${unread > 99 ? "99+" : unread}) Message`
      : "Message — A little closer";
    return () => {
      document.title = "Message — A little closer";
    };
  }, [unread]);
  function open(cid) {
    if (latest.current.sending) {
      setNotice(
        "Finish sending your attachment before switching conversations.",
      );
      return;
    }
    latest.current.onOpen(cid);
    setToast(null);
    closeNotifications(user.id, cid);
  }
  useEffect(() => {
    mounted.current = true;
    const click = (e) => {
      if (
        e.data?.type === "message-notification-click" &&
        e.data.userId === user.id &&
        Number.isSafeInteger(e.data.conversationId)
      )
        open(e.data.conversationId);
    };
    navigator.serviceWorker?.addEventListener("message", click);
    const url = new URL(location.href);
    if (Number(url.searchParams.get("notificationUser")) === user.id) {
      const cid = Number(url.searchParams.get("conversation"));
      if (Number.isSafeInteger(cid) && cid > 0) open(cid);
      url.searchParams.delete("notificationUser");
      url.searchParams.delete("conversation");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    function focus() {
      if (supported) setPermission(Notification.permission);
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        latest.current.activeId
      )
        closeNotifications(user.id, latest.current.activeId);
    }
    function storage(e) {
      if (e.key === preferenceKey(user.id)) setEnabled(readPreference(user.id));
    }
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("storage", storage);
    return () => {
      mounted.current = false;
      navigator.serviceWorker?.removeEventListener("message", click);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("storage", storage);
      closeNotifications(user.id);
    };
  }, [user.id]);
  useEffect(() => {
    if (
      activeId &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    )
      closeNotifications(user.id, activeId);
    setToast((previous) =>
      previous?.conversationId === activeId ? null : previous,
    );
  }, [activeId, user.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!socket) return;
    const received = async (m) => {
      if (m.senderId === user.id || seen.current.has(m.id)) return;
      seen.current.add(m.id);
      if (seen.current.size > 500)
        seen.current.delete(seen.current.values().next().value);
      const foreground =
        document.visibilityState === "visible" && document.hasFocus();
      if (foreground && latest.current.activeId === m.conversationId) return;
      setToast({ conversationId: m.conversationId, messageId: m.id });
      if (
        foreground ||
        !supported ||
        !latest.current.enabled ||
        Notification.permission !== "granted"
      )
        return;
      try {
        const display = async () => {
          const key = `message-notification-recent:${user.id}`;
          let recent = [];
          try {
            recent = JSON.parse(localStorage.getItem(key) || "[]");
            if (!Array.isArray(recent)) recent = [];
          } catch {
            /* Storage may be unavailable. */
          }
          if (recent.includes(m.id)) return;
          const reg = await worker();
          if (
            !mounted.current ||
            !latest.current.enabled ||
            Notification.permission !== "granted"
          )
            return;
          if (
            document.visibilityState === "visible" &&
            document.hasFocus() &&
            latest.current.activeId === m.conversationId
          )
            return;
          await reg.showNotification("New message", {
            body: "You have a new message in Message.",
            tag: `message:${user.id}:${m.conversationId}`,
            data: {
              userId: user.id,
              conversationId: m.conversationId,
              clientUrl: location.href,
            },
          });
          try {
            localStorage.setItem(
              key,
              JSON.stringify([...recent.slice(-99), m.id]),
            );
          } catch {
            /* Continue with per-tab deduplication. */
          }
        };
        if (navigator.locks)
          await navigator.locks.request(
            `message-notifications:${user.id}`,
            display,
          );
        else await display();
      } catch {
        if (mounted.current)
          setNotice(
            "Browser notification unavailable. New messages still appear in your inbox.",
          );
      }
    };
    socket.on("message:new", received);
    return () => socket.off("message:new", received);
  }, [socket, user.id, supported]);
  async function toggle() {
    setNotice("");
    if (enabled) {
      latest.current.enabled = false;
      setEnabled(false);
      try {
        localStorage.setItem(preferenceKey(user.id), "off");
      } catch {
        /* Session-only setting. */
      }
      await closeNotifications(user.id);
      return;
    }
    if (!supported) {
      setNotice(
        "Browser notifications need a supported browser on HTTPS or localhost.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      if (!mounted.current) return;
      setPermission(result);
      if (result !== "granted") {
        setNotice(
          result === "denied"
            ? "Notifications are blocked. Allow them in your browser’s site settings, then enable them here."
            : "Notifications were not enabled. You can try again anytime.",
        );
        return;
      }
      await worker();
      if (!mounted.current) return;
      latest.current.enabled = true;
      setEnabled(true);
      try {
        localStorage.setItem(preferenceKey(user.id), "on");
      } catch {
        /* Session-only setting. */
      }
      setNotice(
        "Browser notifications enabled. Keep Message open to receive alerts.",
      );
    } catch (e) {
      if (mounted.current)
        setNotice(e.message || "Could not enable notifications.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="notification-settings">
        <button
          className="notification-toggle"
          disabled={busy}
          aria-pressed={enabled && permission === "granted"}
          onClick={toggle}
        >
          {enabled && permission === "granted" ? (
            <Bell size={17} />
          ) : (
            <BellOff size={17} />
          )}
          {busy
            ? "Enabling…"
            : enabled
              ? "Disable notifications"
              : "Enable notifications"}
        </button>
        {notice && (
          <p role="status">
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notification status"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </p>
        )}
      </div>
      {toast &&
        createPortal(
          <div className="message-notification-toast" role="status">
            <Bell size={20} />
            <button
              onClick={() => open(toast.conversationId)}
              disabled={sending}
            >
              New message · Open conversation
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss message alert"
              onClick={() => setToast(null)}
            >
              <X size={18} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
