// HTTP history responses can arrive after a newer socket update. Never restore an older revision.
export function mergeMessages(current, incoming) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) {
    const old = byId.get(message.id);
    if (!old || (message.revision || 0) >= (old.revision || 0))
      byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
