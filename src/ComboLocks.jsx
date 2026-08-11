// Combo Locks — private tab for the Kalshi combo RFQ auto-quoter.
// Gated to OWNER_EMAIL in App.jsx; this component also refuses to render for anyone else.
// Backed by Supabase (combo_parlays / combo_settings / combo_submissions) so the
// always-on worker reads the same active parlays. NO live prices — the lock uses
// only the user's own numbers.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
export const OWNER_EMAIL = "kev120909@gmail.com";

/* ── engine (mirrors worker engine.js exactly) ── */
// The fill odds you enter are the odds you SELL at AFTER your maker fee — already baked in.
// The lock math uses them directly (no separate fee term). Fees below only recover the nominal
// exchange price and the taker's matched odds (they pay a 7% taker fee, 4× your 1.75% maker fee).
const KFEE = 0.0175;
const TAKER_FEE = 0.07;
const aToDec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
const americanFromProb = (p) => (!(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p)));
const r2 = (x) => Math.round(x * 100) / 100;
function nominalProbFromEff(sEff) {
  const b = 1 - KFEE; // solve KFEE*sNom^2 + (1-KFEE)*sNom - sEff = 0
  return (-b + Math.sqrt(b * b + 4 * KFEE * sEff)) / (2 * KFEE);
}
// Your fill is net of your maker fee. effTaker = the odds the taker is matched at (nominal + their fee).
function fillView(fillAfterFeeAmerican) {
  const sEff = impliedProb(fillAfterFeeAmerican);
  const sNom = nominalProbFromEff(sEff);
  const takerProb = sNom + TAKER_FEE * sNom * (1 - sNom);
  return { sEff, sNom, effTaker: americanFromProb(takerProb), noBid: r2(1 - sNom).toFixed(2) };
}
// Auto contracts cap for a hedge mode. Fill odds already include your maker fee, so no fee term.
function hedgeCap({ stake, boostAmerican, fillAmerican, mode = "1x" }) {
  if (!(stake > 0) || !boostAmerican || !fillAmerican) return 0;
  const winReturn = stake * aToDec(boostAmerican);
  const s = impliedProb(fillAmerican);
  const riskfree = s > 0 ? Math.ceil(stake / s) : 0;
  switch (String(mode)) {
    case "riskfree": return riskfree;
    case "2x": return Math.round(2 * winReturn);
    case "3x": return Math.round(3 * winReturn);
    case "1x":
    default: return Math.round(winReturn);
  }
}
function decideAtFill({ parlayStake, parlayAmerican, fillAmerican, fairAmerican = null, rfqContracts, hedgeMode = "1x" }) {
  if (!(parlayStake > 0) || !parlayAmerican || !fillAmerican || !(rfqContracts > 0)) return { ok: false, reason: "bad_inputs" };
  const dec = aToDec(parlayAmerican), winReturn = parlayStake * dec, bookHit = winReturn - parlayStake, bookMiss = -parlayStake;
  const cap = hedgeCap({ stake: parlayStake, boostAmerican: parlayAmerican, fillAmerican, mode: hedgeMode });
  const N = Math.min(rfqContracts, cap); // partial fill up to the cap — bigger RFQs fill to the cap
  if (!(N > 0)) return { ok: false, reason: "zero_cap", cap };
  const s = impliedProb(fillAmerican); // already net of your maker fee
  const hit = bookHit + N * s - N, miss = bookMiss + N * s, worst = Math.min(hit, miss);
  const v = fillView(fillAmerican);
  return { ok: true, locks: worst >= 0, hit: r2(hit), miss: r2(miss), worst: r2(worst),
    partial: rfqContracts > cap, cap, hedgeMode,
    competitive: fairAmerican == null ? null : fillAmerican >= fairAmerican, fillAmerican,
    effTakerOdds: v.effTaker,
    quote: { yes_bid: "0.00", no_bid: v.noBid, rest_remainder: false }, contracts: N };
}
const MODE_LABEL = { riskfree: "Risk-free", "1x": "1× pure hedge", "2x": "2× (directional)", "3x": "3× (directional)" };

/* ── sample games fallback (same shape the /api/kalshi-games feed returns) ── */
const gSide = (tk, label) => ({ ticker: tk, side: "yes", label });
const gTot = (tk, line) => [{ ticker: tk, side: "yes", label: `Over ${line}` }, { ticker: tk, side: "no", label: `Under ${line}` }];
const gSpr = (tk, fav, dog, line) => [{ ticker: tk, side: "yes", label: `${fav} −${line}` }, { ticker: tk, side: "no", label: `${dog} +${line}` }];
const sampleGame = (key, ka, kb, A, B) => ({ key, title: `${A} vs ${B}`, date: `${ka} vs ${kb}`, markets: {
  side: [gSide(`KXMLBGAME-${key}-${ka}`, A), gSide(`KXMLBGAME-${key}-${kb}`, B)],
  spread: [...gSpr(`KXMLBSPREAD-${key}-${ka}2`, A, B, "1.5"), ...gSpr(`KXMLBSPREAD-${key}-${ka}3`, A, B, "2.5"), ...gSpr(`KXMLBSPREAD-${key}-${kb}2`, B, A, "1.5")],
  total: [...gTot(`KXMLBTOTAL-${key}-7`, "6.5"), ...gTot(`KXMLBTOTAL-${key}-8`, "7.5"), ...gTot(`KXMLBTOTAL-${key}-9`, "8.5"), ...gTot(`KXMLBTOTAL-${key}-10`, "9.5")] } });
