import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";
const Context = createContext(null);
export const useConfirm = () => useContext(Context);
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const pending = useRef(null);
  const confirm = useCallback((options) => {
    // Ignore double-clicks while another decision is open.
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setRequest(options);
    });
  }, []);
  const finish = useCallback((value) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  return (
    <Context.Provider value={confirm}>
      {children}
      {request &&
        createPortal(
          <Confirmation request={request} finish={finish} />,
          document.body,
        )}
    </Context.Provider>
  );
}
function Confirmation({ request, finish }) {
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node.showModal();
    cancel.current.focus();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const close = (value) => {
    dialog.current.close();
    finish(value);
  };
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-description"
      onCancel={(e) => {
        e.preventDefault();
        close(false);
      }}
    >
      <div className="confirmation-top">
        <span className="confirmation-icon">
          <ShieldAlert size={25} />
        </span>
        <button
          className="icon-button"
          aria-label="Close confirmation"
          onClick={() => close(false)}
        >
          <X size={20} />
        </button>
      </div>
      <span className="small-label">YOU'RE IN CONTROL</span>
      <h2 id="confirmation-title">{request.title}</h2>
      <p id="confirmation-description">{request.description}</p>
      <div className="confirmation-actions">
        <button
          ref={cancel}
          className="confirm-cancel"
          onClick={() => close(false)}
        >
          Cancel
        </button>
        <button className="confirm-accept" onClick={() => close(true)}>
          {request.confirmLabel || "Confirm"}
        </button>
      </div>
    </dialog>
  );
}
