// Sniper "Matched" analytics: filled sniper positions → Combo Locks-style engine positions + performance stats.
// The sniper is the HOUSE: it sold the parlay (holds NO). Parlay hits (every leg wins) = we lose our cost;
// any leg loses = we win (contracts − cost). So we root AGAINST the legs.

const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function legMeta(key, names = {}) {
  const [tRaw, sideRaw] = String(key || "").split(":"); const t = tRaw.toUpperCase(); const side = (sideRaw || "yes").toLowerCase();
  const p = t.split("-"); const gm = /^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/.exec(p[1] || "");
  const date = gm ? `20${gm[1]}-${String(MON[gm[2]] + 1).padStart(2, "0")}-${gm[3]}` : null;
  const teams = gm ? gm[4] : "";
  if (t.startsWith("KXNFLTD-")) {
    const code = p[2] || ""; const team = code.slice(0, 3);
    let who = names[t] ? String(names[t]).split(":")[0].trim() : null;
    if (!who) { const m = /^[A-Z]{2,3}([A-Z])([A-Z]+?)\d*$/.exec(code); who = m ? `${m[1]}. ${title(m[2])}` : code; }
    const opp = teams.startsWith(team) ? teams.slice(team.length) : teams.slice(0, teams.length - team.length);
    return { ticker: t, side, type: "td", market: "Anytime TD", label: `${who} (${team}) TD`, bet: `${who} anytime TD${side === "no" ? " — No" : ""}`, game: `${team} vs ${opp}`, gameKey: `KXNFLGAME-${p[1]}`, date };
  }
  const pick = p[2] || ""; const opp = teams.startsWith(pick) ? teams.slice(pick.length) : teams.endsWith(pick) ? teams.slice(0, teams.length - pick.length) : "";
  return { ticker: t, side, type: "ml", market: "Moneyline", label: `${pick} ML`, bet: `${pick} to beat ${opp}${side === "no" ? " — No" : ""}`, game: teams.startsWith(pick) ? `${pick} vs ${opp}` : `${opp} vs ${pick}`, gameKey: `KXNFLGAME-${p[1]}`, date };
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
export function rowMoney(r) {
  const n = num(r.filled_contracts) || num(r.contracts); const cost = num(r.filled_cost) + num(r.filled_fee);
  const risk = cost > 0 ? cost : num(r.risk); const toWin = n - risk;
  const fair = num(r.fair_yes); const ev = fair > 0 ? n * (1 - fair) - risk : num(r.ev);
  const sold = n > 0 && cost > 0 ? 1 - cost / n : num(r.quote_yes);
  return { n, risk, toWin, ev, fair, sold };
}
export function isMatched(r) { return !r.dry_run && (num(r.filled_contracts) > 0 || r.phase === "accepted" || r.phase === "filled" || r.phase === "settled"); }
export function matchedStatus(r, legResults) {
  if (r.phase === "settled" || r.settled_at) { const p = num(r.realized_pnl); return p > 0 ? "won" : p < 0 ? "lost" : "void"; }
  if (legResults && isDecided(r, legResults)) return "decided";
  return r.phase === "accepted" ? "confirming" : "open";
}
/** Any leg already lost, or every leg already won: the fill is decided and is not open risk. */
export function isDecided(r, legResults = {}) {
  const st = positionState(r, legResults).state;
  return st === "busted" || st === "allHit";
}
/** Filled, unsettled, and still undecided (a won leg with something left to play is still open). */
export function isOpenRisk(r, legResults = {}) {
  if (!r || r.dry_run || r.status !== "open" || r.phase === "settled" || r.settled_at) return false;
  if (!(num(r.filled_contracts) > 0)) return false;
  return positionState(r, legResults).state === "live";
}
/** Kalshi event id or ticker → game code (26OCT26DALPHI). TD / spread / total share a game's code. */
export function gameCode(id) {
  const p = String(id || "").toUpperCase().split(":")[0].split("-");
  return p.length >= 2 && p[1] ? p[1] : p[0] || "";
}
export function distinctGameCount(ids) {
  return new Set((ids || []).map(gameCode).filter(Boolean)).size;
}

/** open filled rows → engine positions (hit = all legs win = −risk; miss = +toWin). */
export function enginePositions(rows, names = {}) {
  return rows.filter((r) => isMatched(r) && r.status === "open").map((r) => {
    const m = rowMoney(r); const legs = (r.legs || []).map((k) => { const x = legMeta(k, names); return { ticker: x.ticker, side: x.side, label: x.label, game: x.type === "ml" ? x.game : null, type: x.type }; });
    return { id: r.rfq_id, label: (r.legs || []).map((k) => legMeta(k, names).label).join(" + "), legs, hit: -m.risk, miss: m.toWin };
  });
}

const bucketOf = (r) => { const k = (r.legs || []).length; return k <= 2 ? "2 legs" : k <= 4 ? "3–4 legs" : "5+ legs"; };
const marketOf = (r) => { const t = new Set((r.legs || []).map((k) => legMeta(k).type)); return t.size > 1 ? "ML + TD" : t.has("td") ? "TD only" : "ML only"; };
const etDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null);