const SAMPLE = { comboCollection: "KXMVESPORTSMULTIGAMEEXTENDED-R", sample: true, sports: { mlb: [
  sampleGame("26AUG071905PHIATL", "PHI", "ATL", "Philadelphia", "Atlanta"),
  sampleGame("26AUG071905NYMWSH", "NYM", "WSH", "New York M", "Washington"),
  sampleGame("26AUG071905NYYBOS", "NYY", "BOS", "New York Y", "Boston") ] } };
const TYPE_LABEL = { side: "Side (moneyline)", spread: "Spread (alt run lines)", total: "Total (alt over/unders)" };
const encVal = (t, s) => `${t}|${s}`;
const decValFn = (v) => { const i = v.lastIndexOf("|"); return i < 0 ? [v, "yes"] : [v.slice(0, i), v.slice(i + 1)]; };
const fmtAm = (a) => (a == null ? "—" : a > 0 ? "+" + a : "" + a);
const money = (v) => (v < 0 ? "-$" : "+$") + Math.abs(Number(v)).toFixed(2);
// A parlay auto-moves to History this many hours after its game start — an approximation of
// "games over," since we only know start times, not end times or Kalshi settlement.
const HISTORY_BUFFER_HOURS = 6;
const historyMoveAt = (startsAtIso) => (startsAtIso ? new Date(new Date(startsAtIso).getTime() + HISTORY_BUFFER_HOURS * 3600 * 1000) : null);

