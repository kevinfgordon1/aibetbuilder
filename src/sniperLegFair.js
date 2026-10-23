// Combo Sniper "What to root for": leg fairs the same way the sniper prices them (combo-worker
// sniper/fair.js + noboost/td-book.js legMulti). Inverse bet: leg fair = 1 − the cheapest fee-included
// $1,000 VWAP to buy the OPPOSITE side, best of Kalshi, Polymarket US, Novig and ProphetX (each its own fee).
//   Player TD legs: Kalshi public book + relay /td (Polymarket US, Novig). A venue is dropped when it is
//   stale (>15s), short of $1,000 on either side, or its Yes+No $1,000 cost is over 1 + 15% (thin book).
//   Moneylines: the root-for engine's Kalshi / Polymarket US / Novig sources at $1,000, plus ProphetX from
//   the relay board (2% commission folded into the price, as the sniper does).
// No venue survives → the sniper's own fill-time fair for that leg (sniper_decisions legDetail), so a thin
// book never turns into a fake price. Sniper page only; Combo Locks keeps rootForPrices.legFair.
import { legFair, FEES, american } from "./rootForPrices.js";

export const SNIPER_DEPTH_USD = 1000;
export const TD_MAX_OVERROUND = 0.15;
export const STALE_MS = 15000;
const TD_RE = /^KXNFLTD-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)-([A-Z0-9]+)-1$/;
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const PX_COMMISSION = 0.02;
export const pxEffective = (p) => 1 / (1 + (1 / p - 1) * (1 - PX_COMMISSION));
const etDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null);

export function isTdTicker(t) { return TD_RE.test(String(t || "").toUpperCase()); }
export function tdTickerDate(t) {
  const m = TD_RE.exec(String(t || "").toUpperCase()); if (!m || !MONTHS[m[2]]) return null;
  return `20${m[1]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${m[3]}`;
}

/** levels [[price, contracts]] → fee-included VWAP for $usd (null when the book is short). */
export function vwap(levels, feeFn, usd = SNIPER_DEPTH_USD) {
  const lv = (levels || []).filter(([p, q]) => p > 0 && p < 1 && q > 0).sort((a, b) => a[0] - b[0]);
  let spent = 0, got = 0;
  for (const [p, q] of lv) {
    const c = p + feeFn(p); const take = Math.min(q, (usd - spent) / c);
    spent += take * c; got += take;
    if (spent >= usd - 1e-9) return { vwap: spent / got, top: lv[0][0] + feeFn(lv[0][0]) };
  }
  return null;
}

