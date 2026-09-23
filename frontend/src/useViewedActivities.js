import { useEffect, useRef } from "react";
import { api, post } from "./api";
export function useViewedActivities(
  items,
  enabled,
  setItems,
  onCount,
  container,
) {
  const pending = useRef(new Set());
  useEffect(() => {
    if (!enabled || !container.current) return;
    let disposed = false,
      timer;
    const visible = new Set();
    async function flush() {
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const ids = [...visible]
        .filter((id) => !pending.current.has(id))
        .slice(0, 30);
      if (!ids.length) return;
      ids.forEach((id) => pending.current.add(id));
      try {
        await post("/activities/read", { ids });
        if (disposed) return;
        setItems((old) =>
          old.map((a) => (ids.includes(a.id) ? { ...a, read: true } : a)),
        );
        const d = await api("/activities");
        if (!disposed) onCount(d.unread);
      } catch {
        /* Leave unread; a later view retries. */
      } finally {
        ids.forEach((id) => pending.current.delete(id));
      }
    }
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = Number(entry.target.dataset.activityId);
          entry.isIntersecting && entry.intersectionRatio >= 0.5
            ? visible.add(id)
            : visible.delete(id);
        }
        schedule();
      },
      { threshold: 0.5 },
    );
    container.current
      .querySelectorAll("[data-activity-id].unread")
      .forEach((el) => observer.observe(el));
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [items, enabled, setItems, onCount, container]);
}