export default function ComboLocks({ user }) {
  const [games, setGames] = useState(SAMPLE);
  const [srcLive, setSrcLive] = useState(false);
  const [parlays, setParlays] = useState([]);
  const [kill, setKill] = useState(true); // safe default until settings load
  const [history, setHistory] = useState([]);
  const [archived, setArchived] = useState([]);
  const [realFills, setRealFills] = useState({}); // parlay_id -> real contracts filled (from Kalshi account)
  const [quoted, setQuoted] = useState({});       // parlay_id -> contracts the worker quoted (from combo_submissions)
  const [realUnattr, setRealUnattr] = useState(0);// real combo fills we couldn't tie to a specific parlay
  const [matchCounts, setMatchCounts] = useState({}); // parlay_id -> { n, locks_n, dollar_n, last_match }
  const [outcomes, setOutcomes] = useState([]);   // recent quote_outcomes rows (accepted/executed/lost)
  const [legRows, setLegRows] = useState([{ id: 1, gameKey: "", marketVal: "" }, { id: 2, gameKey: "", marketVal: "" }]);
  const [form, setForm] = useState({ stake: 100, boost: 2000, fill: 1200, fair: 1000, mode: "1x", starts: "", label: "", labelEdited: false });
  const [sim, setSim] = useState({ parlayId: "", size: 2000, result: null });

  const gameIdx = useMemo(() => { const m = {}; (games.sports.mlb || []).forEach((g) => (m[g.key] = g)); return m; }, [games]);
  const owner = user && user.email === OWNER_EMAIL;

  const loadGames = useCallback(async () => {
    try { const r = await fetch("/api/kalshi-games", { headers: { accept: "application/json" } });
      if (!r.ok) throw 0; const d = await r.json();
      if (d && d.sports && (d.sports.mlb || []).length) { setGames(d); setSrcLive(true); return; }
    } catch (_) {}
    setGames(SAMPLE); setSrcLive(false);
  }, []);
  const reload = useCallback(async () => {
    if (!owner) return;
    const [{ data: p }, { data: s }, { data: h }, { data: ar }, { data: fills }, { data: booked }, { data: mc }, { data: oc }] = await Promise.all([
      // All LIVING parlays (not yet archived), whether the worker is actively watching them
      // (active=true) or paused after recording a quote (active=false). Loading both means a
      // parlay can never fall through the gap between the Active and History lists again.
      supabase.from("combo_parlays").select("*").is("archived_at", null).order("created_at", { ascending: false }),
      supabase.from("combo_settings").select("kill_switch").eq("user_id", user.id).maybeSingle(),
      supabase.from("combo_submissions").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("combo_parlays").select("*").not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100),
      // REAL fills, straight from the account (via the read-only fills reader), maker + combo only.
      supabase.from("combo_fills").select("parlay_id,count,is_combo,is_taker").eq("is_combo", true).eq("is_taker", false),
      // QUOTED contracts the worker recorded on post — for the quoted-vs-filled comparison.
      supabase.from("combo_submissions").select("parlay_id,contracts,status,is_live").or("status.eq.filled,is_live.eq.true"),
      // How many RFQs matched each parlay (from the read-only watcher).
      supabase.from("combo_match_counts").select("*"),
      // What happened to each quote we posted (accepted / executed / lost + latency + fill reconcile).
      supabase.from("quote_outcomes").select("*").order("updated_at", { ascending: false }).limit(50),
    ]);
    setParlays(p || []); if (s) setKill(!!s.kill_switch); setHistory(h || []); setArchived(ar || []);
    const mcMap = {}; (mc || []).forEach((r) => { mcMap[r.parlay_id] = r; }); setMatchCounts(mcMap);
    setOutcomes(oc || []);
    const rf = {}; let un = 0;
    (fills || []).forEach((f) => { const c = Number(f.count || 0); if (f.parlay_id) rf[f.parlay_id] = (rf[f.parlay_id] || 0) + c; else un += c; });
    setRealFills(rf); setRealUnattr(un);
    const q = {}; (booked || []).forEach((b) => { q[b.parlay_id] = (q[b.parlay_id] || 0) + Number(b.contracts || 0); });
    setQuoted(q);
  }, [owner, user]);
  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => { reload(); }, [reload]);
  // Live-ish monitor: refresh the parlay/fills data every 20s so the real-fills bars update on their own.
  useEffect(() => { const t = setInterval(() => { reload(); }, 20000); return () => clearInterval(t); }, [reload]);

  const findMarket = (g, ticker, side) => { for (const t of ["side", "spread", "total"]) { const m = (g.markets[t] || []).find((x) => x.ticker === ticker && x.side === side); if (m) return { ...m, type: t }; } return null; };
  const readLegs = useCallback(() => legRows.map((r) => {
    if (!r.gameKey || !r.marketVal) return null;
    const [tk, side] = decValFn(r.marketVal); const g = gameIdx[r.gameKey]; const m = g && findMarket(g, tk, side);
    if (!m) return null; return { ticker: tk, side, label: m.label, type: m.type, game: g.title, gameKey: r.gameKey };
  }).filter(Boolean), [legRows, gameIdx]);

  // keep label synced from legs unless the user has edited it
  useEffect(() => { setForm((f) => (f.labelEdited ? f : { ...f, label: readLegs().map((l) => l.label).join(" + ") })); }, [legRows, readLegs]);

  // live preview: auto contracts cap for the chosen mode + the outcome if filled to that cap
  const preview = useMemo(() => {
    const stake = +form.stake, boost = +form.boost, fill = +form.fill;
    if (!(stake > 0) || !boost || !fill) return null;
    const cap = hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: form.mode });
    if (!(cap > 0)) return null;
    const d = decideAtFill({ parlayStake: stake, parlayAmerican: boost, fillAmerican: fill,
      fairAmerican: form.fair === "" ? null : +form.fair, rfqContracts: cap, hedgeMode: form.mode });
    return { cap, d };
  }, [form.stake, form.boost, form.fill, form.fair, form.mode]);

  // Lifecycle split (derived, so nothing can disappear):
  //   waiting  = living parlay with NO confirmed real fill yet  → "Active — waiting to be filled"
  //   filled   = living parlay WITH ≥1 confirmed real fill       → "Filled — awaiting settlement"
  // A confirmed real fill means Kalshi actually executed the position (from combo_fills, the
  // read-only fills reader) — NOT merely a quote the worker posted.
  const { waiting, filledParlays } = useMemo(() => {
    const w = [], f = [];
    (parlays || []).forEach((p) => ((realFills[p.id] || 0) > 0 ? f : w).push(p));
    return { waiting: w, filledParlays: f };
  }, [parlays, realFills]);

  const setLeg = (id, patch) => setLegRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addLeg = () => setLegRows((rows) => [...rows, { id: (rows.at(-1)?.id || 0) + 1, gameKey: "", marketVal: "" }]);
  const removeLeg = (id) => setLegRows((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));

  const addParlay = async () => {
    const legs = readLegs();
    if (legs.length < 2) return alert("Pick at least 2 legs (game + market each).");
    if (!(+form.stake > 0) || !+form.boost || !+form.fill) return alert("Enter stake, boosted odds, and fill odds.");
    const cap = hedgeCap({ stake: +form.stake, boostAmerican: +form.boost, fillAmerican: +form.fill, mode: form.mode });
    const row = { user_id: user.id, label: form.label.trim() || legs.map((l) => l.label).join(" + "),
      legs, mve_collection: games.comboCollection, leg_keys: legs.map((l) => `${l.ticker}:${l.side}`).sort(),
      parlay_stake: +form.stake, parlay_american: +form.boost, fill_american: +form.fill,
      fair_american: form.fair === "" ? null : +form.fair, hedge_mode: form.mode, max_contracts: cap, scale_factor: 1,
      starts_at: form.starts ? new Date(form.starts).toISOString() : null };
    const { error } = await supabase.from("combo_parlays").insert(row);
    if (error) return alert("Save failed: " + error.message);
    setLegRows([{ id: 1, gameKey: "", marketVal: "" }, { id: 2, gameKey: "", marketVal: "" }]);
    setForm((f) => ({ ...f, label: "", labelEdited: false, starts: "" })); reload();
  };
  const removeParlay = async (id) => { await supabase.from("combo_parlays").delete().eq("id", id); reload(); };
  // Move a parlay to History: deactivate it (worker stops watching) and stamp archived_at.
  const archiveParlay = async (id) => { await supabase.from("combo_parlays").update({ active: false, archived_at: new Date().toISOString() }).eq("id", id); reload(); };
  // Reactivate a parlay the worker paused (active=false) — it resumes watching for RFQs.
  const reactivateParlay = async (id) => { await supabase.from("combo_parlays").update({ active: true }).eq("id", id); reload(); };
  const toggleKill = async () => { const next = !kill; setKill(next);
    await supabase.from("combo_settings").upsert({ user_id: user.id, kill_switch: next, updated_at: new Date().toISOString() }); };

  const simulate = async () => {
    const p = parlays.find((x) => x.id === sim.parlayId);
    if (!p) return setSim((s) => ({ ...s, result: { kind: "empty" } }));
    const d = decideAtFill({ parlayStake: p.parlay_stake, parlayAmerican: p.parlay_american, fillAmerican: p.fill_american,
      fairAmerican: p.fair_american, rfqContracts: +sim.size, hedgeMode: p.hedge_mode || "1x" });
    setSim((s) => ({ ...s, result: { ...d, parlay: p, kill } }));
    if (d.ok && d.locks) {
      const sub = { user_id: user.id, parlay_id: p.id, label: p.label, fill_american: d.fillAmerican, contracts: d.contracts, worst_lock: d.worst, status: "shadow" };
      await supabase.from("combo_submissions").insert(sub); reload();
    }
  };
  const loadExample = () => {
    const g = games.sports.mlb || [];
    setLegRows([
      { id: 1, gameKey: g[0]?.key || "", marketVal: g[0] ? encVal(g[0].markets.side[0].ticker, "yes") : "" },
      { id: 2, gameKey: g[1]?.key || "", marketVal: g[1] ? encVal(g[1].markets.total[0].ticker, g[1].markets.total[0].side) : "" },
      { id: 3, gameKey: g[2]?.key || "", marketVal: g[2] ? encVal(g[2].markets.spread[0].ticker, g[2].markets.spread[0].side) : "" },
    ]);
    setForm({ stake: 100, boost: 2000, fill: 1200, fair: 1000, mode: "1x", starts: "", label: "", labelEdited: false });
  };

  if (!owner) return <div style={{ color: "#6b7280", padding: 40 }}>This tab is private.</div>;

  const marketGroups = (gameKey, selVal) => {
    const g = gameIdx[gameKey]; if (!g) return null;
    return ["side", "spread", "total"].map((t) => (g.markets[t] || []).length ? (
      <optgroup key={t} label={TYPE_LABEL[t]}>
        {g.markets[t].map((m) => { const v = encVal(m.ticker, m.side); return <option key={v} value={v}>{m.label}</option>; })}
      </optgroup>) : null);
  };
  const res = sim.result;

  return (
    <div className="cl">
      <style>{`
        .cl{color:#e8eaed}
        .cl .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px}
        .cl h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin:22px 2px 10px}
        .cl label{display:block;font-size:12px;font-weight:600;color:#8a8f98;margin:0 0 4px}
        .cl input,.cl select{width:100%;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:inherit}
        .cl .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .cl .row{display:grid;gap:12px;margin-bottom:12px}.cl .c3{grid-template-columns:1fr 1fr 1fr}.cl .c2{grid-template-columns:1fr 1fr}
        .cl .legrow{display:grid;grid-template-columns:1fr 1.15fr auto;gap:8px;margin-bottom:8px;align-items:end}
        .cl .btn{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#e8eaed;font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;cursor:pointer}
        .cl .btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}.cl .btn.mini{padding:6px 10px;font-size:13px}.cl .btn.danger{color:#f87171;border-color:rgba(248,113,113,.4)}
        .cl .num{font-variant-numeric:tabular-nums}
        .cl .parlay{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:10px;background:rgba(255,255,255,0.02)}
        .cl .chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:#c3c6cc}.cl .chip.fill{background:rgba(59,130,246,.15);color:#93c5fd}
        .cl .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px;font-variant-numeric:tabular-nums}
        .cl .leg .ty{font-size:10px;font-weight:700;text-transform:uppercase;color:#7ea2e0;margin-right:5px}
        .cl .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
        .cl .tile{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px}
        .cl .tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280}.cl .tile .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:3px}
        .cl .pos{color:#34d399}.cl .neg{color:#f87171}
        .cl .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px}
        .cl .note{font-size:13px;padding:8px 10px;border-radius:8px;margin-top:8px}.cl .note.ok{background:rgba(16,185,129,.12);color:#6ee7b7}.cl .note.warn{background:rgba(245,158,11,.12);color:#fcd34d}
        .cl .post{background:#0c1512;color:#9ff0be;border-radius:8px;padding:10px 12px;font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap;margin-top:6px}
        .cl table{width:100%;border-collapse:collapse;font-size:13px}
        .cl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .cl td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums}
        .cl .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
        .cl .st.shadow{background:rgba(255,255,255,.08);color:#9aa3b2}.cl .st.filled{background:rgba(16,185,129,.15);color:#6ee7b7}.cl .st.unfilled{background:rgba(245,158,11,.12);color:#fcd34d}.cl .st.declined{background:rgba(248,113,113,.12);color:#fca5a5}
        .cl .st.real{background:rgba(139,92,246,.22);color:#c4b5fd}.cl .st.test{background:rgba(255,255,255,.06);color:#8a8f98}
        .cl .switch{position:relative;width:46px;height:26px;border-radius:999px;background:#3a3d46;cursor:pointer;border:none}
        .cl .switch .knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
        .cl .switch.on{background:#ef4444}.cl .switch.on .knob{left:23px}
        .cl .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .cl .bar{height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:2px}
        .cl .bar-fill{height:100%;background:#34d399;border-radius:999px;transition:width .3s}
        .cl .info{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:rgba(147,197,253,.2);color:#93c5fd;font-size:10px;font-weight:700;font-style:italic;font-family:Georgia,'Times New Roman',serif;cursor:pointer;position:relative;vertical-align:middle;user-select:none}
        .cl .info::after{content:attr(data-tip);position:absolute;bottom:150%;left:50%;transform:translateX(-50%);width:250px;background:#0c1016;color:#d7dbe2;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:9px 11px;font-size:12px;font-weight:400;font-style:normal;line-height:1.45;text-align:left;white-space:normal;opacity:0;pointer-events:none;transition:opacity .12s;z-index:30;box-shadow:0 6px 20px rgba(0,0,0,.4)}
        .cl .info::before{content:"";position:absolute;bottom:150%;left:50%;transform:translate(-50%,90%);border:6px solid transparent;border-top-color:#0c1016;opacity:0;transition:opacity .12s;z-index:31}
        .cl .info:hover::after,.cl .info:focus::after,.cl .info:hover::before,.cl .info:focus::before{opacity:1}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Combo Locks</div>
        <span className="chip" style={{ background: srcLive ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.06)", color: srcLive ? "#6ee7b7" : "#9aa3b2" }}>games: {srcLive ? "live" : "sample"}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "#8a8f98", fontWeight: 600 }}>Kill-switch</span>
        <button className={"switch" + (kill ? " on" : "")} onClick={toggleKill} aria-label="kill switch"><span className="knob" /></button>
      </div>
      {kill && <div className="note warn" style={{ marginBottom: 12 }}>⛔ Kill-switch engaged — the live worker posts nothing. Simulations below are shown for reference only.</div>}

      <h3>Active — waiting to be filled</h3>
      <div className="card">
        {waiting.length === 0 ? <div className="empty">Nothing waiting — add a parlay below, or check the Filled / History sections.</div> : waiting.map((p) => (
          <div className="parlay" key={p.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>{p.label}</span>
              {(() => {
                const paused = p.active === false;
                const awaiting = (quoted[p.id] || 0) > (realFills[p.id] || 0);
                if (paused) return <span className="chip" style={{ background: "rgba(245,158,11,.15)", color: "#fcd34d" }} title="The worker paused this parlay because it recorded a posted quote as a fill. It is NOT watching for RFQs until you reactivate it.">⏸ worker paused</span>;
                if (awaiting) return <span className="chip" style={{ background: "rgba(147,197,253,.18)", color: "#93c5fd" }} title="A quote was posted for this combo but the taker hasn't accepted it — no position held yet.">quote posted — awaiting acceptance</span>;
                return <span className="chip" style={{ background: "rgba(16,185,129,.15)", color: "#6ee7b7" }} title="The worker is watching the RFQ firehose for this combo.">● watching</span>;
              })()}
              <span className="chip num">have {fmtAm(p.parlay_american)} · ${p.parlay_stake}</span>
              <span className="chip fill num">fill {fmtAm(p.fill_american)}</span>
              {(() => { const eff = fillView(p.fill_american); const beatsFair = p.fair_american != null && eff.effTaker >= p.fair_american;
                return <span className="chip num" title="What the taker is matched at after their 7% fee — this is what they shop on" style={{ background: beatsFair ? "rgba(16,185,129,.15)" : "rgba(255,255,255,0.06)", color: beatsFair ? "#6ee7b7" : "#c3c6cc" }}>taker gets {fmtAm(eff.effTaker)}</span>; })()}
              {p.fair_american != null && <span className="chip num">fair {fmtAm(p.fair_american)}</span>}
              <span style={{ flex: 1 }} />
              {p.active === false && <button className="btn mini" onClick={() => reactivateParlay(p.id)} title="Resume watching for RFQs on this combo">Reactivate</button>}
              <button className="btn mini" onClick={() => archiveParlay(p.id)} title="Move to history — the worker stops watching it">Move to history</button>
              <button className="btn mini danger" onClick={() => removeParlay(p.id)}>Remove</button>
            </div>
            <div>{(p.legs || []).map((l, i) => <span className="leg" key={i}><span className="ty">{l.type}</span>{l.label} · {l.ticker}:{l.side}</span>)}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }} className="num">collection {p.mve_collection} · {MODE_LABEL[p.hedge_mode] || p.hedge_mode || "1× pure hedge"} · cap {p.max_contracts} contracts{p.starts_at ? ` · moves to history ~${historyMoveAt(p.starts_at).toLocaleString()}` : ""}{(() => { const mc = matchCounts[p.id]; return mc && mc.n ? ` · matched ${mc.n} RFQ${mc.n === 1 ? "" : "s"}${mc.locks_n ? ` (${mc.locks_n} lockable)` : ""}` : " · matched 0 RFQs"; })()}</div>
            {(() => {
              const real = realFills[p.id] || 0, q = quoted[p.id] || 0, cap = p.max_contracts || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((real / cap) * 100)) : 0;
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                    <span style={{ color: "#8a8f98", fontWeight: 600 }}>Real fills (Kalshi account)</span>
                    <span className="num" style={{ color: real > 0 ? "#34d399" : "#6b7280" }}>{real} of {cap} filled{q > real ? ` · ${q} quoted` : ""}</span>
                  </div>
                  <div className="bar"><div className="bar-fill" style={{ width: pct + "%" }} /></div>
                  {q > real && <div style={{ fontSize: 11, color: "#fcd34d", marginTop: 3 }}>⚠ {q} contracts quoted, only {real} confirmed filled by Kalshi — the difference wasn’t accepted (or hasn’t executed yet).</div>}
                </div>
              );
            })()}
          </div>
        ))}
        {realUnattr > 0 && <div style={{ fontSize: 12, color: "#8a8f98", marginTop: 6 }}>Note: {realUnattr} real combo contract(s) filled couldn’t be tied to a specific parlay (Kalshi fills carry no quote id) — counted but shown unattributed.</div>}
      </div>

      <h3>Filled — awaiting settlement</h3>
      <div className="card">
        {filledParlays.length === 0 ? (
          <div className="empty">No confirmed fills yet. A parlay lands here once Kalshi actually executes a real position for it (from your account fills) — a posted quote that no taker accepted does not count.</div>
        ) : filledParlays.map((p) => {
          const real = realFills[p.id] || 0, q = quoted[p.id] || 0, cap = p.max_contracts || 0;
          const pct = cap > 0 ? Math.min(100, Math.round((real / cap) * 100)) : 0;
          return (
            <div className="parlay" key={p.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>{p.label}</span>
                <span className="chip" style={{ background: "rgba(16,185,129,.15)", color: "#6ee7b7" }} title="Kalshi has executed a real position — settles when the games finish.">✓ filled · settling</span>
                <span className="chip fill num">fill {fmtAm(p.fill_american)}</span>
                <span style={{ flex: 1 }} />
                <button className="btn mini" onClick={() => archiveParlay(p.id)} title="Move to history now">Move to history</button>
              </div>
              <div>{(p.legs || []).map((l, i) => <span className="leg" key={i}><span className="ty">{l.type}</span>{l.label} · {l.ticker}:{l.side}</span>)}</div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                  <span style={{ color: "#8a8f98", fontWeight: 600 }}>Real fills (Kalshi account)</span>
                  <span className="num" style={{ color: "#34d399" }}>{real} of {cap} filled{q > real ? ` · ${q} quoted` : ""}</span>
                </div>
                <div className="bar"><div className="bar-fill" style={{ width: pct + "%" }} /></div>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }} className="num">{MODE_LABEL[p.hedge_mode] || p.hedge_mode}{(() => { const mc = matchCounts[p.id]; return mc && mc.n ? ` · matched ${mc.n} RFQ${mc.n === 1 ? "" : "s"}` : ""; })()}{p.starts_at ? ` · moves to history ~${historyMoveAt(p.starts_at).toLocaleString()}` : " · move to history manually when games end"}</div>
            </div>
          );
        })}
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div>
          <h3>Add a parlay</h3>
          <div className="card">
            <label>Legs — pick each game, then the market (side / spread / total, incl. alternates)</label>
            {legRows.map((r) => (
              <div className="legrow" key={r.id}>
                <div><label>Game</label>
                  <select value={r.gameKey} onChange={(e) => setLeg(r.id, { gameKey: e.target.value, marketVal: "" })}>
                    <option value="">— game —</option>
                    {(games.sports.mlb || []).map((g) => <option key={g.key} value={g.key}>{g.title}{g.date ? " · " + g.date : ""}</option>)}
                  </select></div>
                <div><label>Market</label>
                  <select value={r.marketVal} onChange={(e) => setLeg(r.id, { marketVal: e.target.value })}>
                    <option value="">— market —</option>{marketGroups(r.gameKey, r.marketVal)}
                  </select></div>
                <button className="btn mini" title="remove" onClick={() => removeLeg(r.id)}>✕</button>
              </div>
            ))}
            <button className="btn mini" onClick={addLeg}>+ Add leg</button>
            <div className="row c3" style={{ marginTop: 14 }}>
              <div><label>Stake ($) — your bet</label><input className="num" type="number" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} /></div>
              <div><label>Boosted odds — you have</label><input className="num" type="number" value={form.boost} onChange={(e) => setForm({ ...form, boost: e.target.value })} /></div>
              <div><label style={{ display: "flex", alignItems: "center", gap: 6 }}>Fill odds — you sell at (after maker fees)
                {+form.fill ? <span className="info" tabIndex={0} data-tip={`The taker is matched at ${fmtAm(fillView(+form.fill).effTaker)} — worse than your ${fmtAm(+form.fill)}, because their taker fee (7%) is 4× your maker fee. That's what a taker actually gets.`}>i</span> : null}
              </label><input className="num" type="number" value={form.fill} onChange={(e) => setForm({ ...form, fill: e.target.value })} /></div>
            </div>
            <div className="row c2">
              <div><label>Fair odds — optional</label><input className="num" type="number" value={form.fair} onChange={(e) => setForm({ ...form, fair: e.target.value })} /></div>
              <div><label>Hedge mode — sets contracts automatically</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option value="riskfree">Risk-free — floor $0, keep upside</option>
                  <option value="1x">1× pure hedge — equal both sides (default)</option>
                  <option value="2x">2× — directional short (can lose big)</option>
                  <option value="3x">3× — directional short (can lose big)</option>
                </select></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>Game start — optional (auto-moves this parlay to history once the time passes)</label>
              <input className="num" type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />
            </div>
            {preview && (
              <div className="tiles" style={{ marginTop: 2 }}>
                <div className="tile"><div className="k">Auto contracts (cap)</div><div className="v num">{preview.cap}</div></div>
                <div className="tile"><div className="k">You profit</div>
                  <div className="num" style={{ marginTop: 4, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
                    <div className={preview.d.hit >= 0 ? "pos" : "neg"}>{money(preview.d.hit)} <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>if the parlay wins</span></div>
                    <div className={preview.d.miss >= 0 ? "pos" : "neg"}>{money(preview.d.miss)} <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>if the parlay loses</span></div>
                  </div>
                </div>
                <div className="tile"><div className="k">Worst case at cap</div><div className={"v " + (preview.d.worst >= 0 ? "pos" : "neg")}>{money(preview.d.worst)}</div></div>
              </div>
            )}
            {preview && !preview.d.locks && form.mode !== "2x" && form.mode !== "3x" && (
              <div className="note warn">⚠ This won't fully lock — your boosted odds and fill odds are too close. Widen the gap (bigger boost, or offer stingier fill odds).</div>
            )}
            {preview && (form.mode === "2x" || form.mode === "3x") && (
              <div className="note warn">⚠ Directional: {MODE_LABEL[form.mode]} sells past the hedge. You profit if the combo misses but take the loss shown above if it hits.</div>
            )}
            <label>Label — auto-filled from your legs, edit if you like</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, labelEdited: true })} placeholder="pick legs above…" />
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button className="btn primary" onClick={addParlay}>Add to active parlays</button>
              <button className="btn" onClick={loadExample}>Load example</button>
            </div>
          </div>
        </div>

        <div>
          <h3>Simulate an incoming RFQ</h3>
          <div className="card">
            <div className="row c2">
              <div><label>Against parlay</label>
                <select value={sim.parlayId} onChange={(e) => setSim({ ...sim, parlayId: e.target.value })}>
                  <option value="">— add a parlay first —</option>
                  {parlays.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select></div>
              <div><label>RFQ size (contracts)</label><input className="num" type="number" value={sim.size} onChange={(e) => setSim({ ...sim, size: e.target.value })} /></div>
            </div>
            <button className="btn primary" onClick={simulate}>See what it would do</button>
            <div style={{ marginTop: 16 }}>
              {res && res.kind === "empty" && <div className="empty">Add a parlay first.</div>}
              {res && res.ok === false && res.kind !== "empty" && (
                <div><div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 8 }}>Would decline this RFQ</div>
                  <div className="kv"><span>Reason</span><span className="num">{res.reason === "over_limit" ? `RFQ ${sim.size} > cap ${res.cap}` : res.reason}</span></div></div>
              )}
              {res && res.ok && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: res.locks ? "#34d399" : "#fcd34d" }}>
                    {res.locks ? "✓ Would quote — profit locked either way" : "! Does NOT lock at this size — this would be a bet, not an arb"}
                  </div>
                  <div className="tiles">
                    <div className="tile"><div className="k">You profit if parlay wins</div><div className={"v " + (res.hit >= 0 ? "pos" : "neg")}>{money(res.hit)}</div></div>
                    <div className="tile"><div className="k">You profit if parlay loses</div><div className={"v " + (res.miss >= 0 ? "pos" : "neg")}>{money(res.miss)}</div></div>
                    <div className="tile"><div className="k">Worst case</div><div className={"v " + (res.worst >= 0 ? "pos" : "neg")}>{money(res.worst)}</div></div>
                  </div>
                  <div className="kv"><span>You sell at (after your maker fee)</span><span className="num">{fmtAm(res.fillAmerican)}</span></div>
                  <div className="kv"><span>Taker is matched at</span><span className="num">{fmtAm(res.effTakerOdds)}</span></div>
                  <div className="kv"><span>Contracts</span><span className="num">{res.contracts}</span></div>
                  {res.competitive != null && <div className={"note " + (res.competitive ? "ok" : "warn")}>{res.competitive ? `✓ Your fill ${fmtAm(res.fillAmerican)} beats fair ${fmtAm(res.parlay.fair_american)} — competitive.` : `⚠ Your fill ${fmtAm(res.fillAmerican)} is stingier than fair ${fmtAm(res.parlay.fair_american)} — probably won't fill.`}</div>}
                  {res.locks && <><label style={{ marginTop: 12 }}>Quote it would post to Kalshi</label><div className="post">POST /communications/quotes{"\n"}{JSON.stringify(res.quote, null, 2)}</div></>}
                  {res.kill && <div className="note warn">Kill-switch is engaged — the live worker would not actually post this.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <h3>History — games over</h3>
      <div className="card">
        {archived.length === 0 ? <div className="empty">Nothing here yet. A parlay moves to History when you click “Move to history”, or automatically ~{HISTORY_BUFFER_HOURS}h after its game start (approx when the games finish).</div> : (
          <table><thead><tr><th>Archived</th><th>Parlay</th><th>Have</th><th>Fill</th><th>Mode</th><th>Cap</th><th>Game start</th></tr></thead>
            <tbody>{archived.map((a) => (
              <tr key={a.id}><td>{a.archived_at ? new Date(a.archived_at).toLocaleString() : "—"}</td><td>{a.label}</td><td>{fmtAm(a.parlay_american)} · ${a.parlay_stake}</td><td>{fmtAm(a.fill_american)}</td><td>{MODE_LABEL[a.hedge_mode] || a.hedge_mode}</td><td>{a.max_contracts}</td><td>{a.starts_at ? new Date(a.starts_at).toLocaleString() : "—"}</td></tr>
            ))}</tbody></table>
        )}
      </div>

      <h3>Submitted bets — history</h3>
      <div className="card">
        {history.length === 0 ? <div className="empty">No submissions yet. Shadow quotes you run land here; once the worker is live, real fills and no-fills show as REAL with a Filled / Unfilled status.</div> : (
          <table><thead><tr><th>Type</th><th>When</th><th>Parlay</th><th>Fill</th><th>Contracts</th><th>Worst lock</th><th>Status</th></tr></thead>
            <tbody>{history.map((h) => {
              const isReal = h.is_live || h.status === "filled" || h.status === "unfilled";
              // A row logged 'filled' but with NO order_id is a posted quote that wasn't accepted —
              // show it honestly as "quoted", not "filled". Only a real execution id counts as filled.
              const executed = !!h.order_id;
              const dispStatus = h.status === "filled" && !executed ? "quoted (awaiting)"
                : h.status === "shadow" ? "would post"
                : h.status;
              const stClass = h.status === "filled" && !executed ? "unfilled" : h.status;
              return (
              <tr key={h.id}><td><span className={"st " + (isReal ? "real" : "test")}>{isReal ? "REAL" : "SHADOW"}</span></td><td>{new Date(h.created_at).toLocaleString()}</td><td>{h.label}</td><td>{fmtAm(h.fill_american)}</td><td>{h.contracts}</td><td>{money(h.worst_lock)}</td>
                <td><span className={"st " + stClass} title={h.status === "filled" && !executed ? "Quote posted to Kalshi but not accepted — no position held." : ""}>{dispStatus}</span></td></tr>
            ); })}</tbody></table>
        )}
      </div>

      <h3>Quote outcomes — did our quotes win?</h3>
      <div className="card">
        {outcomes.length === 0 ? (
          <div className="empty">No quote outcomes yet. Once the read-only watcher is running, every quote the worker posts is tracked here: <b>accepted</b> / <b>executed</b> (real fill) / <b>lost</b> (outbid, or the taker took no one), with response latency and a Kalshi fill reconcile.</div>
        ) : (
          <table><thead><tr><th>When</th><th>Parlay</th><th>Your quote</th><th>Outcome</th><th>Why (if lost)</th><th>Latency</th><th>Real fill</th></tr></thead>
            <tbody>{outcomes.map((o) => {
              const map = { executed: ["rgba(16,185,129,.15)", "#6ee7b7", "executed"], accepted: ["rgba(147,197,253,.18)", "#93c5fd", "accepted"], lost: ["rgba(248,113,113,.14)", "#fca5a5", "lost"], posted: ["rgba(255,255,255,.06)", "#9aa3b2", "awaiting"] };
              const [bg, col, lbl] = map[o.outcome] || map.posted;
              const whyMap = { outbid: "outbid — a better price won", no_taker: "taker accepted no one", unknown: "unknown" };
              const why = o.outcome === "lost" ? (o.loss_reason ? (whyMap[o.loss_reason] || o.loss_reason) : "checking…") : "—";
              return (
              <tr key={o.id || o.quote_id}>
                <td>{o.posted_at ? new Date(o.posted_at).toLocaleString() : "—"}</td>
                <td>{o.label || "—"}</td>
                <td className="num">{o.no_bid != null ? `NO $${Number(o.no_bid).toFixed(2)}` : "—"}{o.fill_american ? ` · ${fmtAm(o.fill_american)}` : ""}</td>
                <td><span className="st" style={{ background: bg, color: col }} title={o.outcome === "executed" ? "Kalshi executed a real position." : ""}>{lbl}</span></td>
                <td style={{ color: o.loss_reason === "outbid" ? "#fca5a5" : o.loss_reason === "no_taker" ? "#9aa3b2" : "#6b7280" }}>{why}</td>
                <td className="num">{o.responded_ms != null ? `${o.responded_ms} ms` : "—"}</td>
                <td className="num">{o.fill_confirmed ? `✓ ${o.fill_count || ""}` : (o.outcome === "executed" ? "checking…" : "—")}</td>
              </tr>
            ); })}</tbody></table>
        )}
      </div>
    </div>
  );
}
