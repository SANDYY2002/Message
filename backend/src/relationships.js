import { query } from "./db.js";
import { HttpError } from "./validation.js";
export const visibleTo = (viewer, other) =>
  `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id=${viewer} AND ub.blocked_id=${other}) OR (ub.blocked_id=${viewer} AND ub.blocker_id=${other}))`;
export async function allowInteraction(a, b, q = query) {
  if (a === b) return;
  const rows = await q(
    "SELECT blocker_id FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)",
    [a, b, b, a],
  );
  if (rows.length) throw new HttpError(403, "This interaction is unavailable.");
}
export async function lockUsers(q, ids) {
  for (const uid of [...new Set(ids)].sort((a, b) => a - b)) {
    if (!(await q("SELECT id FROM users WHERE id=? FOR UPDATE", [uid])).length)
      throw new HttpError(404, "User not found.");
  }
}
