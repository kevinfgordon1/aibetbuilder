// Combo Locks testers UI (kept out of ComboLocks.jsx so the page stays lean):
//   - Approved testers: "Connect your exchange" with masked status + Disconnect.
//   - Owner: collapsible "All users" admin view with pause/resume and caps.
// Keys go straight to /api/combo-keys (server only); the page never stores,
// logs, or re-displays a secret.
import { useCallback, useEffect, useMemo, useState } from "react";
import { canSeeOwnerTools } from "./comboAccess";
import {
  CONNECT_COPY, VENUE_HELP, VENUE_LABEL, capsLine, emptyForm, money, pnlByUser, signedMoney, userTradingState, venueStatusText,
} from "./comboTesters";

const TESTERS_CSS = `
.cl .tst{margin:0 0 14px}
.cl .tst .tst-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cl .tst .tst-title{font-weight:700;font-size:14px}
.cl .tst p{margin:6px 0;color:#b6bac2;font-size:13px;line-height:1.45}
.cl .tst .tst-venue{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06)}
.cl .tst .tst-venue:first-of-type{border-top:0}
.cl .tst textarea{width:100%;min-height:96px;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:12px/1.4 ui-monospace,Menlo,monospace}
.cl .tst .tst-form{display:grid;gap:10px;margin-top:8px;width:100%}
.cl .tst .tst-actions{display:flex;gap:8px;flex-wrap:wrap}
.cl .tst-table{width:100%;border-collapse:collapse;font-size:12.5px}
.cl .tst-table th{text-align:left;font-weight:600;color:#8a8f98;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap}
.cl .tst-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);vertical-align:top}
.cl .tst-scroll{overflow-x:auto}
.cl .tst .caps-edit{display:flex;gap:6px;align-items:center}
.cl .tst .caps-edit input{width:80px;padding:5px 7px}
@media (max-width:600px){.cl .tst-table thead{display:none}.cl .tst-table tr{display:block;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08)}.cl .tst-table td{display:flex;justify-content:space-between;gap:10px;border:0;padding:3px 0}.cl .tst-table td::before{content:attr(data-k);color:#8a8f98}}
`;

async function authedFetch(supabase, url, init = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) return { ok: false, status: 401, body: { error: "Sign in required" } };
  const r = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...(init.headers || {}), authorization: "Bearer " + token } });
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  return { ok: r.ok && body && body.ok !== false, status: r.status, body: body || {} };
}

