// Raw parlay edges (owner-only scanner, PREVIEW — read-only, never quotes or trades).
//
// Source rows: combo-worker noboost paper log (public.noboost_paper_rfqs). For every
// Kalshi KXMVE parlay RFQ the worker records:
//   fair_mid_american  — combo fair = Π per-leg no-vig mid of the KALSHI (only) NFL game
//                        moneyline books (own-side vs opposite-side mid, devigged),
//                        legs in different games, priced from a <15s-fresh book.
//   traded_yes         — the YES price the trader actually got from the best maker
//                        (public taker print matched to the RFQ), i.e. the best price
//                        traders were paying. Before the trader's taker fee.
//
// Math (American odds only in the UI):
//   P         = implied prob of fair_mid_american
//   trader    = traded_yes + 0.07·y·(1−y)   (Kalshi taker fee, per contract)  → best trader price
//   offer     = fair − X  (X in American odds, continuous across ±100)        → what the trader would pay all-in
//   y_offer   = YES we quote so that y + 0.07·y·(1−y) = prob(offer), floored to Kalshi's grid
//               (0.001 between 1¢ and 99¢ on KXMVE), then exact order rounding — see scoreRawEdge
//   we keep   = y_offer − k·y_offer·(1−y_offer)   k = Kalshi maker rate for the series (GET /series)
//   EV/contract = keep − P ; max loss/contract = 1 − keep
// A row is flagged only when the offer is strictly better for the trader than the best
// price they paid (y_offer < traded_yes) and EV > 0 after fees.
export const KALSHI_TAKER_RATE = 0.07;
export const DEFAULT_EDGE_AMERICAN = 500;
export const YES_TICK = 0.0001;

export const probFromAmerican = (a) => {
  const n = Number(a);
  if (!Number.isFinite(n) || (n > -100 && n < 100)) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
};
export const americanFromProb = (p) =>
  !(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p));
export const fmtAmerican = (a) => (a == null || !Number.isFinite(Number(a)) ? "—" : a > 0 ? `+${Math.round(a)}` : `${Math.round(a)}`);

/** fair − X in American odds, continuous through the ±100 gap (+150 − 100 → −150... via +100 ≡ −100). */
export function americanMinus(fair, x) {
  const a = Number(fair), d = Number(x);
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  const line = a > 0 ? a - 100 : a + 100;
  const l2 = line - d;
  return l2 >= 0 ? l2 + 100 : l2 - 100;
}

export const takerAllIn = (y, rate = KALSHI_TAKER_RATE) => y + rate * y * (1 - y);
/** Inverse of takerAllIn: YES y with y + r·y(1−y) = q. */
export function yesForAllIn(q, rate = KALSHI_TAKER_RATE) {
  if (!(q > 0 && q < 1)) return null;
  if (!rate) return q;
  const b = 1 + rate;
  const disc = b * b - 4 * rate * q;
  if (disc < 0) return null;
  return (b - Math.sqrt(disc)) / (2 * rate);
}
const floorTick = (y, t = YES_TICK) => Math.floor(y / t + 1e-9) * t;

