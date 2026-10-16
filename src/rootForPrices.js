// Live inverse bet fairs per leg for "What to root for" (same method as Combo Sniper / noboost pm-live):
//   leg fair = 1 − (fee-included $500 VWAP to buy the OPPOSITE side), best venue wins.
// Venues: Kalshi public orderbooks (every leg), Polymarket US + Novig from our odds-relay
// (NFL / NCAAF moneylines), ProphetX (off until a key is set). Stale (>15s) or < $500 depth → dropped.
import { legEvent } from "./rootForEngine.js";

export const DEPTH_USD = 500;
export const STALE_MS = 15000;
export const FEES = {
  kalshi: (p) => 0.07 * p * (1 - p),
  polymarket: (p) => 0.0695 * p * (1 - p),
  novig: () => 0,
};
const SETTLED = 0.015;

export function american(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/** levels [[price, contracts]] → fee-included VWAP for $usd, or { fail }. */
export function walk(levels, venue, usd = DEPTH_USD) {
  const fee = FEES[venue];
  const lv = (levels || []).filter(([p, q]) => p > 0 && p < 1 && q > 0).sort((a, b) => a[0] - b[0]);
  if (!lv.length) return { fail: "no_ask" };
  let spent = 0, got = 0;
  const top = lv[0][0] + fee(lv[0][0]);
  for (const [p, q] of lv) {
    const c = p + fee(p);
    const take = Math.min(q, (usd - spent) / c);
    spent += take * c; got += take;
    if (spent >= usd - 1e-9) return { vwap: spent / got, top };
  }
  return { fail: "depth", top, depthUsd: spent };
}

/** Kalshi orderbook_fp (BIDS) → ask ladders for yes and no. */
export function kalshiAsks(ob) {
  const b = (ob && (ob.orderbook_fp || ob.orderbook)) || {};
  const rows = (a) => (Array.isArray(a) ? a.map((r) => [Number(r[0]), Number(r[1])]) : []);
  const flip = (a) => rows(a).map(([px, q]) => [Math.round((1 - px) * 1e4) / 1e4, q]);
  return { yes: flip(b.no_dollars), no: flip(b.yes_dollars) };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
function sameTeam(a, b) {
  const x = norm(a), y = norm(b);
  if (!x.length || !y.length) return false;
  if (x[x.length - 1] === y[y.length - 1]) return true;
  return x.join(" ") === y.join(" ") || (x[0] === y[0] && x[0].length > 3);
}
const etDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null);

/** Index relay quotes (polymarket-us / novig moneylines) by Kalshi game event, using the Kalshi relay
 *  board for team names. Returns { [event]: { [teamCode]: { [venue]: { levels, at } } } }. */
export function relayIndex({ kalshiBoard = [], polymarket = [], novig = [], novigLive = false, polledAt = Date.now() }) {
  const games = new Map(); // event → { away, home, date, codes:[awayCode, homeCode] }
  for (const q of kalshiBoard) {
    if (!q || q.bet_type !== "moneyline" || !q.ticker) continue;
    const r = legEvent({ ticker: q.ticker });
    if (r.kind !== "game" || games.has(r.event)) continue;
    games.set(r.event, { away: q.away, home: q.home, date: etDate(q.start), codes: r.outcomes });
  }
  const out = {};
  const put = (venue, list) => {
    for (const q of list || []) {
      if (!q || q.bet_type !== "moneyline" || q.is_alt || q.is_live) continue;
      if (venue === "polymarket" && q.feed !== "polymarket-us") continue;
      const odds = Number(q.odds);
      if (Number.isFinite(odds) && !(odds > SETTLED && odds < 1 - SETTLED)) continue;
      const d = etDate(q.start);
      let ev = null, code = null;
      for (const [id, g] of games) {
        if (g.date && d && g.date !== d) continue;
        if (!(sameTeam(g.away, q.away) && sameTeam(g.home, q.home))) continue;
        ev = id; code = sameTeam(q.side, q.away) ? g.codes[0] : sameTeam(q.side, q.home) ? g.codes[1] : null; break;
      }
      if (!ev || !code) continue;
      const levels = Array.isArray(q.depth) && q.depth.length ? q.depth.map((x) => [Number(x.odds), Number(x.size)]) : q.size > 0 ? [[odds, Number(q.size)]] : [];
      const changed = Date.parse(q.updated_at || "") || 0;
      const at = venue === "polymarket" ? Math.max(Date.parse(q.confirmed_at || "") || 0, changed) : novigLive ? polledAt : changed;
      ((out[ev] = out[ev] || {})[code] = out[ev][code] || {})[venue] = { levels, at };
    }
  };
  put("polymarket", polymarket); put("novig", novig);
  return out;
}

/** Fair for one leg { ticker, side }. kalshiBooks: { [ticker]: {yes:[...], no:[...]} } (fetched now). */
export function legFair(leg, { kalshiBooks = {}, relay = {}, now = Date.now(), kalshiAt = now } = {}) {
  const r = legEvent(leg);
  const sources = [];
  const tryV = (venue, levels, at, via) => {
    if (!levels) return;
    const age = now - at;
    const w = walk(levels, venue);
    const s = { venue, via, ageMs: Math.round(age), topAmerican: w.top != null ? american(w.top) : null };
    if (age > STALE_MS) sources.push({ ...s, used: false, reason: "stale" });
    else if (w.fail) sources.push({ ...s, used: false, reason: w.fail });
    else sources.push({ ...s, used: true, cost: w.vwap, costAmerican: american(w.vwap), reason: "ok" });
  };
  if (r.kind === "game") {
    const team = r.allowed.length === 1 ? r.allowed[0] : null; // yes-side moneyline
    const opp = team ? r.outcomes.find((t) => t !== team) : null;
    if (team && opp) {
      const own = kalshiBooks[`${r.event}-${team}`]; const oth = kalshiBooks[`${r.event}-${opp}`];
      if (oth) tryV("kalshi", oth.yes, kalshiAt, `Yes ${opp}`);
      if (own) tryV("kalshi", own.no, kalshiAt, `No ${team}`);
      const rv = (relay[r.event] || {})[opp] || {};
      for (const v of ["polymarket", "novig"]) if (rv[v]) tryV(v, rv[v].levels, rv[v].at, opp);
    }
  } else {
    const bk = kalshiBooks[r.event];
    const side = r.allowed[0];
    if (bk) tryV("kalshi", side === "yes" ? bk.no : bk.yes, kalshiAt, side === "yes" ? "No" : "Yes");
  }
  const used = sources.filter((s) => s.used);
  if (!used.length) return { p: null, american: null, best: null, sources };
  const best = used.reduce((a, b) => (b.cost < a.cost ? b : a));
  const p = 1 - best.cost;
  return { p, american: american(p), best: best.venue, oppAmerican: best.costAmerican, sources };
}
