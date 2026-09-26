import { useEffect, useRef, useState } from "react";
import { X, Camera, ShieldCheck, AtSign } from "lucide-react";
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
export const presetImage = (key) =>
  key !== "initials" && avatarPresets[key] ? `/avatars/${key}.svg` : null;
export default function Profile({
  user,
  onUpdate,
  onLogout,
  close,
  notificationHost,
  onSignOut,
  theme,
  setTheme,
}) {
  const dialog = useRef(null);
  const [blocks, setBlocks] = useState([]);
  useEffect(() => {
    api("/blocks")
      .then((d) => setBlocks(d.users))
      .catch((e) => setError(e.message));
  }, []);
  const [tab, setTab] = useState("account");
  const [bio, setBio] = useState(user.bio || "");
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
      aria-label="Settings"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>Settings</h2>
        <button
          className="icon-button"
          aria-label="Close settings"
          disabled={busy}
          onClick={close}
        >
          <X />
        </button>
      </header>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        <button
          role="tab"
          id="account-tab"
          aria-controls="account-panel"
          aria-selected={tab === "account"}
          onClick={() => setTab("account")}
        >
          Profile & account
        </button>
        <button
          role="tab"
          id="notifications-tab"
          aria-controls="notifications-panel"
          aria-selected={tab === "notifications"}
          onClick={() => setTab("notifications")}
        >
          Notifications & sound
        </button>
        <button
          role="tab"
          id="blocked-tab"
          aria-controls="blocked-panel"
          aria-selected={tab === "blocked"}
          onClick={() => setTab("blocked")}
        >
          Blocked users
        </button>
      </div>
      <section
        id="blocked-panel"
        role="tabpanel"
        aria-labelledby="blocked-tab"
        hidden={tab !== "blocked"}
      >
        <h3>Blocked users</h3>
        <p className="group-help">
          Blocked conversations stay in Chats. Unblocking does not restore
          follows.
        </p>
        {error && <p role="alert">{error}</p>}
        {!blocks.length && <p>No blocked users.</p>}
        {blocks.map((u) => (
          <div className="community-actions" key={u.id}>
            <span>
              {u.displayName} · @{u.username}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api(`/blocks/${u.id}`, { method: "DELETE" });
                  setBlocks((b) => b.filter((p) => p.id !== u.id));
                })
              }
            >
              Unblock @{u.username}
            </button>
          </div>
        ))}
      </section>
      <section
        id="notifications-panel"
        role="tabpanel"
        aria-labelledby="notifications-tab"
        hidden={tab !== "notifications"}
      >
        <h3>Stay connected, your way</h3>
        <p className="group-help">
          Choose browser alerts and a message chime. Your preferences are saved
          for this account on this browser.
        </p>
        <div ref={notificationHost} />
        <p className="group-help">
          Keep Message open to receive alerts. The conversation you’re actively
          reading stays quiet.
        </p>
      </section>
      <section
        id="account-panel"
        role="tabpanel"
        aria-labelledby="account-tab"
        hidden={tab !== "account"}
      >
        <div className="profile-identity">
          <span className="profile-identity-avatar">
            {user.avatarUrl || presetImage(user.avatarPreset) ? (
              <img
                src={user.avatarUrl || presetImage(user.avatarPreset)}
                alt="Current avatar"
              />
            ) : (
              user.displayName.slice(0, 1).toUpperCase()
            )}
          </span>
          <div>
            <h3>{user.displayName}</h3>
            <p>@{user.username}</p>
            <small>Your space. Your style.</small>
          </div>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <fieldset disabled={busy}>
          <legend>
            <Camera size={17} /> Your avatar
          </legend>
          <div className="avatar-presets">
            {Object.entries(avatarPresets).map(([key, icon]) => (
              <button
                key={key}
                aria-label={`Use ${key} avatar`}
                aria-pressed={
                  !user.avatarUrl && (user.avatarPreset || "initials") === key
                }
                onClick={() =>
                  action(async () => {
                    setFile(null);
                    await save(
                      "/profile/avatar",
                      {
                        method: "PATCH",
                        body: JSON.stringify({ preset: key }),
                      },
                      "Avatar updated.",
                    );
                  })
                }
              >
                {presetImage(key) ? (
                  <img src={presetImage(key)} alt="" />
                ) : (
                  <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
                )}
                <small>{key === "initials" ? "Initials" : key}</small>
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
                "/profile/bio",
                { method: "PATCH", body: JSON.stringify({ bio }) },
                "Bio updated.",
              ),
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>About you</legend>
            <label>
              Bio
              <textarea
                maxLength={300}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell people a little about yourself"
              />
            </label>
            <p className="group-help">
              {bio.length}/300 · Visible on your profile
            </p>
            <button type="submit">Save bio</button>
          </fieldset>
        </form>
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
            <legend>
              <AtSign size={17} /> Username
            </legend>
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
            <legend>
              <ShieldCheck size={17} /> Password & security
            </legend>
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
        <fieldset disabled={busy}>
          <legend>Appearance</legend>
          <label>
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">Use device setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="coloured">Coloured · Aurora</option>
            </select>
          </label>
        </fieldset>
        <button disabled={busy} onClick={() => action(onSignOut)}>
          Sign out of Message
        </button>
      </section>
    </dialog>
  );
}
