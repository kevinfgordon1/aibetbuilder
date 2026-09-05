// Bump ANNOUNCEMENT.id to show again to everyone who already dismissed the previous one.
export const ANNOUNCEMENT = {
  id: "2026-09-05-profile-combo-promo",
  title: "What’s new",
  body: "Profile P/L statements now have dates, filters, search, and CSV. Combo Locks colors unhedged risk red and profit green. Promo shows prediction-market liquidity and boosted Total odds.",
};

export function shouldShowWhatsNew(announcement, prefs, { sessionDismissed } = {}) {
  if (!announcement || !announcement.id) return false;
  if (sessionDismissed) return false;
  const seen = prefs && typeof prefs.seenAnnouncementId === "string"
    ? prefs.seenAnnouncementId.trim()
    : "";
  return seen !== String(announcement.id);
}
