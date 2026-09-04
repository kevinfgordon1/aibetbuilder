// Stake-linear helpers for Promo Builder. findTopParlays stays the existing
// enumerate-then-sort scan in App.jsx — do not change that allocation path.
// EV / boostedProfit / no-sweat cash fields scale linearly with stake for a
// fixed boost and fixed legs, so stake-only tweaks rescale a cached scan.

const STAKE_LINEAR_FIELDS = [
  "ev",
  "boostedProfit",
  "winProfit",
  "loseNet",
  "refund",
  "creditValue",
];

export function rescaleParlaysForStake(parlays, fromStake, toStake) {
  if (!parlays?.length) return parlays || [];
  const from = Number(fromStake);
  const to = Number(toStake);
  if (!isFinite(from) || from === 0 || from === to) return parlays;
  if (!isFinite(to)) {
    return parlays.map((p) => {
      const next = { ...p };
      for (const field of STAKE_LINEAR_FIELDS) {
        if (typeof p[field] === "number") next[field] = 0;
      }
      return next;
    });
  }
  const scale = to / from;
  return parlays.map((p) => {
    const next = { ...p };
    for (const field of STAKE_LINEAR_FIELDS) {
      if (typeof p[field] === "number") next[field] = p[field] * scale;
    }
    return next;
  });
}

export function rescaleFreeBetConversions(list, fromAmount, toAmount) {
  if (!list?.length) return list || [];
  const from = Number(fromAmount);
  const to = Number(toAmount);
  if (!isFinite(from) || from === 0 || from === to) return list;
  if (!isFinite(to)) {
    return list.map((x) => ({ ...x, hedgeStake: 0, guaranteedCash: 0 }));
  }
  const scale = to / from;
  return list.map((x) => ({
    ...x,
    hedgeStake: x.hedgeStake * scale,
    guaranteedCash: x.guaranteedCash * scale,
  }));
}
