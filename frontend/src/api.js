import { noticeText } from "./notices";
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      noticeText(
        "Connection lost. Check your internet connection and try again.",
      ),
    );
  }
  // Expire the session even if a proxy replaces the response body with HTML.
  if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
  if (res.status === 204) return null;
  let data;
  try {
    data = await res.json();
  } catch {
    const error = new Error(
      noticeText(
        "The server is temporarily unavailable. Please try again shortly.",
      ),
    );
    error.status = res.status;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(
      typeof data?.error === "string"
        ? data.error
        : noticeText("Request failed."),
    );
    error.status = res.status;
    throw error;
  }
  return data;
}
export const post = (path, body) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export function uploadMessage(
  conversationId,
  { text, file, clientId },
  onProgress,
) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("text", text);
    form.append("clientId", clientId);
    if (file) form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/conversations/${conversationId}/messages`);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new Error(
            noticeText("Unexpected server response. Your draft is preserved."),
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        reject(
          new Error(data.error || noticeText("Could not send this message.")),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          noticeText(
            "Connection lost. Try sending again; your draft is preserved.",
          ),
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error(noticeText("Upload timed out. Please try again.")));
    xhr.send(form);
  });
}
