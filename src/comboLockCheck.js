// Pending-lock "Check market price" card readout (api/combo-probe with lockId).
import { buyerSeesAfterFees, buyerSeesFromNoPrice, quotedYesPrice } from "./buyerOdds.js";
import { etStamp } from "./comboLockView.js";

export const LOCK_CHECK_SECONDS = 10;
export const LOCK_CHECK_BUSY_LABEL = `Checking… your quotes are off for ~25s`;
export const LOCK_CHECK_TITLE =
  `Pauses this lock's quotes, asks Kalshi for quotes on your own key for ${LOCK_CHECK_SECONDS} seconds, then cancels the request (never buys) and turns your quotes back on.`;

const isPoly = (p) => /^caoc-/i.test(String((p && p.combo_ticker) || "")) || String((p && p.venue) || "").toLowerCase().includes("poly");

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
  const opts = { ticker: result.marketTicker || (parlay && parlay.combo_ticker), makerRate: result.makerRate };
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
