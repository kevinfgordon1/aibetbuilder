// Combo Locks Probe — UI copy + fill-vs-market compare.
// Server returns after-maker-fee Americans so they match the fill field.
import { buyerSeesAfterFees, buyerSeesFromNoPrice } from "./buyerOdds.js";

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


/** CONNECT_KALSHI copy — keep in sync with api CONNECT_KALSHI_ERROR. */
export const CONNECT_KALSHI_LABEL = "Connect Kalshi to check price";

/**
 * Who sees the Check market price control, and what it says.
 * Owner: always ready (server key). Tester: needs a connected Kalshi key.
 */
export function probeUiState({
  canSeeCombo,
  isOwner,
  kalshiConnected,
  probing,
  legCount,
  contracts,
} = {}) {
  if (!canSeeCombo) return { show: false, kind: "hidden", disabled: true, label: "" };
  if (isOwner) {
    const disabled = probeDisabled({ probing, legCount, contracts });
    return {
      show: true,
      kind: "ready",
      disabled,
      label: probing ? "Checking…" : "Check market price",
    };
  }
  if (!kalshiConnected) {
    return {
      show: true,
      kind: "need-key",
      disabled: true,
      label: CONNECT_KALSHI_LABEL,
    };
  }
  const disabled = probeDisabled({ probing, legCount, contracts });
  return {
    show: true,
    kind: "ready",
    disabled,
    label: probing ? "Checking…" : "Check market price",
  };
}

// ── Check market price on a pending lock card ──

function etTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
}

/**
 * Card view of a lock probe: our buyer price vs the best competing buyer price
 * (both after the buyer's fee), whether we'd win, and when it was checked.
 */
export function lockProbeView(result, { fillAmerican, ticker } = {}) {
  if (!result) return null;
  if (!result.ok) {
    return { kind: result.notAvailable ? "na" : result.needKalshiKey ? "need-key" : "error", text: result.error || "Couldn't check the market price. Try again." };
  }
  const ours = buyerSeesAfterFees(fillAmerican != null ? fillAmerican : result.fillAmerican, { ticker: ticker || result.marketTicker });
  const theirs = result.bestNoBid != null ? buyerSeesFromNoPrice(result.bestNoBid) : null;
  const checked = etTime(result.checkedAt);
  const n = Number(result.usableQuoteCount) || 0;
  const base = {
    ours: ours ? ours.american : null,
    oursText: ours ? `Buyer sees ${ours.text} after fees` : "",
    theirs: theirs ? theirs.american : null,
    theirsText: theirs ? `Buyer sees ${theirs.text} after fees` : "",
    checkedText: checked ? `Checked ${checked}` : "",
    quotes: n,
  };
  if (result.listError && !n) return { ...base, kind: "error", verdict: null, text: "Couldn't read the market's quotes. Try again in a minute." };
  if (!theirs) return { ...base, kind: "win", verdict: "alone", text: "No other seller quoted it, so your quote would be the only one." };
  if (base.ours == null) return { ...base, kind: "warn", verdict: null, text: "Best competing quote shown; your own price couldn't be computed." };
  if (base.ours > base.theirs) return { ...base, kind: "win", verdict: "win", text: `You'd win: your price beats the best other seller (${n} quote${n === 1 ? "" : "s"}).` };
  if (base.ours === base.theirs) return { ...base, kind: "warn", verdict: "tie", text: "Tied with the best other seller. Raise your odds a little to win." };
  return { ...base, kind: "lose", verdict: "lose", text: `You'd lose: another seller is offering the buyer a better price (${n} quote${n === 1 ? "" : "s"}). Raise your odds to win.` };
}
