// love23 loss-rebate optimizer. Owner only (canSeeOwnerTools, same gate as the
// Live Trading Desk); the API checks again. RECOMMENDATIONS ONLY: nothing on
// this page places a love23 bet. Hedges are prediction markets only.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import {
  LOVE23_REFRESH_MS, FLAG_TEXT, DEFAULT_SETTINGS, fmtAmerican, fmtMoney, fmtPct,
  selectionLabel, hedgeLabel, gameLabel, picksQuery, triggerProgress,
} from "./love23View";

let sb = null;
function supabase() {
  if (sb) return sb;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  sb = createClient(url, key);
  return sb;
}

async function authHeaders() {
  const c = supabase();
  if (!c) return null;
  const { data: { session } } = await c.auth.getSession();
  const token = session && session.access_token;
  return token ? { accept: "application/json", "content-type": "application/json", authorization: "Bearer " + token } : null;
}

async function api(path, opts = {}) {
  const headers = await authHeaders();
  if (!headers) throw new Error("Sign in required");
  const r = await fetch(path, { ...opts, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${r.status}`);
  return body;
}

const card = { background: "#12131a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, marginBottom: 16 };
const lbl = { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 };
const inp = { width: "100%", boxSizing: "border-box", background: "#0b0b0c", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#f8fafc", padding: "7px 9px", fontSize: 13 };
const th = { textAlign: "left", padding: "6px 8px", fontSize: 11, color: "#9ca3af", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" };
const td = { padding: "6px 8px", fontSize: 12, color: "#e5e7eb", borderBottom: "1px solid rgba(255,255,255,0.04)", whiteSpace: "nowrap", fontFamily: "'JetBrains Mono', monospace" };
const btn = { background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.4)", borderRadius: 8, color: "#e6c65c", padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const pos = (v) => ({ color: Number(v) > 0 ? "#4ade80" : Number(v) < 0 ? "#f87171" : "#e5e7eb" });

const SETTINGS_KEY = "love23Rebate:settings:v1";
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch (_) { return { ...DEFAULT_SETTINGS }; }
}

function Stat({ title, value, sub, color }) {
  return (
    <div style={{ minWidth: 150 }}>
      <span style={lbl}>{title}</span>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#f8fafc", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AccountPanel({ account, error, onReload }) {
  if (error) return <div style={card}><b>Account</b><div style={{ color: "#fca5a5", marginTop: 8 }}>{error}</div></div>;
  if (!account) return <div style={card}>Loading love23 account…</div>;
  const l = account.ledger || {};
  const prog = triggerProgress(l);
  const b = account.balance || {};
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <b>Promo tracker</b>
        <button type="button" style={btn} onClick={onReload}>Refresh</button>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat title="love23 net (promo)" value={fmtMoney(l.love23Net, { sign: true })} color={pos(l.love23Net).color} sub={account.promoStart ? `since ${account.promoStart}` : "all tracked days"} />
        <Stat title="Since last settlement" value={fmtMoney(l.N, { sign: true })} color={pos(l.N).color} sub={`${fmtMoney(l.distanceToTrigger)} more losses to trigger`} />
        <Stat title="Rolled-forward profit" value={fmtMoney(l.rolledForwardProfit)} />
        <Stat title="Rebates earned / paid" value={`${fmtMoney(l.rebatesEarned)} / ${fmtMoney(l.rebatesPaid)}`} sub={`${l.settlements || 0} settlement(s); if closed now (partial, unconfirmed): ${fmtMoney(l.partialIfClosedNow)}`} />
        <Stat title="Hedge P&L (settled)" value={fmtMoney(l.hedgePnl, { sign: true })} color={pos(l.hedgePnl).color} sub={`${fmtMoney(l.hedgeOpenStake)} open`} />
        <Stat title="Combined" value={fmtMoney(l.combinedNet, { sign: true })} color={pos(l.combinedNet).color} sub="love23 + hedges + rebates earned" />
      </div>
      <div style={{ height: 10, background: "#1f2937", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${Math.round(prog.pct * 100)}%`, height: "100%", background: "#d4af37" }} />
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>{prog.text}</div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 10 }}>
        Balance: credit {fmtMoney(b.credit)} · available {fmtMoney(b.available)} · at risk {fmtMoney(b.atRisk)} · free play {fmtMoney(b.freePlay)} · this week {fmtMoney(b.thisWeek, { sign: true })}
        {account.limits && account.limits.maxWager != null && <> · max bet {fmtMoney(account.limits.maxWager)}</>}
      </div>
      {account.errors && (account.errors.ledger || account.errors.persist) && (
        <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8 }}>{account.errors.ledger || account.errors.persist}</div>
      )}
    </div>
  );
}