/** "KXNFLGAME-26OCT25TBCAR-TB:yes" → { team:"TB", matchup:"TB @ CAR", date:"Oct 25", side:"yes" } */
const MONTHS = { JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun", JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec" };
const LEAGUES = { KXNFLGAME: "NFL", KXNCAAFGAME: "NCAAF", KXMLBGAME: "MLB", KXNHLGAME: "NHL", KXNBAGAME: "NBA" };
export function parseLeg(raw) {
  const s = String(raw || "");
  const [ticker, sideRaw] = s.split(":");
  const parts = (ticker || "").split("-");
  const out = { raw: s, side: (sideRaw || "yes").toLowerCase(), league: LEAGUES[parts[0]] || null, team: parts[2] || null, matchup: null, date: null };
  const m = /^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/.exec(parts[1] || "");
  if (m) {
    out.date = `${MONTHS[m[2]] || m[2]} ${Number(m[3])}`;
    const pair = m[4], t = out.team || "";
    if (t && pair.startsWith(t)) out.matchup = `${t} @ ${pair.slice(t.length)}`;
    else if (t && pair.endsWith(t)) out.matchup = `${pair.slice(0, pair.length - t.length)} @ ${t}`;
    else out.matchup = pair;
  }
  return out;
}
/** "KXNFLTD-26OCT18PITTB-PITKWETJEN10-1:yes" → { player:"K. Wetjen", team:"PIT", matchup:"PIT @ TB", date:"Oct 18", side } */
const TD_RE = /^KXNFLTD-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)-([A-Z0-9]+)-1$/;
export const isTdLeg = (raw) => TD_RE.test(String(raw || "").split(":")[0]);
export function parseTdLeg(raw) {
  const [ticker, sideRaw] = String(raw || "").split(":");
  const m = TD_RE.exec(ticker || "");
  if (!m) return null;
  const pair = m[4], code = m[5];
  let team = null, matchup = pair;
  for (const n of [3, 2, 4]) {
    const t = code.slice(0, n);
    if (pair.startsWith(t) && pair.length > n) { team = t; matchup = `${t} @ ${pair.slice(n)}`; break; }
    if (pair.endsWith(t) && pair.length > n) { team = t; matchup = `${pair.slice(0, pair.length - n)} @ ${t}`; break; }
  }
  const name = (team ? code.slice(team.length) : code).replace(/\d+$/, "");
  const player = name.length > 1 ? `${name[0]}. ${name[1]}${name.slice(2).toLowerCase()}` : name;
  return { player, team, matchup, date: `${MONTHS[m[2]] || m[2]} ${Number(m[3])}`, side: (sideRaw || "yes").toLowerCase() };
}
export function legLabel(raw) {
  const td = parseTdLeg(raw);
  if (td) {
    const pick = td.side === "no" ? `TD · ${td.player} NO anytime TD` : `TD · ${td.player} anytime TD`;
    return [pick, `(${[td.team, td.matchup].filter(Boolean).join(", ")})`, td.date].join(" ");
  }
  const l = parseLeg(raw);
  if (!l.team) return l.raw;
  const pick = l.side === "no" ? `${l.team} NOT to win` : `${l.team} ML`;
  return [pick, l.matchup && `(${l.matchup})`, l.date].filter(Boolean).join(" ");
}

export function etDayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function etTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) + " ET";
}

// ── Exact Kalshi order math (fee schedule 7.7.26 + docs.kalshi.com/getting_started/fee_rounding) ──
// fee = round up(M × rate × C × P × (1−P)), per ORDER (C = all contracts, fractional allowed; the
// fee accumulator makes split fills converge to one equivalent fill). Trade fee is ceil'd to
// $0.000001, then the balance change is floored to the member's precision: $0.01 for non-direct
// (retail / FCM) members — the default here — or $0.0001 for direct members.
// Price grid for KXMVE combos ("center_deci_edge_centi_cent"): $0.0001 below 1¢ and above 99¢,
// $0.001 in between. All money math is BigInt micro-dollars, so no float drift.
export const PRECISION_MICROS = Object.freeze({ cent: 10000n, centicent: 100n });
export function tickFor(y, structure = "center_deci_edge_centi_cent") {
  if (structure === "linear_cent") return 0.01;
  if (structure === "deci_cent") return 0.001;
  return y < 0.01 || y > 0.99 ? 0.0001 : 0.001;
}
/** Largest price on Kalshi's grid ≤ y. */
export function floorToTick(y, structure) {
  const t = tickFor(y, structure);
  return Math.round(Math.floor(y / t + 1e-9) * t * 10000) / 10000;
}
/** Next lower grid price. */
export function tickBelow(y, structure) {
  const t = tickFor(y - 1e-9, structure);
  return Math.round((y - t) * 10000) / 10000;
}
const ceilDiv = (n, d) => (n <= 0n ? -((-n) / d) : (n + d - 1n) / d);
const bpOf = (y) => BigInt(Math.round(Number(y) * 10000)); // price in 1/10000 $
const cMicroOf = (c) => BigInt(Math.round(Number(c) * 100)); // contracts in 1/100
const RATE_SCALE = 1000000n;
const rateOf = (r) => BigInt(Math.round(Number(r || 0) * 1e6));
/** ceil_6dp(rate·C·P·(1−P)) in micro-dollars. */
export function feeMicros(contracts, y, rate) {
  const c = cMicroOf(contracts), p = bpOf(y), r = rateOf(rate);
  if (r === 0n || c <= 0n) return 0n;
  // rate·(c/100)·(p/1e4)·(1−p/1e4) $ = r·c·p·(1e4−p) / (1e6·100·1e8) $ → ×1e6 for micros
  return ceilDiv(r * c * p * (10000n - p), RATE_SCALE * 100n * 100000000n / 1000000n);
}
/** What a buyer of C contracts at price y actually pays (whole order, $), fee + rounding included. */
export function buyCostMicros(contracts, y, rate, precision = "cent") {
  const prec = PRECISION_MICROS[precision] || PRECISION_MICROS.cent;
  const raw = cMicroOf(contracts) * bpOf(y) + feeMicros(contracts, y, rate);
  return ceilDiv(raw, prec) * prec;
}
const dollars = (m) => Number(m) / 1e6;