function agg(list, legResults) {
  const s = { n: list.length, won: 0, lost: 0, void: 0, open: 0, decided: 0, risk: 0, toWin: 0, pnl: 0, settledRisk: 0, ev: 0, settledEv: 0 };
  for (const r of list) {
    const m = rowMoney(r); const st = matchedStatus(r, legResults);
    s.risk += m.risk; s.toWin += m.toWin; s.ev += m.ev;
    if (st === "won" || st === "lost" || st === "void") { s[st] += 1; s.pnl += num(r.realized_pnl); s.settledRisk += m.risk; s.settledEv += m.ev; }
    else if (st === "decided") s.decided += 1;
    else s.open += 1;
  }
  s.roi = s.settledRisk > 0 ? s.pnl / s.settledRisk : null;
  s.winRate = s.won + s.lost > 0 ? s.won / (s.won + s.lost) : null;
  return s;
}

/** legResults: { TICKER: 'yes'|'no' } settled leg outcomes (Kalshi). */
export function perfStats(rows, legResults = {}) {
  const m = (rows || []).filter(isMatched).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const total = agg(m, legResults);
  // expected win rate on settled = Σ P(parlay misses) at fill-time fair
  const settled = m.filter((r) => r.phase === "settled");
  total.expectedWins = settled.reduce((a, r) => a + (1 - num(r.fair_yes)), 0);
  let cum = 0, cumEv = 0;
  const curve = settled.slice().sort((a, b) => (a.settled_at < b.settled_at ? -1 : 1)).map((r) => { cum += num(r.realized_pnl); cumEv += rowMoney(r).ev; return { at: r.settled_at, pnl: cum, ev: cumEv }; });
  const group = (fn) => { const g = new Map(); for (const r of m) { const k = fn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); } return [...g.entries()].map(([key, list]) => ({ key, ...agg(list, legResults) })).sort((a, b) => (a.key < b.key ? -1 : 1)); };
  // per leg (ticker+side) across matched positions; we root AGAINST each leg
  const legs = new Map();
  for (const r of m) {
    const mm = rowMoney(r); const st = matchedStatus(r, legResults);
    for (const k of r.legs || []) {
      const x = legMeta(k); const key = `${x.ticker}:${x.side}`;
      const L = legs.get(key) || { key, bet: x.bet, game: x.game, market: x.market, positions: 0, risk: 0, open: 0, won: 0, lost: 0, pnl: 0, result: null };
      L.positions += 1; L.risk += mm.risk; if (st === "open" || st === "confirming") L.open += 1;
      if (st === "won") L.won += 1; if (st === "lost") L.lost += 1; L.pnl += num(r.realized_pnl);
      const res = legResults[x.ticker]; if (res === "yes" || res === "no") L.result = (res === x.side) ? "leg won (bad for us)" : "leg lost (good for us)";
      legs.set(key, L);
    }
  }
  const legRows = [...legs.values()].sort((a, b) => b.risk - a.risk);
  const gameRows = group((r) => [...new Set((r.legs || []).map((k) => legMeta(k).game))].join(" · ")).sort((a, b) => b.risk - a.risk);
  return {
    total, curve,
    byLegs: group(bucketOf), byMarket: group(marketOf), byDay: group((r) => etDay(r.created_at)),
    byEdge: group((r) => { const e = num(r.roi) * 100; return e < 3.5 ? "3–3.5%" : e < 5 ? "3.5–5%" : "5%+"; }),
    legRows, gameRows,
    beatUs: legRows.filter((l) => l.result === "leg won (bad for us)").sort((a, b) => b.risk - a.risk).slice(0, 8),
    savedUs: legRows.filter((l) => l.result === "leg lost (good for us)").sort((a, b) => b.risk - a.risk).slice(0, 8),
  };
}