function Settings({ s, setS }) {
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      <label><span style={lbl}>Max bet ($)</span><input style={inp} type="number" max={500} value={s.maxBet} onChange={set("maxBet")} /></label>
      <label title="Bets the client will still place before the promo ends. 0 = value each bet as if it were the last."><span style={lbl}>Bets left in promo</span><input style={inp} type="number" value={s.horizon} onChange={set("horizon")} /></label>
      <label title="Expected love23 result per future bet, as a fraction of stake (vig drag)."><span style={lbl}>Future drift / bet</span><input style={inp} type="number" step="0.005" value={s.drift} onChange={set("drift")} /></label>
      <label title="Future per-bet standard deviation as a multiple of max bet (~1 at even odds)."><span style={lbl}>Future SD × max bet</span><input style={inp} type="number" step="0.1" value={s.sd} onChange={set("sd")} /></label>
      <label title="Pinnacle vs prediction-market fair must agree within this (probability)."><span style={lbl}>Confirm within</span><input style={inp} type="number" step="0.005" value={s.confirm} onChange={set("confirm")} /></label>
      <label title="Override the running love23 net since the last settlement (blank = ledger)."><span style={lbl}>Net since settlement</span><input style={inp} type="number" placeholder="ledger" value={s.n} onChange={set("n")} /></label>
      <label style={{ display: "flex", alignItems: "end", gap: 8, fontSize: 12, color: "#d1d5db" }}><input type="checkbox" checked={!!s.flagged} onChange={set("flagged")} />Show held-back picks</label>
    </div>
  );
}

