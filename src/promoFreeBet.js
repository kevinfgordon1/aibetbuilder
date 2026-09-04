// Free-bet promo EV. A free bet does not risk cash: loss = $0.
// Win profit = (D − 1) × FB  (the stake is not returned).
// EV = p × winProfit.
//
// Fair win probability p and book decimal D are the same products already
// used for profit-boost parlays (per-leg fair/opp pricing, then combined).
// Ranking by EV is equivalent to ranking by p×(D−1) for a fixed free-bet $.

function trueProb(bestOpponentOdds) {
  if (!bestOpponentOdds) return 0.5;
  if (bestOpponentOdds < 0) return Math.abs(bestOpponentOdds) / (Math.abs(bestOpponentOdds) + 100);
  return 100 / (bestOpponentOdds + 100);
}

function ourTrueProb(bestOpponentOdds) { return 1 - trueProb(bestOpponentOdds); }

function dkDecimal(odds) {
  if (!odds) return 1;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

function decimalToAmerican(dec) {
  if (!isFinite(dec) || dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

export function calcFreeBetParlayEV(legs, freeBetAmount) {
  let parlayDec = 1;
  let combinedProb = 1;
  (legs || []).forEach((l) => {
    parlayDec *= dkDecimal(l.dk);
    combinedProb *= ourTrueProb(l.bestOpp);
  });
  const winProfit = (parlayDec - 1) * freeBetAmount;
  const ev = combinedProb * winProfit;
  return { parlayDec, combinedProb, winProfit, ev, parlayOdds: decimalToAmerican(parlayDec) };
}

// 1-leg only. Hedge the opposite side so both outcomes return the same cash.
// Multi-leg free bets have 2^n outcomes and cannot be locked on both sides.
export function calcFreeBetConversion(fbOddsAmerican, hedgeOddsAmerican, freeBetAmount) {
  if (!fbOddsAmerican || !hedgeOddsAmerican || !freeBetAmount) {
    return { hedgeStake: 0, guaranteedCash: 0, conversionRate: 0, valid: false };
  }
  const d_fb = dkDecimal(fbOddsAmerican);
  const d_h = dkDecimal(hedgeOddsAmerican);
  if (d_fb <= 1 || d_h <= 1) {
    return { hedgeStake: 0, guaranteedCash: 0, conversionRate: 0, valid: false };
  }
  const hedgeStake = (d_fb - 1) * freeBetAmount / d_h;
  const guaranteedCash = hedgeStake * (d_h - 1);
  const conversionRate = guaranteedCash / freeBetAmount;
  return { hedgeStake, guaranteedCash, conversionRate, valid: true, d_fb, d_h };
}

export function attachFreeBetLock(parlay, freeBetAmount) {
  if (!parlay?.legs || parlay.legs.length !== 1) {
    return { ...parlay, lock: null, isGuaranteed: false };
  }
  const lock = calcFreeBetConversion(parlay.legs[0].dk, parlay.legs[0].bestOpp, freeBetAmount);
  return { ...parlay, lock, isGuaranteed: !!lock.valid };
}
