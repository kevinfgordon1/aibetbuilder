// Market depth = potential PROFIT, not stake (Kevin's rule).
// $3,000 bettable at −200 is $1,500 of depth; $1,000 at +150 is $1,500.
// Venue sizes in this app are $ stake at that American price.
export function profitAtAmerican(stake, american) {
  const a = Number(american), s = Number(stake);
  if (!isFinite(a) || a === 0 || !(s > 0)) return 0;
  return a < 0 ? (s * 100) / Math.abs(a) : (s * a) / 100;
}

// Display helper: stake size → depth $ when the price is known, else null (never invent depth).
export function depthFromStake(stake, american) {
  const s = Number(stake);
  if (!(s > 0)) return null;
  const a = Number(american);
  if (!isFinite(a) || a === 0) return null;
  return profitAtAmerican(s, a);
}
