import { useConfirm } from "./ConfirmDialog";
import { useEffect, useRef, useState } from "react";
import { api, post } from "../api";
import { X, Users } from "lucide-react";

export default function Groups({
  conversation,
  userId,
  close,
  onCreated,
  onChanged,
}) {
  const confirm = useConfirm();
  const dialog = useRef(null),
    [name, setName] = useState(conversation?.peer.displayName || ""),
    [search, setSearch] = useState(""),
    [people, setPeople] = useState([]),
    [chosen, setChosen] = useState([]),
    [details, setDetails] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const owner = details?.ownerId === userId;
  async function load() {
    const d = await api(`/groups/${conversation.id}`);
    setDetails(d);
    setName(d.name);
  }
  useEffect(() => {
    dialog.current.showModal();
    if (conversation) load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        api(`/users?q=${encodeURIComponent(search)}`)
          .then((d) => {
            if (alive) setPeople(d.users);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search]);
  async function action(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function change(path, method, body) {
    if (
      method === "DELETE" &&
      !(await confirm({
        title: "Remove group member?",
        description:
          "They will lose access to this group's messages and shared media.",
        confirmLabel: "Remove member",
      }))
    )
      return;
    if (
      body?.ownerId &&
      !(await confirm({
        title: "Transfer group ownership?",
        description:
          "This member will manage the group. You will become a regular member.",
        confirmLabel: "Transfer ownership",
      }))
    )
      return;
    await api(`/groups/${conversation.id}${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await load();
    await onChanged();
  }
  const candidates = people.filter(
    (p) => !details?.members.some((m) => m.id === p.id),
  );
  return (
    <dialog
      ref={dialog}
      className="group-dialog"
      aria-label={conversation ? "Group details" : "Create group"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>
          <Users size={22} /> {conversation ? "Group details" : "Create group"}
        </h2>
        <button
          className="icon-button"
          aria-label="Close group"
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
      <label>
        Group name
        <input
          aria-label="Group name"
          maxLength={60}
          value={name}
          disabled={busy || (!!conversation && !owner)}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {conversation ? (
        <>
          {owner && (
            <button
              disabled={busy || !name.trim()}
              onClick={() => action(() => change("", "PATCH", { name }))}
            >
              Save group name
            </button>
          )}
          <h3>Members ({details?.members.length || 0}/50)</h3>
          <ul className="group-members">
            {details?.members.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>{m.displayName}</strong>
                  <small>
                    @{m.username}
                    {m.id === details.ownerId ? " · Owner" : ""}
                  </small>
                </span>
                {owner && m.id !== userId && (
                  <span className="group-member-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(() => change("", "PATCH", { ownerId: m.id }))
                      }
                      aria-label={`Make ${m.displayName} owner`}
                    >
                      Make owner
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(() => change(`/members/${m.id}`, "DELETE"))
                      }
                      aria-label={`Remove ${m.displayName}`}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {details && !owner && (
            <button
              className="group-leave"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  if (
                    !(await confirm({
                      title: "Leave this group?",
                      description:
                        "You will lose access to this group's messages. A group owner will need to add you again.",
                      confirmLabel: "Leave group",
                    }))
                  )
                    return;
                  await api(`/groups/${conversation.id}/members/${userId}`, {
                    method: "DELETE",
                  });
                  await onChanged();
                  close();
                })
              }
            >
              Leave group
            </button>
          )}
          {owner && (
            <p className="group-help">
              Transfer ownership before leaving. New members can read previous
              messages.
            </p>
          )}
        </>
      ) : (
        <p className="group-help">
          Choose at least one other person. Up to 50 members, including you.
          Added members can read this group’s history.
        </p>
      )}
      {(!conversation || owner) && (
        <>
          <label>
            {conversation ? "Add people" : "Choose people"}
            <input
              aria-label="Search group members"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or username"
            />
          </label>
          {!conversation && chosen.length > 0 && (
            <div className="group-selected">
              {chosen.map((p) => (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() =>
                    setChosen((old) => old.filter((u) => u.id !== p.id))
                  }
                >
                  {p.displayName} ×
                </button>
              ))}
            </div>
          )}
          {candidates.length === 0 && (
            <p className="group-help">
              {search
                ? "No users match that search."
                : "No other users are available. Ask another person to register first."}
            </p>
          )}
          {!conversation && (
            <p className="group-help">
              {!name.trim()
                ? "Enter a group name."
                : chosen.length === 0
                  ? "Select at least one person below to create your group."
                  : `${chosen.length} selected · You are included automatically.`}
            </p>
          )}
          <div className="group-candidates">
            {candidates.map((p) => (
              <button
                key={p.id}
                disabled={
                  busy ||
                  (!conversation &&
                    !chosen.some((u) => u.id === p.id) &&
                    chosen.length >= 49)
                }
                aria-pressed={
                  !conversation ? chosen.some((u) => u.id === p.id) : undefined
                }
                onClick={() =>
                  conversation
                    ? action(() => change("/members", "POST", { userId: p.id }))
                    : setChosen((old) =>
                        old.some((u) => u.id === p.id)
                          ? old.filter((u) => u.id !== p.id)
                          : [...old, p],
                      )
                }
              >
                <span>
                  {p.displayName}
                  <small>@{p.username}</small>
                </span>
                <span>
                  {conversation
                    ? "Add"
                    : chosen.some((u) => u.id === p.id)
                      ? "Selected"
                      : "Select"}
                </span>
              </button>
            ))}
          </div>
          {!conversation && (
            <button
              className="group-create"
              disabled={busy || !name.trim() || chosen.length < 1}
              onClick={() =>
                action(async () => {
                  const d = await post("/groups", {
                    name,
                    userIds: chosen.map((p) => p.id),
                  });
                  await onCreated(d.id);
                  close();
                })
              }
            >
              Create group{chosen.length ? ` (${chosen.length + 1})` : ""}
            </button>
          )}
        </>
      )}
    </dialog>
  );
}
