// Combo Locks Probe — UI copy + fill-vs-market compare.
// Server returns after-maker-fee Americans so they match the fill field.

export function formatAmerican(a) {
  if (a == null || !Number.isFinite(Number(a))) return "—";
  const n = Number(a);
  return n > 0 ? "+" + n : String(n);
}

export function formatNoBid(no) {
  if (no == null || !Number.isFinite(Number(no))) return "—";
  return "$" + Number(no).toFixed(2);
}

export function fillBeatsMarket(fillAmerican, bestAmerican) {
  if (fillAmerican == null || bestAmerican == null) return null;
  const fill = Number(fillAmerican);
  const best = Number(bestAmerican);
  if (!Number.isFinite(fill) || !Number.isFinite(best)) return null;
  return fill > best;
}

export function probeDisabled({ probing, legCount, contracts }) {
  return !!(probing || !(legCount >= 2) || !(Number(contracts) > 0));
}

export function formatProbeNote(result, fillAmerican) {
  if (!result) return "";
  if (!result.ok) return result.error || "Probe failed.";
  const n = result.quoteCount || 0;
  const size = result.contracts != null ? ` at ${result.contracts} contracts` : "";
  if (!n || result.bestAmerican == null) {
    return `No maker quotes in ${result.waitedMs != null ? result.waitedMs + "ms" : "the wait window"}${size}. Try again closer to game time.`;
  }
  const best = `Best market ${formatAmerican(result.bestAmerican)} (NO ${formatNoBid(result.bestNoBid)}) from ${n} quote${n === 1 ? "" : "s"}${size}.`;
  const beats = fillBeatsMarket(fillAmerican, result.bestAmerican);
  let cmp = "";
  if (beats === true) {
    cmp = ` Your fill ${formatAmerican(fillAmerican)} beats it.`;
  } else if (beats === false) {
    cmp = ` Your fill ${formatAmerican(fillAmerican)} does not beat it.`;
    if (result.suggestFillAmerican != null) {
      cmp += ` Suggested fill ${formatAmerican(result.suggestFillAmerican)} (one tick better than best NO).`;
    }
  }
  return best + cmp;
}