/** Needle history for the Sniper page (no saved snapshots needed): one row per fill day (ET, 2 AM rollover like Today).
 *  pregame_ev = fill-time expected profit of that day's fills (fees included); live_ev = realized P&L of the settled fills
 *  plus fill-time EV of fills still open; result = live_ev − pregame_ev (how settled fills ran vs expectation). */
export function sniperNeedleHistory(rows, nowMs = Date.now()) {
  const dayOf = (iso) => new Date(Date.parse(iso) - 2 * 3600e3).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const by = {};
  for (const r of rows || []) {
    if (!isMatched(r) || !(num(r.filled_contracts) > 0) || !r.created_at) continue;
    const d = dayOf(r.created_at); const m = rowMoney(r);
    const b = by[d] || (by[d] = { day: d, locks: 0, games: new Set(), pregame_ev: 0, live_ev: 0, settled: 0, open: 0, pnl: 0 });
    b.locks++; const gs = Array.isArray(r.games) ? r.games : [];
    for (const g of gs) b.games.add(String(g));
    if (!gs.length) for (const k of r.legs || []) b.games.add(String(k).split(":")[0].split("-").slice(0, 2).join("-"));
    b.pregame_ev += m.ev;
    const settled = r.phase === "settled" || !!r.settled_at || r.status !== "open";
    if (settled && r.realized_pnl != null) { b.settled++; b.pnl += num(r.realized_pnl); b.live_ev += num(r.realized_pnl); }
    else { b.open++; b.live_ev += m.ev; }
  }
  const today = dayOf(new Date(nowMs).toISOString());
  return Object.values(by).sort((a, b) => a.day.localeCompare(b.day)).map((b) => ({
    day: b.day, locks: b.locks, games: b.games.size, pregame_ev: +b.pregame_ev.toFixed(2), live_ev: +b.live_ev.toFixed(2),
    result: +(b.live_ev - b.pregame_ev).toFixed(2), pnl: +b.pnl.toFixed(2), settled: b.settled, open: b.open,
    final: b.open === 0 && b.day < today, sniper: true }));
}

/** Fill day of a ledger row on the Today rollover (ET, 2 AM) — shared by the needle history and Results scopes. */
export function sniperFillDay(iso) { return iso ? new Date(Date.parse(iso) - 2 * 3600e3).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null; }
/** Results scopes: perfStats per fill day (last 30 days) so the Results tab can switch Today / All / a past day. */
export function perfByDay(rows, legResults = {}) {
  const g = {}; for (const r of (rows || []).filter(isMatched)) { const d = sniperFillDay(r.created_at); if (d) (g[d] || (g[d] = [])).push(r); }
  return Object.fromEntries(Object.keys(g).sort().reverse().slice(0, 30).map((d) => [d, perfStats(g[d], legResults)]));
}

