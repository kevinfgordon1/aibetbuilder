// Combo Locks Probe — UI copy + fill-vs-market compare.
// Server returns after-maker-fee Americans so they match the fill field.

export function formatAmerican(a) {
  if (a == null || !Number.isFinite(Number(a))) return "—";
  const n = Number(a);
  return n > 0 ? "+" + n : String(n);
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

function count(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : null;
}

function sizeBit(result) {
  const c = count(result.contracts);
  return c ? `${c} contracts` : "";
}

function waitBit(result) {
  const ms = Number(result.waitedMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const sec = ms / 1000;
  return ` in ${sec < 10 ? Math.round(sec * 10) / 10 : Math.round(sec)} seconds`;
}

/**
 * "Check market price" result in plain words: American odds only, no NO
 * cents, no request ids.
 */
export function formatProbeNote(result, fillAmerican) {
  if (!result) return "";
  if (!result.ok) return result.error || "Couldn't check the market price. Try again.";
  const n = Number(result.quoteCount) || 0;
  const size = sizeBit(result);
  const sizeParen = size ? ` (${size})` : "";
  if (result.listError && !n) {
    return `Couldn't read the market's quotes${sizeParen}. Try again in a minute.`;
  }
  if (!n) {
    return `No trader quoted this parlay${waitBit(result)}${sizeParen}. Try again closer to game time.`;
  }
  if (result.bestAmerican == null) {
    return `${n} trader${n === 1 ? "" : "s"} answered but none with a usable price${sizeParen}. Try again closer to game time.`;
  }
  const bits = [`${n} quote${n === 1 ? "" : "s"}`];
  if (size) bits.push(size);
  let out = `Best price traders are paying right now: ${formatAmerican(result.bestAmerican)} (${bits.join(", ")}).`;
  const beats = fillBeatsMarket(fillAmerican, result.bestAmerican);
  if (beats === true) {
    out += ` Your ${formatAmerican(fillAmerican)} beats it, so it should get taken.`;
  } else if (beats === false) {
    out += ` Your ${formatAmerican(fillAmerican)} doesn't beat it.`;
    if (result.suggestFillAmerican != null) out += ` Try ${formatAmerican(result.suggestFillAmerican)} or better.`;
  }
  return out;
}
