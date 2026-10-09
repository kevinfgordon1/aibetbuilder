import { useCallback, useEffect, useState } from "react";
import { etTime } from "./comboBalances";
import { USER_ALERTS_POLL_MS, dismissUserAlerts, fetchOpenUserAlerts, lowCashText, openAlertsByUser, openUserAlerts } from "./lowCashAlerts.js";

/** Open low-cash alert rows (raw), re-read every minute. userId=null = all RLS allows (owner). */
export function useUserAlertRows(supabase, userId, enabled = true) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => { setRows(await fetchOpenUserAlerts(supabase, userId)); }, [supabase, userId]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = () => { if (alive && (typeof document === "undefined" || document.visibilityState !== "hidden")) load().catch(() => {}); };
    run();
    const t = setInterval(run, USER_ALERTS_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, load]);
  return { rows, setRows, reload: load };
}

/** Banner on Combo Locks: this user's own unread, unresolved low-cash alerts. */
export function LowCashBanner({ supabase, user, initialRows = null }) {
  const live = useUserAlertRows(supabase, user && user.id, !!user && !initialRows);
  const rows = initialRows || live.rows;
  const [hidden, setHidden] = useState([]);
  const list = openUserAlerts(rows).filter((a) => a.userId === (user && user.id) && !hidden.includes(a.id));
  if (!user || !list.length) return null;
  const dismiss = (ids) => { setHidden((h) => h.concat(ids)); if (!initialRows) dismissUserAlerts(supabase, ids); };
  const first = list[0];
  const t = lowCashText(first);
  const more = list.length - 1;
  return (
    <div role="status" data-testid="low-cash-banner" className="note warn" style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>⚠️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{t.title}</div>
        <div style={{ marginTop: 3, lineHeight: 1.45 }}>{t.body}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {first.createdAt ? `Since ${etTime(first.createdAt)}` : ""}
          {more > 0 ? ` · ${more} more lock${more === 1 ? "" : "s"} affected` : ""}
          {" · Clears on its own once your cash covers it."}
        </div>
      </div>
      <button type="button" className="btn mini" onClick={() => dismiss(list.map((a) => a.id))} aria-label="Dismiss low cash alert">Dismiss</button>
    </div>
  );
}

/** Owner "All users": one line per open low-cash alert, with whose it is. */
export function LowCashAdminList({ rows, nameFor }) {
  const by = openAlertsByUser(rows);
  const ids = Object.keys(by);
  if (!ids.length) return null;
  return (
    <div data-testid="low-cash-admin" style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Low cash alerts (open)</div>
      {ids.flatMap((id) => by[id].map((a) => (
        <div key={a.id} className="note warn" style={{ marginBottom: 6, fontSize: 12 }}>
          <b>{nameFor ? nameFor(id) : String(id).slice(0, 8)}</b>{" · "}{lowCashText(a).body}
          {a.createdAt ? <span className="muted"> · since {etTime(a.createdAt)}</span> : null}
        </div>
      )))}
    </div>
  );
}

/** Small chip for the Balance cell in All users. */
export function lowCashChip(alerts) {
  if (!alerts || !alerts.length) return null;
  const short = alerts.reduce((s, a) => s + (Number(a.shortfallUsd) || 0), 0);
  return <span className="chip warn" style={{ marginTop: 3, display: "inline-block" }} title={lowCashText(alerts[0]).body}>Low cash{short > 0 ? ` · ~$${short.toFixed(2)} short` : ""}</span>;
}
