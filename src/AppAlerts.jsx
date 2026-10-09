import { Component, useCallback, useEffect, useRef, useState } from "react";
import {
  APP_ALERTS_POLL_MS,
  alertAgeLabel,
  bannerAlerts,
  bellLabel,
  canSeeAppAlerts,
  fetchUnreadAppAlerts,
  markAppAlertsRead,
} from "./appAlerts.js";

const SEV = {
  info: { bar: "#3b82f6", bg: "rgba(59,130,246,0.10)", dot: "#60a5fa" },
  warn: { bar: "#f59e0b", bg: "rgba(245,158,11,0.10)", dot: "#fbbf24" },
  error: { bar: "#ef4444", bg: "rgba(239,68,68,0.12)", dot: "#f87171" },
};

// Shared state so the header bell and the banner under it stay in sync.
export function useAppAlerts(supabase, user, { initial = null } = {}) {
  const allowed = canSeeAppAlerts(user);
  const [alerts, setAlerts] = useState(() => (Array.isArray(initial) ? initial : []));
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    const next = await fetchUnreadAppAlerts(supabase, user);
    if (alive.current) setAlerts(next);
  }, [allowed, supabase, user && user.id]);

  useEffect(() => {
    alive.current = true;
    if (!allowed) { setAlerts([]); return undefined; }
    if (initial) return () => { alive.current = false; };
    refresh();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") refresh();
    }, APP_ALERTS_POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [allowed, refresh]);

  const dismiss = useCallback(async (ids) => {
    const list = [].concat(ids || []);
    setAlerts((cur) => cur.filter((a) => !list.includes(a.id)));
    if (initial) return;
    const ok = await markAppAlertsRead(supabase, user, list);
    if (!ok) refresh();
  }, [supabase, user && user.id, refresh]);

  // alerts = full unread history (bell panel); visible = banner/badge set
  // (self-healed stall alerts the worker already resolved, and log-only kinds
  // such as routine bucket transfers, are left out).
  const all = allowed ? alerts : [];
  return { alerts: all, visible: bannerAlerts(all), dismiss, refresh, allowed };
}

export function AppAlertsBell({ state, open, onToggle }) {
  if (!state.allowed) return null;
  const visible = state.visible || state.alerts;
  const n = visible.length;
  const history = state.alerts.length - n;
  const label = bellLabel(n);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={n ? `${n} unread alerts` : (history ? `Alerts (${history} in history)` : "Alerts")}
      aria-expanded={open}
      title={n ? `${n} unread alert${n === 1 ? "" : "s"}` : (history ? `No active alerts (${history} logged in history)` : "No unread alerts")}
      data-testid="app-alerts-bell"
      style={{
        position: "relative", background: open ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: n ? "#fbbf24" : "#9ca3af",
        width: 34, height: 34, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
      }}
    >
      <span aria-hidden="true">🔔</span>
      {label && (
        <span style={{
          position: "absolute", top: -6, right: -6, minWidth: 17, height: 17, padding: "0 4px",
          borderRadius: 9, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
        }}>{label}</span>
      )}
    </button>
  );
}

function AlertRow({ a, onDismiss, now }) {
  const c = SEV[a.severity] || SEV.info;
  return (
    <div role="status" style={{
      display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 14px",
      background: c.bg, borderLeft: `3px solid ${c.bar}`, borderRadius: 8,
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: c.dot, marginTop: 6, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f3f4f6" }}>{a.title}</span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>{alertAgeLabel(a.createdAt, now)}</span>
        </div>
        {a.body && <div style={{ fontSize: 12, color: "#c7cbd3", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" }}>{a.body}</div>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss([a.id])}
        aria-label={`Dismiss: ${a.title}`}
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#d1d5db", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flex: "0 0 auto" }}
      >Dismiss</button>
    </div>
  );
}

// Banner under the header: newest unread alerts (up to `max`), each dismissible.
// The bell panel (open) shows all of them.
export function AppAlertsBanner({ state, open, max = 3, now = Date.now() }) {
  // Closed: only alerts still needing attention. Open (bell panel): full history.
  const list = open ? state.alerts : (state.visible || state.alerts);
  if (!state.allowed || !list.length) return null;
  const shown = open ? list : list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <div data-guard-allow="true" data-testid="app-alerts-banner" style={{ padding: "12px 32px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      {shown.map((a) => <AlertRow key={a.id} a={a} onDismiss={state.dismiss} now={now} />)}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", fontSize: 11, color: "#6b7280" }}>
        {hidden > 0 && <span>+{hidden} more — open the bell</span>}
        {list.length > 1 && (
          <button
            type="button"
            onClick={() => state.dismiss(list.map((a) => a.id))}
            style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}
          >Dismiss all</button>
        )}
      </div>
    </div>
  );
}

// Render errors here must never take down the page.
export class AppAlertsBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {}
  render() { return this.state.failed ? null : this.props.children; }
}