// Real fill time for a ledger row: the recorded fill decision (first book_arb, written right after the fill) when it
// sits within 10 min of row creation, else created_at. Never updated_at — the settler bumps it at settlement.
export function fillTimeOf(row, decisionAt) {
  const c = Date.parse(row && row.created_at);
  const d = Date.parse(decisionAt);
  if (Number.isFinite(d) && (!Number.isFinite(c) || (d >= c - 60e3 && d <= c + 10 * 60e3))) return decisionAt;
  return (row && row.created_at) || null;
}

// ---- Decided / live breakdown (Oct 26) ----------------------------------------------------------
// The ledger only settles a fill when Kalshi settles the whole combo market, and only while the
// sniper process runs its settle loop. So a parlay whose leg already lost (we win) or whose legs
// all already hit (we lose) can sit "open" for days. This classifies every unsettled fill from the
// per-leg Kalshi results so the dashboard shows pending P&L next to settled P&L.
//   settled     phase 'settled' (realized_pnl from the ledger, matches Kalshi's combo result)
//   busted      any leg lost → we win toWin (pending settlement)
//   allHit      every leg won → we lose our cost (pending settlement)
//   live        legs still pending
export function sportOf(legs) {
  const s = new Set((legs || []).map((k) => { const t = String(k).toUpperCase(); return t.startsWith("KXNCAAF") ? "CFB" : t.startsWith("KXNBA") ? "NBA" : t.startsWith("KXNFL") ? "NFL" : "Other"; }));
  return s.size === 1 ? [...s][0] : [...s].sort().join("+");
}
export function positionState(r, legResults = {}) {
  if (r.phase === "settled" || r.settled_at) return { state: "settled", pending: [], won: [], lost: [] };
  const won = []; const lost = []; const pending = [];
  for (const k of r.legs || []) {
    const [t, sd] = String(k).split(":"); const res = legResults[String(t).toUpperCase()]; const side = (sd || "yes").toLowerCase();
    if (res === "yes" || res === "no") (res === side ? won : lost).push(k); else pending.push(k);
  }
  return { state: lost.length ? "busted" : pending.length ? "live" : "allHit", pending, won, lost };
}
export function positionBreakdown(rows, legResults = {}) {
  const blank = () => ({ n: 0, cost: 0, pnl: 0, maxWin: 0 });
  const totals = { settled: blank(), busted: blank(), allHit: blank(), live: blank() };
  const bySport = {}; const byDay = {}; const positions = [];
  for (const r of rows || []) {
    if (r.dry_run || !(num(r.filled_contracts) > 0)) continue;
    const m = rowMoney(r); const ps = positionState(r, legResults);
    const pnl = ps.state === "settled" ? num(r.realized_pnl) : ps.state === "busted" ? m.toWin : ps.state === "allHit" ? -m.risk : 0;
    const add = (o) => { const b = o[ps.state]; b.n += 1; b.cost += m.risk; b.pnl += pnl; b.maxWin += ps.state === "live" ? m.toWin : 0; };
    add(totals);
    const sp = sportOf(r.legs); add(bySport[sp] || (bySport[sp] = { settled: blank(), busted: blank(), allHit: blank(), live: blank() }));
    const d = etDay(r.created_at) || "?"; add(byDay[d] || (byDay[d] = { settled: blank(), busted: blank(), allHit: blank(), live: blank() }));
    if (ps.state !== "settled") positions.push({ rfqId: r.rfq_id, state: ps.state, sport: sp, createdAt: r.created_at, legs: r.legs || [], pending: ps.pending, lost: ps.lost, cost: m.risk, maxWin: m.toWin, maxLoss: m.risk, pendingPnl: pnl, soldYes: m.sold });
  }
  const order = { allHit: 0, busted: 1, live: 2 };
  positions.sort((a, b) => order[a.state] - order[b.state] || (a.createdAt < b.createdAt ? -1 : 1));
  const decided = totals.settled.pnl + totals.busted.pnl + totals.allHit.pnl;
  return { totals, decidedPnl: decided, bySport, byDay, positions };
}
