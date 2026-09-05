import { useEffect, useRef } from "react";

function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.disabled);
}

export default function WhatsNewModal({ announcement, onDismiss }) {
  const dialogRef = useRef(null);
  const titleId = "whats-new-title";
  const bodyId = "whats-new-body";
  const title = announcement && announcement.title ? announcement.title : "What’s new";
  const body = announcement && announcement.body ? String(announcement.body) : "";
  const cta = announcement && announcement.cta;

  useEffect(() => {
    const root = dialogRef.current;
    const prev = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = focusableIn(root);
    const primary = items.find((el) => el.dataset.primary === "true") || items[0];
    if (primary) primary.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onDismiss) onDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusableIn(root);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [onDismiss]);

  const close = () => { if (onDismiss) onDismiss(); };

  return (
    <div
      className="wn"
      data-guard-allow="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <style>{`
        .wn{position:fixed;inset:0;z-index:80;background:rgba(6,7,10,.72);display:flex;align-items:center;justify-content:center;padding:24px;font-family:'DM Sans',sans-serif}
        .wn-dialog{width:min(440px,100%);background:#12141a;color:#e8eaed;border:1px solid rgba(255,255,255,.1);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.45);padding:22px 22px 18px;position:relative}
        .wn-kicker{font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#60a5fa;margin:0 0 8px}
        .wn h2{margin:0 28px 10px 0;font-size:20px;font-weight:700;letter-spacing:-.3px}
        .wn .wn-body{margin:0 0 18px;font-size:14px;line-height:1.55;color:#9ca3af}
        .wn .wn-body p{margin:0 0 10px}
        .wn .wn-body p:last-child{margin:0}
        .wn .wn-x{position:absolute;top:12px;right:12px;width:32px;height:32px;border:none;border-radius:8px;background:transparent;color:#9ca3af;font-size:20px;line-height:1;cursor:pointer}
        .wn .wn-x:hover,.wn .wn-x:focus-visible{background:rgba(255,255,255,.06);color:#e8eaed;outline:none}
        .wn .wn-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px}
        .wn .wn-cta{color:#93c5fd;font-size:13px;font-weight:600;text-decoration:none}
        .wn .wn-cta:hover{text-decoration:underline}
        .wn .wn-gotit{background:#3b82f6;border:1px solid #3b82f6;color:#fff;font:inherit;font-weight:700;font-size:13px;padding:9px 16px;border-radius:8px;cursor:pointer}
        .wn .wn-gotit:hover,.wn .wn-gotit:focus-visible{background:#2563eb;outline:none}
      `}</style>
      <div
        ref={dialogRef}
        className="wn-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <button type="button" className="wn-x" aria-label="Close" onClick={close}>×</button>
        <div className="wn-kicker">Updates</div>
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="wn-body">
          {body.split("\n").filter(Boolean).map((para, i) => <p key={i}>{para}</p>)}
        </div>
        <div className="wn-actions">
          {cta && cta.label && cta.href ? (
            <a className="wn-cta" href={cta.href}>{cta.label}</a>
          ) : null}
          <button type="button" className="wn-gotit" data-primary="true" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
