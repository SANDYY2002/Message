import defaults from "./notices.json" with { type: "json" };
export { defaults as noticeDefaults };
const ids = new Map(Object.entries(defaults).map(([key, text]) => [text, key]));
export function readNoticeOverrides(raw = "", legacyChat = "") {
  if (typeof raw !== "string" || raw.length > 131072)
    throw new Error("APP_NOTICES_JSON must be JSON text up to 128 KiB.");
  let values;
  try {
    values = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    throw new Error("APP_NOTICES_JSON must contain a valid JSON object.");
  }
  if (!values || Array.isArray(values) || typeof values !== "object")
    throw new Error(
      "APP_NOTICES_JSON must contain a JSON object of notice keys and text.",
    );
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(defaults, key))
      throw new Error(`Unknown notice key: ${key}`);
    if (typeof value !== "string" || value.length > 4000)
      throw new Error(`Notice ${key} must be text up to 4,000 characters.`);
    const permitted = new Set(defaults[key].match(/\{value\d+\}/g) || []);
    for (const placeholder of value.match(/\{value\d+\}/g) || [])
      if (!permitted.has(placeholder))
        throw new Error(`Notice ${key} contains an unsupported placeholder.`);
    if (value.trim()) result[key] = value.trim();
  }
  // The JSON setting takes precedence over the original single-notice alias.
  if (!Object.hasOwn(result, "CHAT_PRIVACY_NOTICE") && legacyChat?.trim())
    result.CHAT_PRIVACY_NOTICE = legacyChat.trim();
  return result;
}
export function createNoticeResolver(overrides = {}) {
  return (template, values = {}) => {
    if (typeof template !== "string") return template;
    const key = ids.get(template);
    const chosen =
      key && Object.hasOwn(overrides, key) ? overrides[key] : template;
    return chosen.replace(/\{(value\d+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  };
}
