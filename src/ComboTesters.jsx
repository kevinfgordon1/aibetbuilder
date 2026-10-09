// Combo Locks testers UI (kept out of ComboLocks.jsx so the page stays lean):
//   - Approved testers: "Connect your exchange" with masked status + Disconnect.
//   - Owner: collapsible "All users" admin view with pause/resume and caps.
//   - "Available to trade" (testers on their card, Kevin on his server-keys card)
//     and a Balance column in "All users". Balances come from public.combo_balances,
//     written every ~60s by combo-worker with each account's own keys (RLS: own rows,
//     owner sees all). The browser never calls an exchange and never sees a key.
// Keys go straight to /api/combo-keys (server only); the page never stores,
// logs, or re-displays a secret.
import { useCallback, useEffect, useMemo, useState } from "react";
import { canSeeOwnerTools } from "./comboAccess";
import {
  CONNECT_COPY, VENUE_HELP, VENUE_LABEL, capsLine, emptyForm, money, pnlByUser, signedMoney, userTradingState, venueStatusText,
  KALSHI_HOWTO, autoFundLine, fundMoveText, effectiveCap, parseCapInput,
} from "./comboTesters";
import {
  adminBalanceText, balancesByUser, cellNote, cellText, comboShortfall, emptyBalances, etTime, filledByParlay, pendingMovesCell, totalCashCell, usd,
} from "./comboBalances";

