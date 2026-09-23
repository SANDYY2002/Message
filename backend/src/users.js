export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || "",
    avatarPreset: row.avatar_preset || "initials",
    avatarUrl: row.avatar_path
      ? `/api/avatars/${row.id}?v=${row.avatar_revision}`
      : null,
  };
}
