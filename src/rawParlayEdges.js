// Raw parlay edges (owner-only scanner, PREVIEW — read-only, never quotes or trades).
//
// Source rows: combo-worker noboost paper log (public.noboost_paper_rfqs). For every
// Kalshi KXMVE parlay RFQ the worker records:
//   fair_mid_american  — combo fair = Π per-leg no-vig mid of the Kalshi + Polymarket
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
//   y_offer   = YES we quote so that y + 0.07·y·(1−y) = prob(offer), floored to 0.0001
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
export function legLabel(raw) {
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

/** Score one noboost_paper_rfqs row. Returns null when it cannot be priced. */
export function scoreRawEdge(row, { edgeAmerican = DEFAULT_EDGE_AMERICAN, makerRate = 0, takerRate = KALSHI_TAKER_RATE } = {}) {
  if (!row || row.outcome !== "traded") return null;
  const P = probFromAmerican(row.fair_mid_american);
  const yT = Number(row.traded_yes);
  if (P == null || !(yT > 0 && yT < 1)) return null;
  const traderAllIn = takerAllIn(yT, takerRate);
  const offerAmTarget = americanMinus(row.fair_mid_american, edgeAmerican);
  const q = probFromAmerican(offerAmTarget);
  if (q == null) return null;
  const yRaw = yesForAllIn(q, takerRate);
  if (yRaw == null) return null;
  const y = floorTick(yRaw);
  if (!(y > 0)) return null;
  const keep = y - makerRate * y * (1 - y);
  const evPer = keep - P;
  const lossPer = 1 - keep;
  const contracts = Number(row.traded_contracts) > 0 ? Number(row.traded_contracts) : Number(row.contracts) || 0;
  const beats = y < yT; // strictly better price for the trader than the best they paid
  return {
    rfq_id: row.rfq_id,
    ts: row.rfq_created_ts || row.created_at,
    day: etDayKey(row.rfq_created_ts || row.created_at),
    ticker: row.market_ticker,
    legs: (Array.isArray(row.legs) ? row.legs : []).map(legLabel),
    nLegs: row.n_legs || (Array.isArray(row.legs) ? row.legs.length : null),
    fairAmerican: Number(row.fair_mid_american),
    bestTraderAmerican: americanFromProb(traderAllIn),
    offerAmerican: americanFromProb(takerAllIn(y, takerRate)),
    offerYes: Math.round(y * 10000) / 10000,
    makerRate,
    contracts,
    requestedCost: row.rfq_target_cost != null ? Number(row.rfq_target_cost) : null,
    evPer100: lossPer > 0 ? (100 * evPer) / lossPer : null,
    ev: contracts * evPer,
    maxLoss: contracts * lossPer,
    flagged: beats && evPer > 0,
  };
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
    const d = m.get(k) || { day: k, count: 0, ev: 0, maxLoss: 0 };
    d.count += 1; d.ev += e.ev; d.maxLoss += e.maxLoss;
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
