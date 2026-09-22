import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, post } from "../api";
export const avatarPresets = {
  initials: "Initials",
  cat: "🐱",
  fox: "🦊",
  panda: "🐼",
  flower: "🌸",
  moon: "🌙",
  rocket: "🚀",
};
export default function Profile({ user, onUpdate, onLogout, close }) {
  const dialog = useRef(null);
  const [username, setUsername] = useState(user.username),
    [file, setFile] = useState(null),
    [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function action(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(path, options, message) {
    const d = await api(path, options);
    onUpdate(d.user);
    setNotice(message);
  }
  return (
    <dialog
      ref={dialog}
      className="group-dialog profile-dialog"
      aria-label="Profile settings"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>Profile settings</h2>
        <button
          className="icon-button"
          aria-label="Close profile"
          disabled={busy}
          onClick={close}
        >
          <X />
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <legend>Avatar</legend>
        <div className="avatar-presets">
          {Object.entries(avatarPresets).map(([key, icon]) => (
            <button
              key={key}
              aria-label={`Use ${key} avatar`}
              aria-pressed={
                !user.avatarUrl && (user.avatarPreset || "initials") === key
              }
              onClick={() =>
                action(() =>
                  save(
                    "/profile/avatar",
                    { method: "PATCH", body: JSON.stringify({ preset: key }) },
                    "Avatar updated.",
                  ),
                )
              }
            >
              {icon}
            </button>
          ))}
        </div>
        <label>
          Upload profile image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files[0];
              setError("");
              if (f && f.size > 2 * 1024 * 1024) {
                setError("Choose an image up to 2 MB.");
                setFile(null);
                e.target.value = "";
              } else setFile(f || null);
            }}
          />
        </label>
        <p className="group-help">
          JPG, PNG or WebP, up to 2 MB and 16 megapixels. Images are cropped
          from the center to a 1:1 square.
        </p>
        {(preview || user.avatarUrl) && (
          <img
            className="profile-preview"
            src={preview || user.avatarUrl}
            alt="Square avatar preview"
          />
        )}
        {file && (
          <button
            onClick={() =>
              action(async () => {
                const form = new FormData();
                form.append("avatar", file);
                await save(
                  "/profile/avatar",
                  { method: "POST", body: form },
                  "Avatar updated.",
                );
                setFile(null);
              })
            }
          >
            Save uploaded avatar
          </button>
        )}
      </fieldset>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(() =>
            save(
              "/profile/username",
              { method: "PATCH", body: JSON.stringify({ username }) },
              "Username updated.",
            ),
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Username</legend>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z0-9_]{3,24}"
            />
          </label>
          <p className="group-help">
            3–24 letters, numbers or underscores. Usernames are lowercase and
            must be unique. Your chats stay with your account.
          </p>
          <button type="submit">Save username</button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          action(async () => {
            if (values.newPassword !== values.confirmPassword)
              throw new Error("New passwords do not match.");
            await post("/profile/password", {
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            });
            onLogout();
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend>Password</legend>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <p className="group-help">
            Use at least 8 characters (maximum 72 UTF-8 bytes). Changing your
            password signs you out on all devices. Sign in again with the new
            password.
          </p>
          <button type="submit">Change password and sign out</button>
        </fieldset>
      </form>
    </dialog>
  );
}
