// Confirmation / error popup after Add lock. Auto-closes on success.
import { useEffect, useRef } from "react";

export default function ComboLockSubmitted({ toast, onClose }) {
  const dialogRef = useRef(null);
  const ok = toast && toast.kind === "ok";
  const err = toast && toast.kind === "error";

  useEffect(() => {
    if (!toast) return undefined;
    const prev = document.activeElement;
    const btn = dialogRef.current && dialogRef.current.querySelector("[data-primary]");
    if (btn) btn.focus();
    let timer = null;
    if (ok && toast.autoMs > 0) {
      timer = setTimeout(() => { if (onClose) onClose(); }, toast.autoMs);
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onClose) onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [toast, ok, onClose]);

  if (!toast) return null;

  return (
    <div
      className="cls-toast"
      data-testid="combo-lock-submitted"
      data-kind={toast.kind}
      onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <style>{`
        .cls-toast{position:fixed;inset:0;z-index:90;background:rgba(6,7,10,.68);display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));font-family:'DM Sans',system-ui,sans-serif}
        @media (min-width:560px){.cls-toast{align-items:center;padding:24px}}
        .cls-card{width:min(420px,100%);background:#12141a;color:#e8eaed;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 20px 56px rgba(0,0,0,.5);padding:20px 18px 16px;position:relative}
        .cls-card.ok{border-color:rgba(52,211,153,.35)}
        .cls-card.err{border-color:rgba(248,113,113,.4)}
        .cls-kicker{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;margin:0 0 6px}
        .cls-card.ok .cls-kicker{color:#6ee7b7}
        .cls-card.err .cls-kicker{color:#fca5a5}
        .cls-card h2{margin:0 36px 12px 0;font-size:20px;font-weight:700;letter-spacing:-.3px;line-height:1.25}
        .cls-legs{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}
        .cls-legs li{padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-size:14px;font-weight:600;line-height:1.35}
        .cls-fill{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:0 0 12px;padding:10px 12px;border-radius:10px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.28)}
        .cls-fill .k{font-size:12px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:.4px}
        .cls-fill .v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:#e8eaed}
        .cls-note{margin:0 0 14px;font-size:14px;line-height:1.5;color:#9ca3af}
        .cls-err-msg{margin:0 0 14px;font-size:14px;line-height:1.5;color:#fecaca}
        .cls-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border:none;border-radius:10px;background:transparent;color:#9ca3af;font-size:22px;line-height:1;cursor:pointer}
        .cls-x:hover,.cls-x:focus-visible{background:rgba(255,255,255,.08);color:#e8eaed;outline:none}
        .cls-actions{display:flex;justify-content:flex-end}
        .cls-ok{background:#3b82f6;border:1px solid #3b82f6;color:#fff;font:inherit;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px;cursor:pointer;min-height:44px}
        .cls-ok:hover,.cls-ok:focus-visible{background:#2563eb;outline:none}
        .cls-card.err .cls-ok{background:#ef4444;border-color:#ef4444}
        .cls-card.err .cls-ok:hover,.cls-card.err .cls-ok:focus-visible{background:#dc2626}
      `}</style>
      <div
        ref={dialogRef}
        className={"cls-card " + (ok ? "ok" : "err")}
        role={err ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="cls-title"
        aria-describedby={ok ? "cls-note" : "cls-err"}
      >
        <button type="button" className="cls-x" aria-label="Close" onClick={onClose}>×</button>
        <div className="cls-kicker">{ok ? "You're set" : "Error"}</div>
        <h2 id="cls-title">{toast.title}</h2>
        {ok ? (
          <>
            {toast.legs && toast.legs.length > 0 && (
              <ul className="cls-legs">
                {toast.legs.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
            {toast.fillText ? (
              <div className="cls-fill">
                <span className="k">{toast.fillLabel || "Your sell price"}</span>
                <span className="v num">{toast.fillText}</span>
              </div>
            ) : null}
            <p className="cls-note" id="cls-note">{toast.note}</p>
          </>
        ) : (
          <p className="cls-err-msg" id="cls-err">{toast.message}</p>
        )}
        <div className="cls-actions">
          <button type="button" className="cls-ok" data-primary="true" onClick={onClose}>
            {ok ? "Got it" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
