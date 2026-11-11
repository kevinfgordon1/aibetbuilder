// Polymarket US combo (parlay) maker fee. Same schedule as combo-worker/poly-combo-fee.js.
// docs.polymarket.us/fees → Combo Trading → Maker Fees.
//
//   Fee = 0.03 × C × p × (1 − p)
//
// Effective Saturday Nov 14, 2026 12:00 AM America/New_York = 2026-11-14T05:00:00Z
// (EST, UTC−5). Fills before that instant pay $0. Single-market maker fees stay $0.
// Fees round to the nearest cent with banker's rounding (half to even).
// Example: 100 contracts at $0.10 = $0.27.

export const POLY_COMBO_MAKER_RATE = 0.03;
export const POLY_COMBO_MAKER_FEE_EFFECTIVE_AT = Date.parse("2026-11-14T05:00:00Z");

export function atMs(at) {
  if (at == null || at === "") return Date.now();
  if (at instanceof Date) return at.getTime();
  if (typeof at === "number") return at;
  const t = Date.parse(String(at));
  return Number.isFinite(t) ? t : NaN;
}

export function polyComboMakerRate(at) {
  const t = atMs(at);
  if (!Number.isFinite(t)) return POLY_COMBO_MAKER_RATE;
  return t >= POLY_COMBO_MAKER_FEE_EFFECTIVE_AT ? POLY_COMBO_MAKER_RATE : 0;
}

export function roundHalfEvenCents(x) {
  const c = x * 100;
  const f = Math.floor(c);
  const d = c - f;
  if (Math.abs(d - 0.5) < 1e-9) return (f % 2 === 0 ? f : f + 1) / 100;
  return Math.round(c) / 100;
}

export function polyComboMakerFeeDollars(contracts, price, at) {
  const rate = polyComboMakerRate(at);
  if (!(rate > 0)) return 0;
  const C = Number(contracts);
  const p = Number(price);
  if (!(C > 0) || !(p > 0 && p < 1)) return 0;
  return roundHalfEvenCents(rate * C * p * (1 - p));
}

export function polyComboPriceForNet(net, rate) {
  const s = Number(net);
  const k = Number(rate);
  if (!(s > 0 && s < 1)) return null;
  if (!(k > 0)) return s;
  const b = 1 - k;
  const disc = b * b + 4 * k * s;
  if (!(disc >= 0)) return null;
  const p = (-b + Math.sqrt(disc)) / (2 * k);
  return p > 0 && p < 1 ? p : null;
}

const COMBO_SLUG = /^(caoc|crossd)-/i;

export function isPolyComboSlug(ticker) {
  return COMBO_SLUG.test(String(ticker || "").trim());
}

// History rows: charge only a Polymarket combo maker fill. Single-market rows stay $0.
export function isPolyComboMakerFill(fill) {
  if (!fill || fill.is_taker === true) return false;
  const ticker = String(fill.ticker || fill.market_ticker || (fill.raw && fill.raw.market_ticker) || "");
  if (isPolyComboSlug(ticker)) return true;
  const venue = String(fill.venue || (fill.raw && fill.raw.venue) || "").toLowerCase();
  if (!venue.includes("poly")) return false;
  return fill.is_combo === true;
}

export function polyComboFillTime(fill) {
  if (!fill) return null;
  return fill.kalshi_created_time || fill.created_at || fill.recorded_at || fill.tradeTime || null;
}
