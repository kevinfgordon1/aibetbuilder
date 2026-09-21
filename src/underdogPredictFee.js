// Underdog Predict / UDX exchange fee.
//
// Public UDX schedule (maker = taker) fits
//   fee per $1-face contract ≈ rate × p × (1 − p)
// with rate = 0.072:
//   10 contracts @ $0.50 → $0.18  (0.072 × 0.50 × 0.50 × 10)
//   10 contracts @ $0.20 → $0.12  (0.072 × 0.20 × 0.80 × 10 = 0.1152, tickets round)
//
// The fee is added to cost (cost + fee outlay), same shape as Kalshi/Polymarket
// taker fees: p_eff = p + rate·p·(1−p) = p·(1 + rate·(1−p)).
// Buy at implied p, pay p_eff, receive $1.
//
// Live tickets may round slightly differently (a Purdue ML print of ~6,292
// contracts at p≈0.1589 showed $56.16 vs ~$60.55 on this closed form). We
// calibrate to the published UDX examples, not a one-off slip constant.
//
// Keep in lockstep with lib/underdog-predict-fee.js.
// Legacy UDX curve stays for reference. Every Promo path uses
// UNDERDOG_PREDICT_CASH_FEE_RATE when no prediction quote is joined.
// New Odds Board stays on the gross sticker.

export const UNDERDOG_PREDICT_UDX_FEE_RATE = 0.072;

/** @deprecated Flat $0.02/contract is no longer the live formula. */
export const UNDERDOG_PREDICT_FEE_PER_CONTRACT = 0.02;

