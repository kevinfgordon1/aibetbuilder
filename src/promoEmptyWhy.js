// Promo "No Results Found" explainer. Counts distinct games at each pool
// stage so the empty state says what actually emptied it (no lines from the
// book, X'd/hidden legs, Hide low liquidity, or too few games for N legs)
// instead of a generic "Try adjusting your filters."

function gameCount(legs) {
  const s = new Set();
  for (const l of legs || []) if (l && l.game) s.add(`${l.commence_time || ""}\0${l.game}`);
  return s.size;
}

export function promoLegStageCounts({ scoped, afterHidden, afterLiquidity }) {
  return {
    scopedLegs: (scoped || []).length,
    scopedGames: gameCount(scoped),
    hiddenRemoved: (scoped || []).length - (afterHidden || []).length,
    afterHiddenGames: gameCount(afterHidden),
    liquidityRemoved: (afterHidden || []).length - (afterLiquidity || []).length,
    afterLiquidityGames: gameCount(afterLiquidity),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Returns plain-English reasons (most specific first). Empty array = no
// specific cause found; caller keeps the generic hint.
export function promoEmptyReasons(stages, { numLegs = 1, bookLabel = "This book", hiddenCount = 0, hideLowLiquidity = false } = {}) {
  if (!stages) return [];
  const need = Math.max(1, Number(numLegs) || 1);
  const out = [];
  if (stages.scopedGames === 0) {
    out.push(`${bookLabel} has no open lines for these filters right now. Books often pull lines close to kickoff, so try a wider date or another sport.`);
    return out;
  }
  if (stages.scopedGames < need) {
    out.push(`${bookLabel} only has lines on ${plural(stages.scopedGames, "game")} for these filters, and a ${need}-leg parlay needs ${need} different games. Try fewer legs or a wider date.`);
    return out;
  }
  if (hiddenCount > 0 && stages.hiddenRemoved > 0 && stages.afterHiddenGames < need) {
    out.push(`Your ${plural(hiddenCount, "hidden leg")} leave${hiddenCount === 1 ? "s" : ""} only ${plural(stages.afterHiddenGames, "game")} to build from, and a ${need}-leg parlay needs ${need}. Restore them or pick fewer legs.`);
  }
  if (hideLowLiquidity && stages.liquidityRemoved > 0 && stages.afterLiquidityGames < need) {
    out.push(`Hide low liquidity removed ${plural(stages.liquidityRemoved, "leg")} whose other side can't be hedged for $500 profit, leaving ${plural(stages.afterLiquidityGames, "game")}. Switch Liquidity to All to see them.`);
  }
  if (!out.length && stages.afterLiquidityGames >= need) {
    out.push(`${bookLabel} has lines on ${plural(stages.afterLiquidityGames, "game")}, but no combination beats the true odds after the boost.`);
  }
  return out;
}