// player matching (port of combo-worker td-book samePlayer)
export function normName(name) {
  return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019.]/g, "").toLowerCase()
    .replace(/[^a-z\s]/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
}
const NICK = { kenny: "kenneth", ken: "kenneth", mike: "michael", chris: "christopher", matt: "matthew", josh: "joshua", nick: "nicholas", will: "william", bill: "william", rob: "robert", bob: "robert", tony: "anthony" };
export function samePlayer(a, b) {
  const na = normName(a), nb = normName(b); if (!na || !nb) return false; if (na === nb) return true;
  const pa = na.split(" "), pb = nb.split(" ");
  if (pa.length < 2 || pb.length < 2 || pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  if ((NICK[pa[0]] || pa[0]) === (NICK[pb[0]] || pb[0])) return true;
  return (pa[0].length <= 2 || pb[0].length <= 2) && pa[0][0] === pb[0][0];
}
const TEAM_ALIAS = { LA: "LAR", ARZ: "ARI", WSH: "WAS", JAC: "JAX" };
const canon = (a) => { const u = String(a || "").toUpperCase(); return TEAM_ALIAS[u] || u; };

/** Relay /td rows per venue → { [kalshiTicker]: { [venue]: { yes, no, at, feeFn } } }. names: ticker → player.
 *  A row matches only when exactly one Kalshi TD ticker has the same ET date, same player and a compatible team. */
export function indexTdRows(rowsByVenue = {}, names = {}, polledAt = Date.now()) {
  const kal = Object.entries(names).filter(([t]) => isTdTicker(t)).map(([t, n]) => {
    const m = TD_RE.exec(t); return { t, name: String(n || "").split(":")[0].replace(/\s*\([A-Z]{2,4}\)\s*TD$/, "").trim(), date: tdTickerDate(t), game: m[4], code: m[5] };
  });
  const out = {}; const stats = {};
  for (const [venue, rows] of Object.entries(rowsByVenue)) {
    const st = (stats[venue] = { matched: 0, unmatched: 0, ambiguous: 0 });
    for (const r of rows || []) {
      if (!r || !r.player) continue;
      const d = etDate(r.start); const team = canon(r.team);
      const c = kal.filter((k) => k.date === d && samePlayer(k.name, r.player) && (!team || k.code.startsWith(team) || !k.game.includes(team)));
      if (c.length !== 1) { st[c.length ? "ambiguous" : "unmatched"] += 1; continue; }
      st.matched += 1;
      const startMs = Date.parse(r.start || "") || 0; const live = r.live === true || (startMs > 0 && polledAt >= startMs);
      const coef = Number(r.fee_coefficient);
      const feeFn = venue === "polymarket" ? ((p) => (coef > 0 ? coef : 0.0695) * p * (1 - p)) : venue === "novig" && live && coef > 0 ? ((p) => coef * p * (1 - p)) : () => 0;
      const lv = (a) => (Array.isArray(a) ? a.map((x) => [Number(x.odds), Number(x.size)]) : []);
      const at = Math.min(polledAt, Math.max(Date.parse(r.confirmed_at || "") || 0, Date.parse(r.updated_at || "") || 0));
      (out[c[0].t] = out[c[0].t] || {})[venue] = { yes: lv(r.yes), no: lv(r.no), at, feeFn };
    }
  }
  Object.defineProperty(out, "stats", { value: stats, enumerable: false });
  return out;
}

function tdSource(venue, book, side, now, usd) {
  const age = now - book.at; const s = { venue, via: "td_opposite", ageMs: Math.round(age) };
  const y = vwap(book.yes, book.feeFn, usd), n = vwap(book.no, book.feeFn, usd);
  const opp = side === "no" ? y : n;
  if (opp) s.topAmerican = american(opp.top);
  if (age > STALE_MS) return { ...s, used: false, reason: "stale" };
  if (!y || !n) return { ...s, used: false, reason: "depth" };
  if (y.vwap + n.vwap - 1 > TD_MAX_OVERROUND) return { ...s, used: false, reason: "overround" };
  return { ...s, used: true, reason: "ok", cost: opp.vwap, costAmerican: american(opp.vwap) };
}
const pick = (sources) => {
  const used = sources.filter((s) => s.used && s.cost > 0 && s.cost < 1);
  if (!used.length) return null;
  const best = used.reduce((a, b) => (b.cost < a.cost ? b : a)); const p = 1 - best.cost;
  return p > 0 && p < 1 ? { p, american: american(p), best: best.venue, oppAmerican: american(best.cost), sources } : null;
};

/** → legFairFn(leg, px) for computeRootFor. tdBooks: indexTdRows(); pxRelay: relayIndex() of ProphetX quotes
 *  (passed as its "novig" slot, commission pre-folded, no fee); stored: { "TICKER:side": fair } fill-time fairs. */
export function makeSniperLegFair({ tdBooks = {}, pxRelay = {}, stored = {}, usd = SNIPER_DEPTH_USD } = {}) {
  return (leg, px = {}) => {
    const ticker = String(leg.ticker || "").toUpperCase(); const side = leg.side === "no" ? "no" : "yes";
    const now = px.now != null ? px.now : Date.now();
    let r = null;
    if (isTdTicker(ticker)) {
      const sources = [];
      const kb = (px.kalshiBooks || {})[ticker];
      if (kb) sources.push(tdSource("kalshi", { yes: kb.yes, no: kb.no, at: px.kalshiAt != null ? px.kalshiAt : now, feeFn: FEES.kalshi }, side, now, usd));
      for (const [venue, b] of Object.entries(tdBooks[ticker] || {})) sources.push(tdSource(venue, b, side, now, usd));
      r = pick(sources) || { p: null, sources };
    } else {
      const base = legFair(leg, { ...px, usd });
      const pxr = legFair(leg, { kalshiBooks: {}, relay: pxRelay, now, kalshiAt: now, usd });
      const sources = [...(base.sources || []), ...(pxr.sources || []).map((s) => ({ ...s, venue: "prophetx" }))];
      r = pick(sources) || { ...base, sources };
    }
    if (r.p == null) {
      const f = Number(stored[`${ticker}:${side}`]);
      if (f > 0 && f < 1) return { p: f, american: american(f), best: "fill-time", sources: r.sources || [], fillTime: true };
    }
    return r;
  };
}

/** ProphetX relay board quotes → novig-shaped quotes for relayIndex (price = commission-adjusted, size = contracts). */
export function prophetxAsNovig(quotes = []) {
  return (quotes || []).map((q) => {
    if (!q) return q;
    const lv = (Array.isArray(q.depth) && q.depth.length ? q.depth : [{ odds: q.odds, size: q.size }])
      .map((d) => [Number(d.odds), Number(d.size)]).filter(([o, z]) => o > 0 && o < 1 && z > 0);
    return { ...q, odds: q.odds > 0 && q.odds < 1 ? pxEffective(Number(q.odds)) : q.odds, size: undefined, depth: lv.map(([o, z]) => ({ odds: pxEffective(o), size: z / o })) };
  });
}

/** sniper_decisions 'quoted' rows → latest fill-time fair per "TICKER:side". */
export function storedLegFairs(decisions = []) {
  const out = {}; const at = {};
  for (const d of decisions || []) {
    const t = Date.parse(d.created_at || "") || 0;
    for (const l of (d.details && d.details.legDetail) || []) {
      if (!l || !l.ticker || !(Number(l.fair) > 0 && Number(l.fair) < 1)) continue;
      const k = `${String(l.ticker).toUpperCase()}:${l.side === "no" ? "no" : "yes"}`;
      if (!(k in at) || t > at[k]) { at[k] = t; out[k] = Number(l.fair); }
    }
  }
  return out;
}
