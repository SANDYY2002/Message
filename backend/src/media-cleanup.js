import { unlink } from "node:fs/promises";
import path from "node:path";
import { query } from "./db.js";
import { config } from "./config.js";
let running = null;
export function drainMediaDeletions() {
  if (running) return running;
  running = (async () => {
    const jobs = await query(
      "SELECT path FROM media_deletions ORDER BY queued_at LIMIT 100",
    );
    for (const job of jobs) {
      if (path.basename(job.path) !== job.path || !job.path) continue;
      try {
        await unlink(path.join(config.uploadDir, job.path));
      } catch (e) {
        if (e.code !== "ENOENT") {
          console.error("Media deletion will retry:", e.code);
          continue;
        }
      }
      await query("DELETE FROM media_deletions WHERE path=?", [job.path]);
    }
  })()
    .catch((e) =>
      console.error("Media cleanup will retry:", e.code || e.message),
    )
    .finally(() => {
      running = null;
    });
  return running;
}
export function startMediaCleanup() {
  void drainMediaDeletions();
  const timer = setInterval(() => void drainMediaDeletions(), 60000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    if (running) await running;
  };
}