function clampUnitInterval(p) {
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function impliedPriceFromAmerican(n) {
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function americanFromImpliedPrice(p) {
  if (p <= 0 || p >= 1) return null;
  const decimalOdds = 1 / p;
  if (decimalOdds <= 1) return null;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}

function decimalToAmerican(d) {
  if (!Number.isFinite(d) || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return -Math.round(100 / (d - 1));
}

// Betstamp mains are decimal (1.12 → −833, 2.87 → +187). American is ±100+.
// Values in [20, 100) are the +8628 phantom zone (87.28 treated as decimal).
export const TYPICAL_BETSTAMP_DECIMAL_MAX = 20;

export function coerceUnderdogFeeInputToAmerican(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0 && n < 1) {
    if (n < 0.05) return null;
    return n >= 0.5 ? -Math.round((100 * n) / (1 - n)) : Math.round((100 * (1 - n)) / n);
  }
  if (n === 1) return null;
  if (n > 1 && n < TYPICAL_BETSTAMP_DECIMAL_MAX) return decimalToAmerican(n);
  if (n >= TYPICAL_BETSTAMP_DECIMAL_MAX && n < 100) return null;
  return n;
}

export function underdogPredictFeePerContract(p) {
  const x = clampUnitInterval(p);
  if (x <= 0 || x >= 1) return 0;
  return UNDERDOG_PREDICT_UDX_FEE_RATE * x * (1 - x);
}

export function applyUnderdogPredictFee(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  const n = coerceUnderdogFeeInputToAmerican(rawAmericanOdds);
  if (n == null) return Number.isFinite(Number(rawAmericanOdds)) ? null : rawAmericanOdds;
  const p = impliedPriceFromAmerican(n);
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  // Fee is added to cost — p_eff = p + rate·p·(1−p).
  const effPrice = p + underdogPredictFeePerContract(p);
  const american = americanFromImpliedPrice(effPrice);
  return american == null ? rawAmericanOdds : american;
}

// Promo phone price for free bet, cash, boost, and no-sweat. Primary quote
// is Underdog odds.prediction american (Giants +245 / 3.45, probability 27)
// joined as predictionAmerican — use it verbatim. Betstamp 196 / odds.fantasy
// stay the gross sticker (+252 / 3.52) on the row and on the Odds Board.
// Fallback when prediction is absent: invert Kalshi θ=0.07 out of the sticker,
// then r = 0.1015 → p=0.27 gives 344.82 contracts, $6.90, +245; sticker alone
// inverts to +244. Free-bet EV still uses free-bet math; the American input
// is this same phone price. Keep in lockstep with lib/underdog-predict-fee.js.

export const UNDERDOG_PREDICT_CASH_FEE_RATE = 0.1015;
export const UNDERDOG_STICKER_KALSHI_FEE_RATE = 0.07;
const UNDERDOG_PREDICT_BOOK_KEY = "underdog_predict";

export function contractProbabilityFromKalshiSticker(stickerAmerican, theta = UNDERDOG_STICKER_KALSHI_FEE_RATE) {
  const pEff = impliedPriceFromAmerican(stickerAmerican);
  const t = Number(theta);
  if (!(pEff > 0 && pEff < 1) || !(t > 0)) return null;
  const disc = (1 + t) * (1 + t) - 4 * t * pEff;
  if (disc < 0) return null;
  const p = ((1 + t) - Math.sqrt(disc)) / (2 * t);
  if (!(p > 0 && p < 1)) return null;
  return p;
}

export function underdogPredictCashQuote({ probability, stickerAmerican, stake = 100, rate = UNDERDOG_PREDICT_CASH_FEE_RATE } = {}) {
  let p = Number(probability);
  if (p > 1 && p <= 100) p = p / 100;
  if (!(p > 0 && p < 1)) {
    const sticker = coerceUnderdogFeeInputToAmerican(stickerAmerican);
    p = sticker == null ? NaN : contractProbabilityFromKalshiSticker(sticker);
  }
  if (!(p > 0 && p < 1)) return null;
  const s = Number(stake);
  const r = Number(rate);
  if (!(s > 0) || !(r >= 0)) return null;
  const effPrice = p * (1 + r * (1 - p));
  if (!(effPrice > 0 && effPrice < 1)) return null;
  const contracts = s / effPrice;
  const fee = r * contracts * p * (1 - p);
  const decimal = contracts / s;
  const american = decimalToAmerican(decimal);
  if (american == null) return null;
  return { probability: p, stake: s, rate: r, contracts, fee, decimal, american };
}

export function underdogPredictCashAmerican(raw, opts = {}) {
  if (raw === null || raw === undefined) return raw;
  const sticker = coerceUnderdogFeeInputToAmerican(raw);
  if (sticker == null) return Number.isFinite(Number(raw)) ? null : raw;
  const quote = underdogPredictCashQuote({
    probability: opts.probability,
    stickerAmerican: sticker,
    stake: opts.stake,
    rate: opts.rate,
  });
  if (!quote || quote.american == null) return sticker;
  return quote.american;
}

function predictionAmericanOrNull(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw !== 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/^\+/, "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  if (/[.]/.test(s) && Math.abs(n) < 50) return null;
  return n;
}

export function underdogCashOfferAmerican(bookKey, american, enabled, predictionAmerican) {
  if (!enabled || bookKey !== UNDERDOG_PREDICT_BOOK_KEY) return american;
  const quoted = predictionAmericanOrNull(predictionAmerican);
  if (quoted != null) return quoted;
  if (american == null) return american;
  const next = underdogPredictCashAmerican(american);
  return next == null ? american : next;
}

export function withUnderdogPrediction(leg, predictionAmerican, contractProbability) {
  const american = predictionAmericanOrNull(predictionAmerican);
  let probability = Number(contractProbability);
  if (probability > 1 && probability <= 100) probability = probability / 100;
  if (!(probability > 0 && probability < 1)) probability = null;
  if (!leg || (american == null && probability == null)) return leg;
  const next = { ...leg };
  if (american != null) next.predictionAmerican = american;
  if (probability != null) next.contractProbability = probability;
  return next;
}

export function stampUnderdogPredictionLegs(legs, data) {
  const map = new Map();
  const put = (game, name, american, probability) => {
    if (american == null && probability == null) return;
    map.set(`${game}\0${name}`, { american, probability });
  };
  const rows = data || {};
  for (const g of rows.moneylines || []) {
    const book = g && g.bookOdds && g.bookOdds[UNDERDOG_PREDICT_BOOK_KEY];
    if (!book) continue;
    const game = `${g.away} @ ${g.home}`;
    put(game, `${g.away} ML`, book.ml_away_prediction, book.ml_away_probability);
    put(game, `${g.home} ML`, book.ml_home_prediction, book.ml_home_probability);
    put(game, "Draw", book.ml_draw_prediction, book.ml_draw_probability);
  }
  for (const g of rows.run_lines || []) {
    if (!g || g.book !== UNDERDOG_PREDICT_BOOK_KEY) continue;
    const game = `${g.away} @ ${g.home}`;
    put(game, `${g.away} ${g.away_line}`, g.away_prediction, g.away_probability);
    put(game, `${g.home} ${g.home_line}`, g.home_prediction, g.home_probability);
  }
  for (const g of rows.totals || []) {
    if (!g || g.book !== UNDERDOG_PREDICT_BOOK_KEY) continue;
    const game = `${g.away} @ ${g.home}`;
    put(game, `${g.away}/${g.home} o${g.line}`, g.over_prediction, g.over_probability);
    put(game, `${g.away}/${g.home} u${g.line}`, g.under_prediction, g.under_probability);
  }
  for (const g of rows.team_totals || []) {
    if (!g || g.book !== UNDERDOG_PREDICT_BOOK_KEY) continue;
    const game = `${g.away} @ ${g.home}`;
    put(game, `${g.team} TT o${g.line}`, g.over_prediction, g.over_probability);
    put(game, `${g.team} TT u${g.line}`, g.under_prediction, g.under_probability);
  }
  if (!map.size) return legs || [];
  return (legs || []).map((leg) => {
    if (!leg || leg.bookKey !== UNDERDOG_PREDICT_BOOK_KEY) return leg;
    const hit = map.get(`${leg.game}\0${leg.name}`);
    if (!hit) return leg;
    return withUnderdogPrediction(leg, hit.american, hit.probability);
  });
}

export function applyUnderdogCashLegPrices(legs, enabled) {
  if (!enabled) return legs || [];
  return (legs || []).map((leg) => {
    if (!leg || leg.bookKey !== UNDERDOG_PREDICT_BOOK_KEY || leg.dk == null) return leg;
    const quoted = predictionAmericanOrNull(leg.predictionAmerican);
    if (quoted != null) {
      if (quoted === leg.dk) return leg;
      return { ...leg, dk: quoted };
    }
    const dk = underdogPredictCashAmerican(leg.dk, { probability: leg.contractProbability });
    if (dk == null || dk === leg.dk) return leg;
    return { ...leg, dk };
  });
}