/** Score one noboost_paper_rfqs row. Returns null when it cannot be priced.
 *  We are the maker SELLING YES at y (= buying NO at 1−y); the trader takes YES at y and pays the
 *  taker fee on top. Every $ figure is the exact rounded Kalshi order amount. */
export function scoreRawEdge(row, { edgeAmerican = DEFAULT_EDGE_AMERICAN, makerRate = 0, takerRate = KALSHI_TAKER_RATE, precision = "cent", priceStructure } = {}) {
  if (!row || row.outcome !== "traded") return null;
  const P = probFromAmerican(row.fair_mid_american);
  const yT = Number(row.traded_yes);
  if (P == null || !(yT > 0 && yT < 1)) return null;
  const contracts = Number(row.traded_contracts) > 0 ? Number(row.traded_contracts) : Number(row.contracts) || 0;
  if (!(contracts > 0)) return null;
  const C = Math.round(contracts * 100) / 100;
  const takerPays = (y) => dollars(buyCostMicros(C, y, takerRate, precision));
  const q = probFromAmerican(americanMinus(row.fair_mid_american, edgeAmerican)); // taker all-in target
  if (q == null) return null;
  const yRaw = yesForAllIn(q, takerRate);
  if (yRaw == null) return null;
  let y = floorToTick(yRaw, priceStructure);
  // after Kalshi's round-up the taker must still get at least fair−X
  while (y > 0 && takerPays(y) / C > q + 1e-12) y = tickBelow(y, priceStructure);
  if (!(y > 0)) return null;
  const takerGotCost = takerPays(yT);
  const takerGetsCost = takerPays(y);
  // our side: buy NO at 1−y, maker fee (series rate) on the same C·P·(1−P) base
  const ourCost = dollars(buyCostMicros(C, 1 - y, makerRate, precision)); // = max loss
  const keep = Math.round((C - ourCost) * 1e6) / 1e6; // what we actually receive for the YES we sell
  const makerFee = dollars(feeMicros(C, y, makerRate));
  const ev = (1 - P) * C - ourCost; // EV from the exact rounded amount we put up
  return {
    rfq_id: row.rfq_id,
    ts: row.rfq_created_ts || row.created_at,
    day: etDayKey(row.rfq_created_ts || row.created_at),
    ticker: row.market_ticker,
    legs: (Array.isArray(row.legs) ? row.legs : []).map(legLabel),
    legsRaw: Array.isArray(row.legs) ? row.legs : [],
    handle: takerGetsCost, // taker's all-in stake we'd accept
    legIsTd: (Array.isArray(row.legs) ? row.legs : []).map(isTdLeg),
    market: marketOf(row.legs),
    nLegs: row.n_legs || (Array.isArray(row.legs) ? row.legs.length : null),
    fairAmerican: Number(row.fair_mid_american),
    winningMmAmerican: americanFromProb(yT), // maker's quote, before the taker's fee
    winningMmYes: yT,
    takerGotAmerican: americanFromProb(takerGotCost / C), // what the trader actually paid all-in
    takerGotCost,
    weSellAmerican: americanFromProb(keep / C), // what we receive, after our (series) maker fee
    weSellYes: y,
    takerGetsAmerican: americanFromProb(takerGetsCost / C),
    takerGetsCost,
    makerFee,
    weReceive: keep,
    // back-compat names
    bestTraderAmerican: americanFromProb(takerGotCost / C),
    offerAmerican: americanFromProb(takerGetsCost / C),
    offerYes: y,
    makerRate,
    contracts: C,
    requestedCost: row.rfq_target_cost != null ? Number(row.rfq_target_cost) : null,
    evPer100: ourCost > 0 ? (100 * ev) / ourCost : null,
    ev,
    maxLoss: ourCost,
    flagged: takerGetsCost < takerGotCost && y < yT && ev > 0,
  };
}