function PicksTable({ data, onLogHedge }) {
  if (!data) return <div style={card}>Loading picks…</div>;
  const picks = data.picks || [];
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <b>Best picks (EV incl. rebate) · {picks.length} shown of {data.totals ? data.totals.ranked : 0}</b>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          love23 {new Date(data.meta.love23FetchedAt).toLocaleTimeString()}{data.meta.love23Stale ? " (stale, backing off)" : ""} · net since settlement {fmtMoney(data.state.N, { sign: true })} ({data.state.source})
        </span>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
        Recommendations only. Bet on love23 by hand; hedge on Kalshi, Polymarket, Novig or ProphetX at the price shown (fees in). Locked P&L is the same whichever side wins; Total = locked + rebate value.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>
            {["Game", "Bet on love23", "love23", "Fair", "love23 EV", "Hedge (best PM)", "Hedge $", "Ratio", "Depth", "Locked", "Rebate", "Total", "No-hedge", "Flags", ""].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {picks.map((p) => (
              <tr key={p.key}>
                <td style={{ ...td, fontFamily: "inherit" }}>{gameLabel(p.game)}<div style={{ fontSize: 10, color: "#6b7280" }}>{new Date(p.kickoff).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} ET</div></td>
                <td style={{ ...td, fontFamily: "inherit" }}>{selectionLabel(p)}<div style={{ fontSize: 10, color: "#6b7280" }}>{fmtMoney(p.stake)} · leg {p.love23LegId}</div></td>
                <td style={td}>{fmtAmerican(p.love23American)}</td>
                <td style={td} title={`Pinnacle ${fmtAmerican(p.pinnacleFairAmerican)} · PM ${fmtAmerican(p.pmFairAmerican)} (${p.fairSource})`}>{fmtAmerican(p.fairAmerican)}</td>
                <td style={{ ...td, ...pos(p.love23Ev) }}>{fmtMoney(p.love23Ev, { sign: true })}<div style={{ fontSize: 10, color: "#6b7280" }}>{fmtPct(p.love23EvPct)}</div></td>
                <td style={{ ...td, fontFamily: "inherit" }}>{hedgeLabel(p.hedge)}</td>
                <td style={td}>{p.hedge ? fmtMoney(p.hedge.hedgeStake) : "—"}</td>
                <td style={td}>{p.hedge ? p.hedge.stakeRatio.toFixed(2) + "×" : "—"}</td>
                <td style={{ ...td, color: p.hedge && p.hedge.depthOk === false ? "#f87171" : "#e5e7eb" }} title="Depth = potential profit at the top price; Need = profit the lock needs">{p.hedge && p.hedge.depthProfit != null ? fmtMoney(p.hedge.depthProfit) : "?"}<div style={{ fontSize: 10, color: "#6b7280" }}>need {p.hedge ? fmtMoney(p.hedge.neededProfit) : "—"}</div></td>
                <td style={{ ...td, ...pos(p.hedge && p.hedge.lockedPnl) }}>{p.hedge ? fmtMoney(p.hedge.lockedPnl, { sign: true }) : "—"}</td>
                <td style={{ ...td, ...pos(p.rebateValue) }}>{fmtMoney(p.rebateValue, { sign: true })}</td>
                <td style={{ ...td, fontWeight: 700, ...pos(p.totalHedged) }}>{fmtMoney(p.totalHedged, { sign: true })}</td>
                <td style={{ ...td, ...pos(p.totalUnhedged) }}>{fmtMoney(p.totalUnhedged, { sign: true })}</td>
                <td style={{ ...td, fontFamily: "inherit", fontSize: 10, color: "#fbbf24" }} title={(p.flags || []).map((f) => FLAG_TEXT[f] || f).join("\n")}>{(p.flags || []).join(", ")}</td>
                <td style={td}><button type="button" style={{ ...btn, padding: "3px 8px" }} onClick={() => onLogHedge(p)}>Log hedge</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.totals && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
          {data.totals.love23Lines} love23 lines · {data.totals.evaluated} priced · flags: {Object.entries(data.totals.flags || {}).map(([k, v]) => `${k} ${v}`).join(", ")}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{data.meta.note}</div>
    </div>
  );
}

function HedgeForm({ draft, onSaved }) {
  const [f, setF] = useState(draft || {});
  const [msg, setMsg] = useState("");
  useEffect(() => { setF(draft || {}); }, [draft]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/love23-rebate", { method: "POST", body: JSON.stringify({ op: "hedge-add", ...f, american: Number(f.american), stake: Number(f.stake) }) });
      setMsg("Saved.");
      onSaved();
    } catch (err) { setMsg(err.message); }
  };
  return (
    <form onSubmit={submit} style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, alignItems: "end" }}>
      <b style={{ gridColumn: "1 / -1" }}>Log a hedge you placed</b>
      <label><span style={lbl}>Game</span><input style={inp} value={f.game || ""} onChange={set("game")} /></label>
      <label><span style={lbl}>Market / side</span><input style={inp} value={f.side || ""} onChange={set("side")} /></label>
      <label><span style={lbl}>Venue</span>
        <select style={inp} value={f.venue || "kalshi"} onChange={set("venue")}>
          <option value="kalshi">Kalshi</option><option value="polymarket">Polymarket</option><option value="novig">Novig</option><option value="prophetx">ProphetX</option>
        </select>
      </label>
      <label><span style={lbl}>Price (American)</span><input style={inp} value={f.american ?? ""} onChange={set("american")} placeholder="-120" /></label>
      <label><span style={lbl}>Stake ($)</span><input style={inp} type="number" value={f.stake ?? ""} onChange={set("stake")} /></label>
      <label><span style={lbl}>love23 ticket</span><input style={inp} value={f.love23Ticket || ""} onChange={set("love23Ticket")} /></label>
      <button type="submit" style={btn}>Save hedge</button>
      {msg && <span style={{ fontSize: 12, color: "#9ca3af" }}>{msg}</span>}
    </form>
  );
}