function VenueRow({ venue, row, busy, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const help = VENUE_HELP[venue];
  const submit = async (e) => {
    e.preventDefault();
    const payload = { venue, key_id: form.keyId, secret: form.secret };
    setForm(emptyForm());
    const ok = await onConnect(payload);
    if (ok) setOpen(false);
  };
  return (
    <div className="tst-venue">
      <div>
        <div style={{ fontWeight: 600 }}>{venueStatusText(venue, row)}</div>
        {row && row.connected && row.scopeStatus === "unverified" && (
          <div className="muted" style={{ fontSize: 12 }}>{venue === "kalshi" ? "Permissions not confirmed. The owner will review this key." : "Polymarket US keys have no permission settings."}</div>
        )}
        {venue === "polymarket_us" && !(row && row.connected) && <div className="muted" style={{ fontSize: 12 }}>Optional</div>}
      </div>
      <div className="tst-actions">
        {row && row.connected
          ? <button type="button" className="btn mini danger" disabled={busy} onClick={() => onDisconnect(venue)}>Disconnect</button>
          : !open && <button type="button" className="btn mini primary" disabled={busy} onClick={() => setOpen(true)}>Connect {VENUE_LABEL[venue]}</button>}
      </div>
      {open && !(row && row.connected) && (
        <form className="tst-form" onSubmit={submit} autoComplete="off">
          <div className="muted" style={{ fontSize: 12 }}>{help.where}</div>
          <div>
            <label htmlFor={`k-${venue}`}>{help.idLabel}</label>
            <input id={`k-${venue}`} name={`combo-${venue}-key-id`} value={form.keyId} autoComplete="off" spellCheck={false}
              onChange={(e) => setForm((f) => ({ ...f, keyId: e.target.value }))} />
          </div>
          <div>
            <label htmlFor={`s-${venue}`}>{help.secretLabel}</label>
            <textarea id={`s-${venue}`} name={`combo-${venue}-secret`} value={form.secret} autoComplete="off" spellCheck={false} placeholder={help.secretPlaceholder}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} />
          </div>
          <div className="tst-actions">
            <button type="submit" className="btn mini primary" disabled={busy || !form.keyId.trim() || !form.secret.trim()}>{busy ? "Checking…" : "Check & save key"}</button>
            <button type="button" className="btn mini" disabled={busy} onClick={() => { setForm(emptyForm()); setOpen(false); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function ConnectPanel({ supabase, status, setStatus }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const connect = async (payload) => {
    setBusy(true); setMsg(null);
    try {
      const r = await authedFetch(supabase, "/api/combo-keys", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) { setMsg({ tone: "warn", text: r.body.error || "Could not save the key." }); return false; }
      setStatus(r.body);
      const warn = (r.body.warnings || []).join(" ");
      setMsg({ tone: warn ? "warn" : "ok", text: `${VENUE_LABEL[payload.venue]} connected.${warn ? " " + warn : ""}` });
      return true;
    } finally { setBusy(false); }
  };
  const disconnect = async (venue) => {
    if (!window.confirm(`Disconnect ${VENUE_LABEL[venue]}? Quoting on that account stops within a minute. Also delete the key at ${VENUE_LABEL[venue]} if you no longer need it.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await authedFetch(supabase, `/api/combo-keys?venue=${encodeURIComponent(venue)}`, { method: "DELETE" });
      if (!r.ok) { setMsg({ tone: "warn", text: r.body.error || "Could not disconnect." }); return; }
      setStatus(r.body);
      setMsg({ tone: "ok", text: `${VENUE_LABEL[venue]} disconnected. The key was deleted from our server.` });
    } finally { setBusy(false); }
  };
  return (
    <div className="card tst">
      <div className="tst-head">
        <div className="tst-title">{CONNECT_COPY.title}</div>
        <span className={"chip" + (status.paused ? " loss" : "")}>{status.paused ? "Paused by owner" : `Your limits: ${capsLine(status.caps)}`}</span>
      </div>
      <p>{CONNECT_COPY.intro}</p>
      <p>{CONNECT_COPY.keyAdvice}</p>
      <p style={{ color: "#fcd34d" }}>{CONNECT_COPY.never}</p>
      {msg && <div className={"note " + msg.tone} style={{ margin: "8px 0" }}>{msg.text}</div>}
      {["kalshi", "polymarket_us"].map((v) => (
        <VenueRow key={v} venue={v} row={status.venues && status.venues[v]} busy={busy} onConnect={connect} onDisconnect={disconnect} />
      ))}
    </div>
  );
}

function CapsEditor({ user, busy, onSave }) {
  const [lock, setLock] = useState(user.caps.perLockUsd ?? "");
  const [day, setDay] = useState(user.caps.perDayUsd ?? "");
  return (
    <span className="caps-edit">
      <input aria-label="Max per lock" placeholder="$ / lock" title="Max $ per lock" inputMode="decimal" value={lock} onChange={(e) => setLock(e.target.value)} />
      <input aria-label="Max per day" placeholder="$ / day" title="Max $ per day" inputMode="decimal" value={day} onChange={(e) => setDay(e.target.value)} />
      <span className="muted" style={{ fontSize: 11 }}>lock / day</span>
      <button type="button" className="btn mini" disabled={busy} onClick={() => onSave(user, lock, day)}>Save</button>
    </span>
  );
}

function AdminPanel({ supabase }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState(null);
  const [pnl, setPnl] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    setErr(null);
    const r = await authedFetch(supabase, "/api/combo-admin");
    if (!r.ok) { setErr(r.body.error || "Could not load users."); return; }
    setUsers(r.body.users || []);
    // Owner RLS reads every user's locks + fills; P/L uses the statement math.
    const [pq, fq] = await Promise.all([
      supabase.from("combo_parlays").select("*").limit(5000),
      supabase.from("combo_fills").select("parlay_id,count,user_id").eq("is_combo", true).eq("is_taker", false).limit(10000),
    ]);
    if (!pq.error && !fq.error) setPnl(pnlByUser(pq.data || [], fq.data || []));
  }, [supabase]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const act = async (body) => {
    setBusy(true); setErr(null);
    try {
      const r = await authedFetch(supabase, "/api/combo-admin", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) { setErr(r.body.error || "Action failed."); return; }
      setUsers(r.body.users || []);
      setEditing(null);
    } finally { setBusy(false); }
  };
  const rows = users || [];
  const testers = useMemo(() => rows.filter((u) => u.in_live_users && !u.is_owner && u.desk !== "server_keys").length, [rows]);
  return (
    <div className="card tst">
      <div className="tst-head">
        <div className="tst-title">All users {users ? <span className="muted" style={{ fontWeight: 400 }}>· {rows.length} with locks or access · {testers} approved tester{testers === 1 ? "" : "s"}</span> : null}</div>
        <div className="tst-actions">
          {open && <button type="button" className="btn mini" disabled={busy} onClick={load}>Refresh</button>}
          <button type="button" className="btn mini" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </div>
      </div>
      {open && err && <div className="note warn" style={{ marginTop: 8 }}>{err}</div>}
      {open && !users && !err && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
      {open && users && (
        <div className="tst-scroll" style={{ marginTop: 8 }}>
          <table className="tst-table num">
            <thead><tr><th>User</th><th>Status</th><th>Limits</th><th>Kalshi</th><th>Polymarket US</th><th>Locks</th><th>Orders 30d</th><th>Fills</th><th>Realized P/L</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => {
                const st = userTradingState(u);
                const p = pnl[u.user_id];
                const ownerDesk = u.desk === "server_keys";
                return (
                  <tr key={u.user_id}>
                    <td data-k="User"><div>{u.email || u.user_id.slice(0, 8)}</div>{u.is_owner && <div className="muted" style={{ fontSize: 11 }}>owner</div>}</td>
                    <td data-k="Status"><span className={"chip " + st.tone}>{st.label}</span></td>
                    <td data-k="Limits">{editing === u.user_id
                      ? <CapsEditor user={u} busy={busy} onSave={(usr, lock, day) => act({ action: "caps", user_id: usr.user_id, max_per_lock_usd: lock, max_per_day_usd: day })} />
                      : ownerDesk ? "No limits" : u.in_live_users ? capsLine(u.caps) : "—"}</td>
                    <td data-k="Kalshi">{ownerDesk ? "Server keys" : u.keys.kalshi.connected ? `••••${u.keys.kalshi.hint}${u.keys.kalshi.scopeStatus === "unverified" ? " (review)" : ""}` : "—"}</td>
                    <td data-k="Polymarket US">{ownerDesk ? "Server keys" : u.keys.polymarket_us.connected ? `••••${u.keys.polymarket_us.hint}` : "—"}</td>
                    <td data-k="Locks">{u.locks.active} active / {u.locks.total}</td>
                    <td data-k="Orders 30d">{u.orders.last30d}</td>
                    <td data-k="Fills">{u.fills.count} · {Math.round(u.fills.contracts).toLocaleString("en-US")} ct{u.fills.todayContracts ? ` · ${Math.round(u.fills.todayContracts)} today` : ""}</td>
                    <td data-k="Realized P/L"><span className={p && p.realized < 0 ? "neg" : p && p.realized > 0 ? "pos" : ""}>{p ? signedMoney(p.realized) : "—"}</span>{p && p.pending ? <span className="muted"> · {p.pending} open</span> : null}</td>
                    <td data-k="">
                      {!u.is_owner && (
                        <span className="tst-actions">
                          {u.paused
                            ? <button type="button" className="btn mini" disabled={busy} onClick={() => act({ action: "resume", user_id: u.user_id })}>Resume</button>
                            : <button type="button" className="btn mini danger" disabled={busy} onClick={() => { if (window.confirm(`Pause ${u.email || "this user"}? Their kill switch is engaged and quoting stops within a minute.`)) act({ action: "pause", user_id: u.user_id }); }}>Pause</button>}
                          {u.in_live_users && !ownerDesk && editing !== u.user_id && <button type="button" className="btn mini" disabled={busy} onClick={() => setEditing(u.user_id)}>Limits</button>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Keys are shown masked only. Testers trade on their own accounts. Kevin's desk uses the server keys. Pause engages the user's kill switch; Resume clears only your pause, and the user re-arms their own kill switch.</div>
        </div>
      )}
    </div>
  );
}

export default function ComboTesters({ user, supabase }) {
  const isOwner = canSeeOwnerTools(user);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!user || isOwner) return undefined;
    authedFetch(supabase, "/api/combo-keys").then((r) => { if (alive && r.ok) setStatus(r.body); }).catch(() => {});
    return () => { alive = false; };
  }, [user, isOwner, supabase]);
  if (!user) return null;
  return (
    <>
      <style>{TESTERS_CSS}</style>
      {isOwner && <AdminPanel supabase={supabase} />}
      {!isOwner && status && status.approved && <ConnectPanel supabase={supabase} status={status} setStatus={setStatus} />}
    </>
  );
}