/** Market filter for Combo Sniper: "td" when any leg is an NFL anytime-TD prop, else "ml". */
export const MARKETS = Object.freeze({ all: "all", ml: "ml", td: "td" });
export function marketOf(legs) {
  return (Array.isArray(legs) ? legs : []).some(isTdLeg) ? MARKETS.td : MARKETS.ml;
}
export function matchesMarket(edge, market = MARKETS.all) {
  if (!market || market === MARKETS.all) return true;
  return (edge && edge.market) === market;
}

export function scanRawEdges(rows, opts = {}) {
  const scored = [];
  for (const r of rows || []) {
    const s = scoreRawEdge(r, opts);
    if (s && s.flagged) scored.push(s);
  }
  return scored;
}

export function summarizeByDay(edges) {
  const m = new Map();
  for (const e of edges || []) {
    const k = e.day || "unknown";
    const d = m.get(k) || { day: k, count: 0, ev: 0, maxLoss: 0, handle: 0 };
    d.count += 1; d.ev += e.ev; d.maxLoss += e.maxLoss; d.handle += Number(e.handle) || 0;
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Client-side rank sorts for Combo Sniper. Keys: margin | ev | size. Always descending. */
export const SORT_KEYS = Object.freeze({ margin: "margin", ev: "ev", size: "size" });
export const DEFAULT_SORT = SORT_KEYS.margin;
const sizeOf = (e) => {
  const c = Number(e && e.contracts);
  if (Number.isFinite(c) && c > 0) return c;
  const r = Number(e && e.requestedCost);
  return Number.isFinite(r) ? r : 0;
};
const metric = (e, key) => {
  if (key === SORT_KEYS.ev) return Number(e && e.ev) || 0;
  if (key === SORT_KEYS.size) return sizeOf(e);
  return Number(e && e.evPer100) || 0; // margin default
};
export function sortRawEdges(edges, key = DEFAULT_SORT) {
  const k = SORT_KEYS[key] || DEFAULT_SORT;
  return [...(edges || [])].sort((a, b) => {
    const d = metric(b, k) - metric(a, k);
    if (d !== 0) return d;
    // stable-ish tie-break: higher EV, then newer ts
    const ev = (Number(b.ev) || 0) - (Number(a.ev) || 0);
    if (ev !== 0) return ev;
    return String(b.ts || "").localeCompare(String(a.ts || ""));
  });
}

/** Positions for parlayRisk from scored edges. */
export const toRiskPositions = (edges) => (edges || []).map((e) => ({ legs: e.legsRaw || [], contracts: e.contracts, keep: e.weReceive, handle: e.handle, ev: e.ev }));
