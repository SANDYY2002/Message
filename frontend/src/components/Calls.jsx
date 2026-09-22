import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Phone,
  Video,
  PhoneOff,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  History,
  X,
} from "lucide-react";
import { api } from "../api";

function request(socket, event, data) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected)
      return reject(new Error("Reconnect before making a call."));
    socket.timeout(10000).emit(event, data, (timeout, result) => {
      if (timeout)
        reject(
          new Error("Call request timed out. Please reconnect and try again."),
        );
      else if (!result?.ok) reject(new Error(result?.error || "Call failed."));
      else resolve(result);
    });
  });
}
function Media({ stream, local = false, video = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.srcObject = stream || null;
      el.play().catch(() => {});
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);
  return video ? (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={local}
      controls={!local}
      aria-label={local ? "Your camera" : "Remote video"}
    />
  ) : (
    <audio ref={ref} autoPlay controls aria-label="Call audio" />
  );
}
export default function Calls({ socket, selected, user, connected }) {
  const current = useRef(null),
    dialog = useRef(null),
    historyDialog = useRef(null);
  const [call, setCall] = useState(null),
    [error, setError] = useState("");
  const [local, setLocal] = useState(null),
    [remote, setRemote] = useState(null);
  const [muted, setMuted] = useState(false),
    [cameraOff, setCameraOff] = useState(false);
  const [history, setHistory] = useState(null),
    [hasMore, setHasMore] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false);
  const historySeq = useRef(0),
    historyOpen = useRef(false);
  function show(c) {
    if (current.current === c) setCall({ ...c });
  }
  function clear(message = "") {
    const c = current.current;
    current.current = null;
    if (c) {
      clearTimeout(c.timer);
      clearTimeout(c.disconnectTimer);
      c.pc?.close();
      c.stream?.getTracks().forEach((t) => t.stop());
    }
    setCall(null);
    setLocal(null);
    setRemote(null);
    setMuted(false);
    setCameraOff(false);
    if (message) setError(message);
  }
  function end(message = "") {
    const c = current.current;
    if (c?.callId)
      request(socket, "call:end", { callId: c.callId }).catch(() => {});
    clear(message);
  }
  function guard(c) {
    if (current.current !== c) throw new Error("Call ended.");
  }
  async function prepare(c) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error(
        "Calling needs a supported browser on HTTPS or localhost.",
      );
    const { iceServers } = await api("/calls/config");
    guard(c);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: c.kind === "video",
    });
    if (current.current !== c) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Call ended.");
    }
    c.stream = stream;
    setLocal(stream);
    const pc = new RTCPeerConnection({ iceServers });
    c.pc = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (e) => {
      if (current.current === c)
        setRemote(e.streams[0] || new MediaStream([e.track]));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && current.current === c) {
        request(socket, "call:signal", {
          callId: c.callId,
          signal: { type: "candidate", candidate: e.candidate.toJSON() },
        }).catch(() => {
          if (current.current === c) end("Call connection was lost.");
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (current.current !== c) return;
      if (pc.connectionState === "connected") {
        clearTimeout(c.timer);
        clearTimeout(c.disconnectTimer);
        c.phase = "Connected";
        show(c);
      } else if (pc.connectionState === "failed")
        end(
          "Could not connect the call. A TURN relay may be needed for these networks.",
        );
      else if (pc.connectionState === "disconnected") {
        c.phase = "Reconnecting…";
        show(c);
        clearTimeout(c.disconnectTimer);
        c.disconnectTimer = setTimeout(() => {
          if (current.current === c) end("Call disconnected.");
        }, 15000);
      }
    };
  }
  function connecting(c) {
    clearTimeout(c.timer);
    c.phase = "Connecting…";
    show(c);
    c.timer = setTimeout(() => {
      if (current.current === c)
        end(
          "The call could not connect. Check your network and TURN configuration.",
        );
    }, 35000);
  }
  async function start(kind) {
    if (current.current || !selected) return;
    setError("");
    const c = {
      kind,
      peerName: selected.peer.displayName,
      conversationId: selected.id,
      phase: "Preparing microphone…",
      incoming: false,
      candidates: [],
      chain: Promise.resolve(),
    };
    current.current = c;
    show(c);
    try {
      await prepare(c);
      guard(c);
      const result = await request(socket, "call:start", {
        conversationId: c.conversationId,
        kind,
      });
      if (current.current !== c) {
        request(socket, "call:end", { callId: result.callId }).catch(() => {});
        return;
      }
      c.callId = result.callId;
      c.phase = "Ringing…";
      show(c);
      c.timer = setTimeout(() => {
        if (current.current === c) end("No answer.");
      }, 35000);
    } catch (e) {
      if (current.current === c) end(e.message);
    }
  }
  async function accept() {
    const c = current.current;
    if (!c || c.phase !== "Incoming call") return;
    c.phase = "Preparing microphone…";
    show(c);
    try {
      await prepare(c);
      guard(c);
      connecting(c);
      await request(socket, "call:accept", { callId: c.callId });
    } catch (e) {
      if (current.current === c) end(e.message);
    }
  }
  async function loadHistory(older = false) {
    const seq = ++historySeq.current;
    setHistoryBusy(true);
    try {
      const before =
        older && history?.length ? `?before=${history.at(-1).id}` : "";
      const result = await api(`/calls${before}`);
      if (seq !== historySeq.current) return;
      setHistory((old) =>
        older ? [...(old || []), ...result.calls] : result.calls,
      );
      setHasMore(result.hasMore);
    } catch (e) {
      setError(e.message);
    } finally {
      if (seq === historySeq.current) setHistoryBusy(false);
    }
  }
  useEffect(() => {
    if (!socket) return;
    const incoming = (data) => {
      if (current.current) return;
      historyDialog.current?.close();
      historyOpen.current = false;
      const c = {
        ...data,
        peerName: data.callerName,
        incoming: true,
        phase: "Incoming call",
        candidates: [],
        chain: Promise.resolve(),
      };
      current.current = c;
      setError("");
      show(c);
    };
    const accepted = async (data) => {
      const c = current.current;
      if (!c || c.callId !== data.callId || !c.pc || c.incoming) return;
      try {
        connecting(c);
        const offer = await c.pc.createOffer();
        guard(c);
        await c.pc.setLocalDescription(offer);
        guard(c);
        await request(socket, "call:signal", {
          callId: c.callId,
          signal: { type: "offer", sdp: offer.sdp },
        });
      } catch (e) {
        if (current.current === c) end(e.message);
      }
    };
    const signal = (data) => {
      const c = current.current;
      if (!c || c.callId !== data.callId || !c.pc) return;
      c.chain = c.chain
        .then(async () => {
          guard(c);
          const s = data.signal;
          if (s.type === "candidate") {
            if (!c.pc.remoteDescription) {
              if (c.candidates.length < 150) c.candidates.push(s.candidate);
            } else await c.pc.addIceCandidate(s.candidate);
          } else {
            await c.pc.setRemoteDescription(s);
            guard(c);
            for (const candidate of c.candidates)
              await c.pc.addIceCandidate(candidate);
            c.candidates = [];
            if (s.type === "offer") {
              const answer = await c.pc.createAnswer();
              guard(c);
              await c.pc.setLocalDescription(answer);
              guard(c);
              await request(socket, "call:signal", {
                callId: c.callId,
                signal: { type: "answer", sdp: answer.sdp },
              });
            }
          }
        })
        .catch((e) => {
          if (current.current === c) end(e.message);
        });
    };
    const ended = (d) => {
      if (current.current?.callId === d.callId)
        clear(
          {
            missed: "Missed call / no answer.",
            declined: "Call declined.",
            cancelled: "Call cancelled.",
            disconnected: "Call disconnected.",
            failed: "Call failed.",
          }[d.status] || "Call ended.",
        );
    };
    const claimed = (d) => {
      if (current.current?.callId === d.callId && d.socketId !== socket.id)
        clear("Call answered on another device.");
    };
    const disconnected = () => {
      if (current.current)
        clear("Call ended because the server connection was lost.");
    };
    const refresh = () => {
      if (historyOpen.current) loadHistory();
    };
    const handlers = {
      "call:incoming": incoming,
      "call:accepted": accepted,
      "call:signal": signal,
      "call:ended": ended,
      "call:claimed": claimed,
      disconnect: disconnected,
      "call:history": refresh,
    };
    for (const [name, handler] of Object.entries(handlers))
      socket.on(name, handler);
    return () => {
      const c = current.current;
      if (c?.callId && socket.connected)
        socket.emit("call:end", { callId: c.callId }, () => {});
      for (const [name, handler] of Object.entries(handlers))
        socket.off(name, handler);
      clear();
    };
  }, [socket]);
  useEffect(() => {
    if (call && !dialog.current?.open) dialog.current?.showModal();
    else if (!call) dialog.current?.close();
  }, [!!call]);
  function toggle(kind) {
    const tracks =
      current.current?.stream?.getTracks().filter((t) => t.kind === kind) || [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((t) => {
      t.enabled = enabled;
    });
    kind === "audio" ? setMuted(!enabled) : setCameraOff(!enabled);
  }
  return (
    <>
      <div className="call-toolbar">
        {selected && !selected.isGroup && (
          <>
            <button
              className="icon-button"
              title="Voice call"
              aria-label="Voice call"
              disabled={!connected || !!call}
              onClick={() => start("voice")}
            >
              <Phone size={19} />
            </button>
            <button
              className="icon-button"
              title="Video call"
              aria-label="Video call"
              disabled={!connected || !!call}
              onClick={() => start("video")}
            >
              <Video size={19} />
            </button>
          </>
        )}
        <button
          className="icon-button"
          title="Call history"
          aria-label="Call history"
          onClick={() => {
            historyOpen.current = true;
            historyDialog.current.showModal();
            loadHistory();
          }}
        >
          <History size={19} />
        </button>
        {error && (
          <span role="status" className="call-notice">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss call notice"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </span>
        )}
      </div>
      {createPortal(
        <>
          <dialog
            ref={dialog}
            className="call-dialog"
            aria-label="Call"
            onCancel={(e) => {
              e.preventDefault();
              end();
            }}
          >
            {call && (
              <>
                <p className="call-eyebrow">
                  {call.kind === "video" ? "Video call" : "Voice call"}
                </p>
                <h2>{call.peerName}</h2>
                <p role="status">{call.phase}</p>
                {call.kind === "video" && (
                  <div className="call-videos">
                    <Media stream={remote} />
                    <div className="call-self">
                      <Media stream={local} local />
                    </div>
                  </div>
                )}
                {call.kind === "voice" && (
                  <Media stream={remote} video={false} />
                )}
                <div className="call-controls">
                  {call.phase === "Incoming call" ? (
                    <button className="primary-button" onClick={accept}>
                      Accept call
                    </button>
                  ) : (
                    <>
                      <button
                        className="icon-button"
                        aria-label={
                          muted ? "Unmute microphone" : "Mute microphone"
                        }
                        disabled={!local}
                        onClick={() => toggle("audio")}
                      >
                        {muted ? <MicOff /> : <Mic />}
                      </button>
                      {call.kind === "video" && (
                        <button
                          className="icon-button"
                          aria-label={
                            cameraOff ? "Turn camera on" : "Turn camera off"
                          }
                          disabled={!local}
                          onClick={() => toggle("video")}
                        >
                          {cameraOff ? <CameraOff /> : <Camera />}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    className="call-hangup"
                    onClick={() => end()}
                    aria-label={
                      call.phase === "Incoming call"
                        ? "Decline call"
                        : "End call"
                    }
                  >
                    <PhoneOff size={20} />
                    {call.phase === "Incoming call" ? "Decline" : "End call"}
                  </button>
                </div>
              </>
            )}
          </dialog>
          <dialog
            ref={historyDialog}
            className="call-dialog call-history"
            aria-label="Call history"
            onClose={() => {
              historyOpen.current = false;
            }}
          >
            <div className="call-history-heading">
              <h2>Call history</h2>
              <button
                className="icon-button"
                aria-label="Close call history"
                onClick={() => historyDialog.current.close()}
              >
                <X />
              </button>
            </div>
            {historyBusy && <p role="status">Loading calls…</p>}
            {history?.length === 0 && <p>No calls yet.</p>}
            <ul>
              {history?.map((h) => (
                <li key={h.id}>
                  {h.kind === "video" ? (
                    <Video size={18} />
                  ) : (
                    <Phone size={18} />
                  )}
                  <div>
                    <strong>{h.peerName}</strong>
                    <p>
                      {h.callerId === user.id ? "Outgoing" : "Incoming"} ·{" "}
                      {h.status === "missed" && h.calleeId === user.id
                        ? "Missed call"
                        : h.status}
                      <br />
                      <time>{new Date(h.createdAt).toLocaleString()}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                className="primary-button"
                disabled={historyBusy}
                onClick={() => loadHistory(true)}
              >
                Older calls
              </button>
            )}
          </dialog>
        </>,
        document.body,
      )}
    </>
  );
}
