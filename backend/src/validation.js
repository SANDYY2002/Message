export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function id(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 4294967295)
    throw new HttpError(400, "Invalid identifier.");
  return n;
}
export function credentials(body, registration = false) {
  if (!body || typeof body !== "object")
    throw new HttpError(400, "Account details are required.");
  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username))
    throw new HttpError(
      400,
      "Username must be 3–24 letters, numbers, or underscores.",
    );
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72)
    throw new HttpError(
      400,
      "Use at least 8 characters and at most 72 bytes for your password.",
    );
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (registration && (!displayName || displayName.length > 60))
    throw new HttpError(400, "Display name must be 1–60 characters.");
  return { username, password, displayName };
}
export function messageInput(body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > 4000)
    throw new HttpError(400, "Message must be at most 4,000 characters.");
  if (
    typeof body.clientId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.clientId,
    )
  )
    throw new HttpError(400, "A valid message retry identifier is required.");
  return { text, clientId: body.clientId.toLowerCase() };
}
export function publicMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    clientId: m.client_id,
    text: m.text,
    createdAt: m.created_at,
    media: m.media_path
      ? {
          url: `/api/media/${m.id}`,
          name: m.media_name,
          mime: m.media_mime,
          size: m.media_size,
        }
      : null,
  };
}
