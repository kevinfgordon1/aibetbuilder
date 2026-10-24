// Live inverse bet fairs per leg for "What to root for" (same method as Combo Sniper / noboost pm-live):
//   leg fair = 1 − (fee-included VWAP to buy the OPPOSITE side until it can win $500), best venue wins.
// Venues: Kalshi public orderbooks (every leg), Polymarket US + Novig from our odds-relay
// (NFL / NCAAF moneylines), ProphetX (off until a key is set). Stale (>15s) or < $500 depth (potential profit, not stake) → dropped.
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

/** levels [[price, contracts]] → fee-included VWAP until the bet can win $usd of PROFIT, or { fail }.
 *  Depth = potential profit, not stake (Kevin): a contract bought at fee-included cost c wins 1 − c,
 *  so $3,000 at −200 (c ≈ 0.667) is $1,500 of depth. */
export function walk(levels, venue, usd = DEPTH_USD) {
  const fee = FEES[venue];
  const lv = (levels || []).filter(([p, q]) => p > 0 && p < 1 && q > 0).sort((a, b) => a[0] - b[0]);
  if (!lv.length) return { fail: "no_ask" };
  let spent = 0, got = 0, profit = 0;
  const top = lv[0][0] + fee(lv[0][0]);
  for (const [p, q] of lv) {
    const c = p + fee(p);
    const per = 1 - c;
    if (!(per > 0)) continue;
    const take = Math.min(q, (usd - profit) / per);
    spent += take * c; got += take; profit += take * per;
    if (profit >= usd - 1e-9) return { vwap: spent / got, top, stakeUsd: spent, profitUsd: profit };
  }
  return { fail: "depth", top, depthUsd: profit };
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
// Root-for only. Started games: a Novig in-game quote is dropped when its own update time is older than
// NOVIG_INPLAY_MAX_AGE_MS, or when it disagrees with a fresh Polymarket US / Kalshi price for the same team by more
// than NOVIG_INPLAY_MAX_GAP (seen Oct 18: Novig TB stuck at its kickoff 0.44 while Polymarket showed 0.77, even though
// Novig kept refreshing the quote's timestamp). The inverse bet method on the remaining venues is unchanged.
export const NOVIG_INPLAY_MAX_AGE_MS = 3 * 60 * 1000;
export const NOVIG_INPLAY_MAX_GAP = 0.1;
const topOf = (levels) => { const ps = (levels || []).map((l) => Number(l[0])).filter((x) => x > 0 && x < 1); return ps.length ? Math.min(...ps) : null; };
export function relayIndex({ kalshiBoard = [], polymarket = [], novig = [], novigLive = false, polledAt = Date.now(), started = null, kalshiBooks = {}, kalshiAt = polledAt }) {
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
      if (!q || q.bet_type !== "moneyline" || q.is_alt) continue; // in-game quotes allowed (same 15s / $500 rules)
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
      ((out[ev] = out[ev] || {})[code] = out[ev][code] || {})[venue] = { levels, at, changed };
    }
  };
  put("polymarket", polymarket); put("novig", novig);
  const dropped = [];
  if (started && started.size) for (const ev of Object.keys(out)) {
    if (!started.has(ev)) continue;
    for (const [code, vs] of Object.entries(out[ev])) {
      const nv = vs.novig; if (!nv) continue;
      const pm = vs.polymarket && polledAt - vs.polymarket.at <= STALE_MS ? topOf(vs.polymarket.levels) : null;
      const kb = kalshiBooks[`${ev}-${code}`]; const ks = kb && polledAt - kalshiAt <= STALE_MS ? topOf(kb.yes) : null;
      const ref = pm != null ? pm : ks; const top = topOf(nv.levels);
      const old = !(nv.changed > 0) || polledAt - nv.changed > NOVIG_INPLAY_MAX_AGE_MS;
      const off = ref != null && top != null && Math.abs(top - ref) > NOVIG_INPLAY_MAX_GAP;
      if (old || off) { delete vs.novig; dropped.push({ event: ev, team: code, novig: top, ref, reason: old ? "old" : "off-market" }); }
    }
  }
  Object.defineProperty(out, "droppedNovig", { value: dropped, enumerable: false });
  return out;
}

/** Fair for one leg { ticker, side }. kalshiBooks: { [ticker]: {yes:[...], no:[...]} } (fetched now). */
export function legFair(leg, { kalshiBooks = {}, relay = {}, now = Date.now(), kalshiAt = now, usd = DEPTH_USD } = {}) {
  const r = legEvent(leg);
  const sources = [];
  const tryV = (venue, levels, at, via) => {
    if (!levels) return;
    const age = now - at;
    const w = walk(levels, venue, usd);
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

/** Price to BUY outcome `team` of a game (or side of a binary market) with $usd: the best fee-included
 *  VWAP across the same inverse-bet sources. Buying team T = "opponent loses" = legFair(opponent). */
export function buyQuote(event, kind, outcome, opts = {}) {
  if (kind === "game") {
    const teams = opts.teams || [];
    const opp = teams.find((t) => t !== outcome);
    if (!opp) return null;
    const f = legFair({ ticker: `${event}-${opp}`, side: "yes" }, opts);
    return f.p == null ? null : { cost: 1 - f.p, american: american(1 - f.p), venue: f.best, via: (f.sources.find((x) => x.used && x.venue === f.best && Math.abs(x.cost - (1 - f.p)) < 1e-12) || {}).via || null };
  }
  const f = legFair({ ticker: event, side: outcome === "yes" ? "no" : "yes" }, opts);
  return f.p == null ? null : { cost: 1 - f.p, american: american(1 - f.p), venue: f.best, via: outcome === "yes" ? "Yes" : "No" };
}
