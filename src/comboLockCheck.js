// Pending-lock "Check market price" card readout (api/combo-probe with lockId).
import { buyerSeesAfterFees, buyerSeesFromNoPrice, quotedYesPrice } from "./buyerOdds.js";
import { etStamp } from "./comboLockView.js";
import { targetHedge } from "./comboLockProfile.js";

export const LOCK_CHECK_SECONDS = 5;
export const LOCK_CHECK_BUSY_LABEL = `Checking… your quotes are off for ~15s`;
export const LOCK_CHECK_TITLE =
  `Pauses this lock's quotes, asks Kalshi for quotes on your own key for ${LOCK_CHECK_SECONDS} seconds, then cancels the request (never buys) and turns your quotes back on.`;

// Checkable when every leg is a Kalshi market (the Kalshi side can be built), even if the
// saved combo_ticker is Polymarket's caoc-. Only Polymarket-only locks are gated.
export const hasKalshiSide = (p) => {
  const legs = Array.isArray(p && p.legs) ? p.legs : [];
  return legs.length > 0 && legs.every((l) => /^KX[A-Z0-9]/i.test(String((l && l.ticker) || "").trim()));
};
const isPoly = (p) => !hasKalshiSide(p);

export function lockCheckAvailable(parlay, user) {
  if (!parlay || !user || parlay.user_id !== user.id) return { show: false };
  if (isPoly(parlay)) return { show: true, disabled: true, reason: "Not available for Polymarket locks yet" };
  if (parlay.active === false) return { show: false };
  return { show: true, disabled: false };
}

/** Card readout: competitor's buyer price vs ours, would we win, when checked. */
export function lockCheckView(result, parlay) {
  if (!result) return null;
  if (!result.ok) return { kind: "error", text: result.error || "Check failed" };
  const at = result.checkedAt ? etStamp(result.checkedAt) : "";
  const opts = { ticker: result.marketTicker, makerRate: result.makerRate };
  const ours = buyerSeesAfterFees(parlay && parlay.fill_american, opts);
  const ourYes = quotedYesPrice(parlay && parlay.fill_american, opts);
  if (result.bestNoBid == null) {
    return {
      kind: "none", ours, theirs: null, win: null, at,
      text: `No other sellers quoted in ${LOCK_CHECK_SECONDS}s${at ? " · checked " + at : ""}`,
    };
  }
  const theirs = buyerSeesFromNoPrice(result.bestNoBid);
  const theirYes = Math.round((1 - Number(result.bestNoBid)) * 10000) / 10000;
  // Buyer takes the cheapest YES. Equal price = tie (not a sure win).
  let win = null;
  if (ourYes != null) win = ourYes < theirYes - 1e-9 ? "win" : Math.abs(ourYes - theirYes) <= 1e-9 ? "tie" : "lose";
  const verdict = win === "win" ? "You'd win" : win === "tie" ? "Tied with the best seller" : win === "lose" ? "You'd lose" : "";
  const n = Number(result.competitorCount) || 0;
  return {
    kind: win || "unknown", ours, theirs, win, at, competitorCount: n,
    text: [verdict, `${n} other seller${n === 1 ? "" : "s"}`, at ? "checked " + at : ""].filter(Boolean).join(" · "),
  };
}

// ── Auto check after missed quotes ───────────────────────────────────────────
// Kevin: on locks that aren't getting filled, run Check market price at 10 missed quotes
// (quotes with no fill), then every 20 after (30, 50, 70…). Suggestion only.
export const AUTO_CHECK_FIRST_MISSED = 10;
export const AUTO_CHECK_EVERY_MISSED = 20;

const fmtAm = (a) => (a == null || !Number.isFinite(Number(a)) ? "—" : Number(a) > 0 ? `+${Number(a)}` : `${Number(a)}`);

/** Missed quotes = quotes posted − fills (from the yellow pill counts). */
export function missedQuotes(counts) {
  if (!counts) return 0;
  return Math.max(0, (Number(counts.quoted) || 0) - (Number(counts.fills) || 0));
}

/**
 * Should the card fire an automatic market check now?
 * First check at AUTO_CHECK_FIRST_MISSED missed quotes, then once per AUTO_CHECK_EVERY_MISSED
 * new missed quotes since the last auto check (lastMissed = missed count when the last auto
 * check ran; 0 = never checked), never while
 * a check (manual or auto) is running, never on a paused/inactive lock, and not before
 * notBeforeMs (server cooldown / backoff).
 */
export function autoCheckDue({ missed, lastMissed = 0, busy = false, paused = false, available = true, nowMs = 0, notBeforeMs = 0 } = {}) {
  if (!available || busy || paused) return false;
  if (notBeforeMs && nowMs < notBeforeMs) return false;
  const m = Number(missed) || 0;
  const last = Math.max(0, Number(lastMissed) || 0);
  if (m < AUTO_CHECK_FIRST_MISSED) return false;
  if (last === 0) return true;
  return m - last >= AUTO_CHECK_EVERY_MISSED;
}

