// Combo Locks fill-odds math. The American you type is the price you SELL at
// AFTER Kalshi combo maker fees — already baked in. Lock / hedge math uses
// that number directly. These helpers only recover the nominal exchange price
// (and the taker's matched odds) so the posted no_bid is after-fee net.
//
// Official Kalshi fee schedule (July 7, 2026) + API fee_type
// `quadratic_with_combo_maker_fees`: combo maker multiplier is 0.5, so
//   combo maker fee = 0.035 × C × P × (1−P)
//   taker fee       = 0.07  × C × P × (1−P)   (2× maker, not 4×)
// Uncorrelated NFL-only combos are maker 0. MLB / multi-sport locks use this curve.
//
// Standard non-combo maker is 0.0175 (¼ of taker). Do not use that here.

export const COMBO_MAKER_FEE = 0.035;
export const TAKER_FEE = 0.07;

export const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
export const americanFromProb = (p) => (!(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p)));

// Floor to cents so we never quote a no_bid worse than the fill target (user buys NO).
// Kalshi REST is FixedPointDollars (two decimals). Never round the NO bid up.
export const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

// sEff = sNom − kFee·sNom·(1−sNom)  →  kFee·sNom² + (1−kFee)·sNom − sEff = 0
export function nominalProbFromEff(sEff, kFee = COMBO_MAKER_FEE) {
  const b = 1 - kFee;
  return (-b + Math.sqrt(b * b + 4 * kFee * sEff)) / (2 * kFee);
}

export function afterFeeYes(sNom, kFee = COMBO_MAKER_FEE) {
  return sNom - kFee * sNom * (1 - sNom);
}

// Your fill is net of combo maker fee. effTaker = odds the taker is matched at (nominal + their 7%).
export function fillView(fillAfterFeeAmerican) {
  const sEff = impliedProb(fillAfterFeeAmerican);
  const sNom = nominalProbFromEff(sEff);
  const takerProb = sNom + TAKER_FEE * sNom * (1 - sNom);
  return { sEff, sNom, effTaker: americanFromProb(takerProb), noBid: floor2(1 - sNom).toFixed(2) };
}
