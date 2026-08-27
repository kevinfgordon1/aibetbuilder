// No-sweat promo EV. Place a cash bet; if it loses the stake is refunded
// as site credit. Credit is not cash — default conversion is 70¢ on the dollar.
//
// Win:  +S × (D − 1)
// Lose: −S + V     where R = S × (refundPct/100), V = R × (conversionPct/100)
// EV = p × S × (D − 1) + (1 − p) × (−S + V)
//
// At 100% refund and 70% conversion this is p×profit − (1−p)×0.30×S.
// Fair win probability p and book decimal D are the same products already
// used for profit-boost parlays (per-leg fair/opp pricing, then combined).

export const DEFAULT_REFUND_PCT = 100;
export const DEFAULT_CREDIT_CONVERSION = 70;

export function calcNoSweatEV({
  stake,
  decimal,
  p,
  refundPct = DEFAULT_REFUND_PCT,
  conversionPct = DEFAULT_CREDIT_CONVERSION,
} = {}) {
  const S = Number(stake);
  const D = Number(decimal);
  const winProb = Number(p);
  const refund = S * (Number(refundPct) / 100);
  const creditValue = refund * (Number(conversionPct) / 100);
  const winProfit = S * (D - 1);
  const loseNet = -S + creditValue;
  const ev = winProb * winProfit + (1 - winProb) * loseNet;
  return { ev, winProfit, loseNet, refund, creditValue };
}

// 1-leg only. Equalize both sides after valuing a loss refund as credit cash V.
// H = (winProfit + S − V) / d_h
// Locked cash = winProfit − H  (= −S + V + H×(d_h − 1))
export function calcNoSweatLock({
  winProfit,
  stake,
  creditValue,
  hedgeDecimal,
} = {}) {
  const profit = Number(winProfit);
  const S = Number(stake);
  const V = Number(creditValue);
  const d_h = Number(hedgeDecimal);
  if (!isFinite(d_h) || d_h <= 1 || !isFinite(profit) || !isFinite(S) || !isFinite(V)) {
    return { valid: false, hedgeStake: 0, lockedProfit: 0, d_h: 0 };
  }
  const hedgeStake = (profit + S - V) / d_h;
  const lockedProfit = profit - hedgeStake;
  return { valid: lockedProfit > 0 && hedgeStake > 0, hedgeStake, lockedProfit, d_h };
}