/**
 * Smallest seller-side American price whose posted YES (on the worker's sub-cent grid, after
 * our maker fee) is strictly cheaper than the best competing YES — i.e. just enough to be top.
 * Falls back to the server's one-cent-better suggestion.
 */
export function topPriceSuggestion(result) {
  if (!result || result.bestNoBid == null) return null;
  const theirYes = 1 - Number(result.bestNoBid);
  const opts = { ticker: result.marketTicker, makerRate: result.makerRate };
  const start = Number(result.bestAmerican);
  if (Number.isFinite(theirYes) && Number.isFinite(start) && start !== 0) {
    // American odds skip (-100, 100): step over that gap.
    let a = start;
    for (let i = 0; i < 20000; i++) {
      a = a + 1;
      if (a > -100 && a < 100) a = 100;
      const y = quotedYesPrice(a, opts);
      if (y != null && y < theirYes - 1e-9) return a;
    }
  }
  const fb = result.suggestFillAmerican == null ? null : Number(result.suggestFillAmerican);
  return Number.isFinite(fb) ? fb : null;
}

/**
 * Second yellow alert: is our price the best on the market, and if not, what price would be?
 * Prices are seller-side American odds (same basis as fill_american / "Your original odds").
 * Higher fill_american = cheaper for the buyer = better quote.
 * Returns null when there's nothing to say (no result, error, nobody else quoted, or we're best).
 */
export function lockPriceAdvice(result, parlay, { feeRate = 0 } = {}) {
  if (!result || !result.ok || !parlay) return null;
  const ours = Number(parlay.fill_american);
  const best = result.bestAmerican == null ? null : Number(result.bestAmerican);
  if (!Number.isFinite(ours) || best == null || !Number.isFinite(best)) return null;
  const v = lockCheckView(result, parlay);
  if (v && v.win === "win") return { kind: "best", text: "You're the best price on the market" };
  const sug = topPriceSuggestion(result);
  const out = { kind: "behind", best, ours, suggest: null, profit: null };
  if (sug != null && Number.isFinite(sug) && sug !== 0 && sug > ours) {
    out.suggest = sug;
    const t = targetHedge({ ...parlay, fill_american: sug }, { feeRate });
    if (t) out.profit = { hit: t.hit, miss: t.miss, locks: !!t.locks };
  }
  const tied = v && v.win === "tie";
  let text = tied
    ? `Tied for the best market price — best seen ${fmtAm(best)}.`
    : `Not the best market price — best seen ${fmtAm(best)}, yours ${fmtAm(ours)}.`;
  if (out.suggest != null) {
    text += ` Try ${fmtAm(out.suggest)} to be top`;
    if (out.profit) {
      const usd = (x) => (x == null || !Number.isFinite(x) ? "—" : (x < 0 ? "-$" : "+$") + Math.abs(x).toFixed(2));
      text += ` (at target fill: ${usd(out.profit.hit)} if it hits, ${usd(out.profit.miss)} if it misses${out.profit.locks ? "" : " — no longer locks profit"})`;
    }
    text += ".";
  }
  out.text = text;
  return out;
}

/** Should a card show Check market price / price advice? Waiting locks always;
 * filled-section locks only when owned, still active, and contracts remain. */
export function lockCheckOnCard({ parlay, user, filledSection, left }) {
  if (!filledSection) return true;
  if (!parlay || !user || parlay.user_id !== user.id) return false;
  if (parlay.active === false) return false;
  return Number(left) > 0;
}

// ── Server-side auto check (combo-worker COMBO_AUTO_CHECK) ───────────────────
// When VITE_COMBO_SERVER_AUTO_CHECK=1 the worker runs the 10-then-every-20 check and saves
// auto_check_* on the lock; the card stops running its own browser check and shows the saved one.
export const serverAutoCheckOn = (env) => /^(1|true|yes|on)$/i.test(String((env && env.VITE_COMBO_SERVER_AUTO_CHECK) || ""));

/** Saved worker result → the same shape as /api/combo-probe (null when none / column missing / error). */
export function serverAutoCheckResult(parlay) {
  if (!parlay || !parlay.auto_check_at || parlay.auto_check_result === "error") return null;
  const n = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return {
    ok: true, auto: true, server: true,
    checkedAt: parlay.auto_check_at,
    bestNoBid: n(parlay.auto_check_best_no_bid),
    bestAmerican: n(parlay.auto_check_best_american),
    competitorCount: n(parlay.auto_check_competitors) || 0,
    marketTicker: parlay.combo_ticker || null,
  };
}
