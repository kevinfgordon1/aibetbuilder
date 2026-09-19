// One-off in-app alerts for a single signed-in email. Not What’s New —
// do not publish these as whats_new_announcements rows (that blasts everyone).
// Dismiss persists on the same profile prefs / localStorage + user_metadata
// path as What’s New, under a separate seenTargetedAlertId key.

import { KENNETH_GUIDO_EMAIL, tabHash } from "./comboAccess.js";

export { KENNETH_GUIDO_EMAIL };

export const KENNETH_ODDS_BOARD_ALERT_ID = "kenneth-new-odds-board";

export function normalizeEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

export function emailsMatch(a, b) {
  const left = normalizeEmail(a);
  const right = normalizeEmail(b);
  return Boolean(left) && left === right;
}

export function userEmail(user) {
  if (!user || typeof user !== "object") return "";
  const meta = user.user_metadata || {};
  return normalizeEmail(user.email || meta.email || "");
}

export function isKennethGuido(user) {
  return emailsMatch(userEmail(user), KENNETH_GUIDO_EMAIL);
}

export function kennethOddsBoardAnnouncement() {
  return {
    id: KENNETH_ODDS_BOARD_ALERT_ID,
    title: "New Odds Board",
    body: "Kevin shared the live New Odds Board with you — live odds and moneylines across the books (including Underdog Predict) with best odds highlighted. Open it anytime from the top nav.",
    enabled: true,
    cta: {
      label: "Open New Odds Board",
      href: tabHash("oddsBetstamp"),
    },
  };
}

export function shouldShowKennethOddsBoardAlert(user, prefs, { sessionDismissed } = {}) {
  if (!isKennethGuido(user)) return false;
  if (sessionDismissed) return false;
  const seen = prefs && typeof prefs.seenTargetedAlertId === "string"
    ? prefs.seenTargetedAlertId.trim()
    : "";
  return seen !== KENNETH_ODDS_BOARD_ALERT_ID;
}