function LedgerEntries({ entries, onChanged }) {
  const act = async (body) => { try { await api("/api/love23-rebate", { method: "POST", body: JSON.stringify(body) }); onChanged(); } catch (e) { alert(e.message); } };
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  return (
    <div style={card}>
      <b>Ledger</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        <input style={{ ...inp, width: 120 }} placeholder="amount" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <input style={{ ...inp, width: 220 }} placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" style={btn} onClick={() => act({ op: "rebate-paid", pnl: Number(amt), note })}>Record rebate received</button>
        <button type="button" style={btn} onClick={() => act({ op: "adjust", pnl: Number(amt), note })} title="Opening love23 net before tracking, or a correction">Adjust love23 net</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["When", "Kind", "Game / side", "Venue", "Price", "Stake", "Result", "P&L", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {(entries || []).map((e) => (
              <tr key={e.id}>
                <td style={td}>{new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td style={td}>{e.kind}</td>
                <td style={{ ...td, fontFamily: "inherit" }}>{[e.game, e.side, e.note].filter(Boolean).join(" · ")}</td>
                <td style={td}>{e.venue || ""}</td>
                <td style={td}>{e.american ? fmtAmerican(e.american) : ""}</td>
                <td style={td}>{e.stake ? fmtMoney(e.stake) : ""}</td>
                <td style={td}>{e.result || ""}</td>
                <td style={{ ...td, ...pos(e.pnl) }}>{fmtMoney(e.pnl, { sign: true })}</td>
                <td style={td}>
                  {e.kind === "hedge" && e.result === "open" && ["won", "lost", "push"].map((r) => (
                    <button key={r} type="button" style={{ ...btn, padding: "2px 6px", marginRight: 4 }} onClick={() => act({ op: "hedge-settle", id: e.id, result: r })}>{r}</button>
                  ))}
                  <button type="button" style={{ ...btn, padding: "2px 6px" }} onClick={() => { if (confirm("Delete this entry?")) act({ op: "hedge-delete", id: e.id }); }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WagerLists({ account }) {
  if (!account) return null;
  const open = account.openBets || [];
  const days = (account.settled || []).filter((d) => (d.orders || []).length || d.winLossAmount);
  return (
    <div style={card}>
      <b>love23 wagers (read from the API)</b>
      <div style={{ fontSize: 12, color: "#9ca3af", margin: "8px 0" }}>Open: {open.length}{open.length ? "" : " (none)"}</div>
      {open.length > 0 && <pre style={{ fontSize: 11, color: "#d1d5db", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{JSON.stringify(open, null, 1)}</pre>}
      <div style={{ fontSize: 12, color: "#9ca3af", margin: "8px 0" }}>Settled this week:</div>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {(account.settled || []).map((d) => (
            <tr key={d.date}><td style={td}>{d.date}</td><td style={{ ...td, ...pos(d.winLossAmount) }}>{fmtMoney(d.winLossAmount, { sign: true })}</td><td style={td}>{(d.orders || []).length} bets</td></tr>
          ))}
        </tbody>
      </table>
      {!days.length && <div style={{ fontSize: 11, color: "#6b7280" }}>No settled bets yet this week.</div>}
    </div>
  );
}

export default function Love23Rebate({ user }) {
  const [settings, setSettings] = useState(loadSettings);
  const [picks, setPicks] = useState(null);
  const [picksErr, setPicksErr] = useState("");
  const [account, setAccount] = useState(null);
  const [accountErr, setAccountErr] = useState("");
  const [draft, setDraft] = useState(null);
  const query = useMemo(() => picksQuery(settings), [settings]);

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ } }, [settings]);

  const loadPicks = useCallback(async () => {
    try { setPicks(await api("/api/love23-rebate?" + query)); setPicksErr(""); } catch (e) { setPicksErr(e.message); }
  }, [query]);
  const loadAccount = useCallback(async () => {
    try { setAccount(await api("/api/love23-rebate?view=account")); setAccountErr(""); } catch (e) { setAccountErr(e.message); }
  }, []);

  useEffect(() => {
    if (!canSeeOwnerTools(user)) return undefined;
    loadPicks();
    const t = setInterval(loadPicks, LOVE23_REFRESH_MS);
    return () => clearInterval(t);
  }, [user, loadPicks]);
  useEffect(() => { if (canSeeOwnerTools(user)) loadAccount(); }, [user, loadAccount]);

  if (!canSeeOwnerTools(user)) return null;
  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>love23 loss rebate</h2>
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
        50% of net losses back at each −$10,000 (=$5,000), profits roll forward, $500 max bet, no commission on football. Fair: Pinnacle no-vig, confirmed by prediction markets. Preview: recommendations only.
      </div>
      <AccountPanel account={account} error={accountErr} onReload={loadAccount} />
      <Settings s={settings} setS={setSettings} />
      {picksErr ? <div style={{ ...card, color: "#fca5a5" }}>{picksErr}</div> : (
        <PicksTable data={picks} onLogHedge={(p) => setDraft({
          game: gameLabel(p.game), side: `${selectionLabel(p)} (love23 ${fmtAmerican(p.love23American)})`,
          venue: p.hedge ? p.hedge.venue : "kalshi", american: p.hedge ? p.hedge.american : "", stake: p.hedge ? p.hedge.hedgeStake.toFixed(2) : "",
        })} />
      )}
      <HedgeForm draft={draft} onSaved={loadAccount} />
      <LedgerEntries entries={account && account.entries} onChanged={loadAccount} />
      <WagerLists account={account} />
    </div>
  );
}