const TESTERS_CSS = `
.cl .tst{margin:0 0 14px}
.cl .tst .tst-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cl .tst .tst-title{font-weight:700;font-size:14px}
.cl .tst p{margin:6px 0;color:#b6bac2;font-size:13px;line-height:1.45}
.cl .tst .tst-venue{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06)}
.cl .tst .tst-venue:first-of-type{border-top:0}
.cl .tst textarea{width:100%;min-height:96px;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:12px/1.4 ui-monospace,Menlo,monospace}
.cl .tst .tst-form{display:grid;gap:10px;margin-top:8px;width:100%;min-width:0}
.cl .tst .tst-form input,.cl .tst textarea{box-sizing:border-box;width:100%;max-width:100%}
.cl .tst .tst-actions{display:flex;gap:8px;flex-wrap:wrap}
.cl .tst .tst-howto{margin:10px 0;padding:10px 12px;border:1px solid rgba(147,197,253,.25);border-radius:10px;background:rgba(147,197,253,.05)}
.cl .tst .tst-howto summary{cursor:pointer;font-weight:700;font-size:13.5px;color:#dbeafe}
.cl .tst .tst-howto ol{margin:8px 0 6px;padding-left:22px;display:grid;gap:6px;font-size:13px;line-height:1.45;color:#d1d5db}
.cl .tst .tst-howto li::marker{color:#93c5fd;font-weight:700}
.cl .tst .tst-safe{font-size:12.5px;color:#34d399;margin-top:4px}
.cl .tst .tst-cap{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-top:8px;font-size:12.5px;color:#b6bac2}
.cl .tst .tst-cap .tst-cap-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cl .tst .tst-cap input{width:90px;padding:5px 7px;box-sizing:border-box}
.cl .tst .tst-cap .tst-cap-hint{font-size:11px;color:#8a8f98;line-height:1.35}
.cl .tst .tst-bal-combo{display:flex;flex-direction:column;gap:0;min-width:160px}
.cl .tst .tst-bal-cell.wide{min-width:140px}
.cl .tst .tst-fund{font-size:12.5px;line-height:1.45;margin-top:4px}
.cl .tst .tst-fund.ok{color:#34d399}
.cl .tst .tst-fund.warn{color:#fcd34d}
.cl .tst .tst-fund.muted{color:#8a8f98}
.cl .tst .tst-moves{margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02)}
.cl .tst .tst-moves-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-weight:600;font-size:13px}
.cl .tst .tst-moves ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px;font-size:12.5px}
.cl .tst .tst-moves li{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cl .tst .tst-moves li.failed{color:#fca5a5}
.cl .tst-table{width:100%;border-collapse:collapse;font-size:12.5px}
.cl .tst-table th{text-align:left;font-weight:600;color:#8a8f98;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap}
.cl .tst-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);vertical-align:top}
.cl .tst-scroll{overflow-x:auto}
.cl .tst .caps-edit{display:flex;gap:6px;align-items:center}
.cl .tst .caps-edit input{width:80px;padding:5px 7px}
.cl .tst .tst-bal{margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02)}
.cl .tst .tst-bal-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;font-weight:600;font-size:13px}
.cl .tst .tst-bal-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid rgba(255,255,255,0.05)}
.cl .tst .tst-bal-row:first-of-type{border-top:0}
.cl .tst .tst-bal-cells{display:flex;gap:8px;flex-wrap:wrap}
.cl .tst .tst-bal-cell{min-width:120px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.03)}
.cl .tst .tst-bal-cell.hi{background:rgba(16,185,129,0.08);box-shadow:inset 0 0 0 1px rgba(16,185,129,0.35)}
.cl .tst .tst-bal-cell .lbl{font-size:11px;color:#8a8f98}
.cl .tst .tst-bal-cell .amt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.cl .tst .tst-bal-cell .sub{font-size:11px;color:#8a8f98}
.cl .tst .tst-bal-cell.err .amt{font-size:13px;color:#fca5a5}
.cl .tst .tst-bal-cell.old .amt{color:#8a8f98}
.cl .tst .tst-bal-cell.old .sub{color:#fcd34d}
@media (max-width:600px){.cl .tst .tst-bal-cells{width:100%}.cl .tst .tst-bal-cell{flex:1 1 0}}
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

/** The tester's own auto-funding cap (combo_settings.autofund_cap_usd). ok=false hides the editor. */
function useOwnCap(supabase, userId, enabled) {
  const [state, setState] = useState({ ok: false, value: null, loaded: false });
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from("combo_settings").select("autofund_cap_usd").eq("user_id", userId).maybeSingle();
      if (alive) setState({ ok: !error, value: data && data.autofund_cap_usd != null ? Number(data.autofund_cap_usd) : null, loaded: true });
    })().catch(() => { if (alive) setState({ ok: false, value: null, loaded: true }); });
    return () => { alive = false; };
  }, [supabase, userId, enabled]);
  const save = useCallback(async (value) => {
    const { error } = await supabase.from("combo_settings").upsert({ user_id: userId, autofund_cap_usd: value }, { onConflict: "user_id" });
    if (!error) setState((s) => ({ ...s, value }));
    return !error;
  }, [supabase, userId]);
  return { ...state, save };
}

function CapEditor({ cap, daily }) {
  const [text, setText] = useState(cap.value == null ? "" : String(cap.value));
  const [msg, setMsg] = useState(null);
  useEffect(() => { setText(cap.value == null ? "" : String(cap.value)); }, [cap.value]);
  const onSave = async () => {
    const v = parseCapInput(text);
    if (Number.isNaN(v)) { setMsg("Enter a dollar amount, like 100."); return; }
    setMsg((await cap.save(v)) ? "Saved." : "Couldn't save. Try again.");
  };
  return (
    <div className="tst-cap">
      <div className="tst-cap-row">
        <label htmlFor="tst-cap-in">Amount to keep for combos</label>
        <input id="tst-cap-in" inputMode="decimal" aria-label="Amount to keep for combos" placeholder={daily != null ? money(daily) : "$"} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} />
        <button type="button" className="btn mini" onClick={onSave}>Save</button>
      </div>
      <div className="tst-cap-hint">{msg || "The site keeps your combos cash topped up to this amount."}{!msg && daily != null ? ` Blank = ${money(daily)} daily limit · $0 = off.` : ""}</div>
    </div>
  );
}

function VenueRow({ venue, row, caps, cap, busy, onConnect, onDisconnect }) {
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
        {venue === "kalshi" && row && row.connected && row.scopeStatus !== "unverified" && (() => {
          const line = autoFundLine(row, caps, cap && cap.ok ? cap.value : null);
          return line ? <div className={"tst-fund " + line.tone}>{line.text}</div> : null;
        })()}
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

const BAL_COLS = "user_id,venue,shard,available_usd,portfolio_usd,buying_power_usd,ok,error,fetched_at,checked_at";

/** Balance rows (RLS-scoped) re-read every 60s; userId=null reads all (owner). */
function useBalances(supabase, userId, enabled = true) {
  const [state, setState] = useState({ rows: null, failed: false, now: new Date() });
  const load = useCallback(async () => {
    let q = supabase.from("combo_balances").select(BAL_COLS);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q;
    setState((s) => ({ rows: error ? s.rows : (data || []), failed: !!error, now: new Date() }));
  }, [supabase, userId]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = () => { if (alive) load().catch(() => setState((s) => ({ ...s, failed: true, now: new Date() }))); };
    run();
    const t = setInterval(run, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, load]);
  return { ...state, reload: load };
}

/** This user's active locks + filled contracts, for the combo-balance warning. */
function useLockNeeds(supabase, userId, enabled = true) {
  const [needs, setNeeds] = useState({ parlays: [], filledById: {} });
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let alive = true;
    (async () => {
      const pq = await supabase.from("combo_parlays").select("id,label,max_contracts,fill_american,paused,archived_at,user_id").eq("user_id", userId).is("archived_at", null).limit(500);
      if (pq.error || !alive) return;
      const ids = (pq.data || []).map((p) => p.id);
      let filledById = {};
      if (ids.length) {
        const fq = await supabase.from("combo_fills").select("parlay_id,count").in("parlay_id", ids).eq("is_combo", true).eq("is_taker", false).limit(10000);
        if (!fq.error) filledById = filledByParlay(fq.data || []);
      }
      if (alive) setNeeds({ parlays: pq.data || [], filledById });
    })().catch(() => {});
    return () => { alive = false; };
  }, [supabase, userId, enabled]);
  return needs;
}

function BalanceCell({ label, cell, sub, hi, now }) {
  const bad = cell.state === "error" || cell.state === "stale";
  return (
    <div className={"tst-bal-cell" + (hi ? " hi" : "") + (bad && cell.amount == null ? " err" : "") + (bad && cell.amount != null ? " old" : "")}>
      <div className="lbl">{label}</div>
      <div className="amt">{cellText(cell)}</div>
      {(cellNote(cell, now) || sub) && <div className="sub">{cellNote(cell, now) || sub}</div>}
    </div>
  );
}

const MOVE_COLS = "id,user_id,amount_usd,status,error,from_shard,to_shard,created_at";

/** Auto-funding log (combo_fund_moves, RLS: own rows, owner sees all). Hidden if unreadable. */
function useFundMoves(supabase, userId, enabled = true, limit = 5) {
  const [state, setState] = useState({ rows: null, now: new Date() });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = async () => {
      let q = supabase.from("combo_fund_moves").select(MOVE_COLS);
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      if (alive) setState({ rows: error ? null : (data || []), now: new Date() });
    };
    run().catch(() => {});
    const t = setInterval(() => { run().catch(() => {}); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [supabase, userId, enabled, limit]);
  return state;
}

/** "Available to trade" per connected exchange. */
function BalanceBlock({ supabase, userId, kalshi, poly, kalshiRow = null, caps = null, cap = null }) {
  const { rows, failed, now } = useBalances(supabase, userId, !!(kalshi || poly));
  const needs = useLockNeeds(supabase, userId, !!kalshi);
  // Pending = unconfirmed auto-funding moves only. Cash reserved by resting
  // orders is not stored in combo_balances (Kalshi available_usd is free cash).
  const pendingQ = useFundMoves(supabase, userId, !!kalshi, 50);
  if (!kalshi && !poly) return null;
  const b = (rows && balancesByUser(rows, now)[userId]) || emptyBalances(now);
  const total = kalshi ? totalCashCell(b.kalshiMain, b.kalshiCombo) : null;
  const pending = kalshi
    ? (pendingQ.rows == null ? { state: "waiting", amount: null, at: null, checkedAt: null, error: null } : pendingMovesCell(pendingQ.rows))
    : null;
  const short = kalshi && b.kalshiCombo.state === "ok"
    ? comboShortfall({ comboUsd: b.kalshiCombo.amount, parlays: needs.parlays, filledById: needs.filledById })
    : { short: false };
  const autoOn = !!(kalshiRow && kalshiRow.connected && kalshiRow.autoFund);
  const showCap = !!(autoOn && cap && cap.ok && caps && caps.perDayUsd != null);
  const kalshiNote = !kalshi ? null
    : (kalshiRow && kalshiRow.connected && !kalshiRow.autoFund)
      ? "Move money to combos on Kalshi to trade."
      : "Combo Locks trades from your combos cash. The site moves money there for you, up to your cap.";
  return (
    <div className="tst-bal" aria-label="Available to trade">
      <div className="tst-bal-head">
        <span>Available to trade</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          {rows === null && !failed ? "Loading…" : failed && !rows ? "Couldn't load balances" : b.updatedAt ? `Updated ${etTime(b.updatedAt, now)}` : "Waiting for first check"}
        </span>
      </div>
      {kalshi && (
        <div className="tst-bal-row">
          <div style={{ fontWeight: 600 }}>Kalshi</div>
          <div className="tst-bal-cells">
            <BalanceCell label="Total cash available" cell={total} now={now} />
            <BalanceCell label="Pending transactions" cell={pending} now={now}
              sub={pending && pending.state === "ok" && pending.amount > 0 ? "Auto-funding in transit" : null} />
            <div className="tst-bal-combo">
              <BalanceCell label="Cash available for combos" cell={b.kalshiCombo} hi now={now} />
              {showCap && <CapEditor cap={cap} daily={effectiveCap(null, caps.perDayUsd)} />}
            </div>
          </div>
        </div>
      )}
      {poly && (
        <div className="tst-bal-row">
          <div style={{ fontWeight: 600 }}>Polymarket US</div>
          <div className="tst-bal-cells">
            <BalanceCell label="Buying power" cell={b.poly} hi now={now} />
          </div>
        </div>
      )}
      {short.short && (
        <div className="note warn" style={{ marginTop: 8 }}>
          Your Kalshi combo balance ({usd(b.kalshiCombo.amount)}) is below the {usd(short.need)} that “{short.parlay.label || "a lock"}” could need if it fills in full. Kalshi may reject those quotes until the combo balance covers it.
        </div>
      )}
      {kalshiNote && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{kalshiNote}</div>}
    </div>
  );
}

function OwnerBalances({ supabase, user }) {
  return (
    <div className="card tst">
      <div className="tst-head">
        <div className="tst-title">Your exchange accounts</div>
        <span className="chip">Server keys</span>
      </div>
      <BalanceBlock supabase={supabase} userId={user.id} kalshi poly />
    </div>
  );
}

/** Numbered "How to connect your Kalshi key" guide; open until Kalshi is connected. */
function KalshiHowTo({ connected }) {
  return (
    <details className="tst-howto" key={connected ? "c" : "n"} open={!connected}>
      <summary>{KALSHI_HOWTO.title}</summary>
      <ol>
        {KALSHI_HOWTO.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="tst-safe">{KALSHI_HOWTO.safe}</div>
    </details>
  );
}


function FundMoves({ supabase, userId, enabled, title = "Auto-funding moves", limit = 5, nameFor = null }) {
  const { rows, now } = useFundMoves(supabase, userId, enabled, limit);
  if (!enabled || !Array.isArray(rows)) return null;
  return (
    <div className="tst-moves" aria-label={title}>
      <div className="tst-moves-head"><span>{title}</span><span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>Kalshi Default ↔ Combos</span></div>
      {rows.length === 0
        ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>No moves yet. When your Combos balance runs low, the next move shows up here.</div>
        : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className={r.status === "failed" ? "failed" : ""}>
                <span>{nameFor ? <span className="muted">{nameFor(r.user_id)} · </span> : null}{fundMoveText(r)}</span>
                <span className="muted">{etTime(r.created_at, now)}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function ConnectPanel({ supabase, userId, status, setStatus }) {
  const [busy, setBusy] = useState(false);
  const kalshiRow = status.venues && status.venues.kalshi;
  const cap = useOwnCap(supabase, userId, !!(kalshiRow && kalshiRow.connected && kalshiRow.autoFund));
  const [msg, setMsg] = useState(null);
  const connect = async (payload) => {
    setBusy(true); setMsg(null);
    try {
      const r = await authedFetch(supabase, "/api/combo-keys", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) { setMsg({ tone: "warn", text: r.body.error || "Could not save the key." }); return false; }
      setStatus(r.body);
      // The auto-funding note already shows under the Kalshi row.
      const warn = (r.body.warnings || []).filter((w) => !/^Auto-funding is off/.test(w)).join(" ");
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
      <KalshiHowTo connected={!!(status.venues && status.venues.kalshi && status.venues.kalshi.connected)} />
      <p style={{ color: "#fcd34d" }}>{CONNECT_COPY.never}</p>
      {msg && <div className={"note " + msg.tone} style={{ margin: "8px 0" }}>{msg.text}</div>}
      {["kalshi", "polymarket_us"].map((v) => (
        <VenueRow key={v} venue={v} row={status.venues && status.venues[v]} caps={status.caps} cap={v === "kalshi" ? cap : null} busy={busy} onConnect={connect} onDisconnect={disconnect} />
      ))}
      <BalanceBlock supabase={supabase} userId={userId}
        kalshi={!!(status.venues && status.venues.kalshi && status.venues.kalshi.connected)}
        poly={!!(status.venues && status.venues.polymarket_us && status.venues.polymarket_us.connected)}
        kalshiRow={status.venues && status.venues.kalshi}
        caps={status.caps}
        cap={cap} />
      <FundMoves supabase={supabase} userId={userId}
        enabled={!!(status.venues && status.venues.kalshi && status.venues.kalshi.connected && status.venues.kalshi.autoFund)} />
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
  const bal = useBalances(supabase, null, open);
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
          {open && <button type="button" className="btn mini" disabled={busy} onClick={() => { load(); bal.reload(); }}>Refresh</button>}
          <button type="button" className="btn mini" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </div>
      </div>
      {open && err && <div className="note warn" style={{ marginTop: 8 }}>{err}</div>}
      {open && !users && !err && <div className="muted" style={{ marginTop: 8 }}>Loading…</div>}
      {open && users && (
        <div className="tst-scroll" style={{ marginTop: 8 }}>
          <table className="tst-table num">
            <thead><tr><th>User</th><th>Status</th><th>Limits</th><th>Kalshi</th><th>Polymarket US</th><th>Balance</th><th>Locks</th><th>Orders 30d</th><th>Fills</th><th>Realized P/L</th><th /></tr></thead>
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
                    <td data-k="Kalshi">{ownerDesk ? "Server keys" : u.keys.kalshi.connected ? <>{`••••${u.keys.kalshi.hint}${u.keys.kalshi.scopeStatus === "unverified" ? " (review)" : ""}`}<div className="muted" style={{ fontSize: 11 }}>{u.keys.kalshi.autoFund ? "auto-fund on" : "no transfers"}</div></> : "—"}</td>
                    <td data-k="Polymarket US">{ownerDesk ? "Server keys" : u.keys.polymarket_us.connected ? `••••${u.keys.polymarket_us.hint}` : "—"}</td>
                    <td data-k="Balance">{(() => {
                      const k = ownerDesk || u.keys.kalshi.connected;
                      const pm = ownerDesk || u.keys.polymarket_us.connected;
                      if (!k && !pm) return "—";
                      if (!bal.rows) return bal.failed ? "Couldn't load" : "…";
                      const b = balancesByUser(bal.rows, bal.now)[u.user_id];
                      if (!b) return <span className="muted">Waiting</span>;
                      return <span title={b.updatedAt ? `Updated ${etTime(b.updatedAt, bal.now)}. * = couldn't refresh, last amount shown.` : ""}>{adminBalanceText(b, { kalshi: k, poly: pm })}{b.updatedAt ? <div className="muted" style={{ fontSize: 11 }}>{etTime(b.updatedAt, bal.now)}</div> : null}</span>;
                    })()}</td>
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
          <FundMoves supabase={supabase} userId={null} enabled title="Tester auto-funding (latest 20)" limit={20}
            nameFor={(id) => { const u = rows.find((x) => x.user_id === id); return u ? (u.email || id.slice(0, 8)) : String(id).slice(0, 8); }} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Keys are shown masked only. Balance = Kalshi combo / single-game and Polymarket US buying power, refreshed every minute. Testers trade on their own accounts. Kevin's desk uses the server keys. Pause engages the user's kill switch; Resume clears only your pause, and the user re-arms their own kill switch.</div>
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
      {isOwner && <OwnerBalances supabase={supabase} user={user} />}
      {isOwner && <AdminPanel supabase={supabase} />}
      {!isOwner && status && status.approved && <ConnectPanel supabase={supabase} userId={user.id} status={status} setStatus={setStatus} />}
    </>
  );
}
