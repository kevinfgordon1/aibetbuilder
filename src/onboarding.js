// New-visitor helpers: marketing-landing routing, first-run wizard flag,
// empty-result diagnosis and the glossary. Pure functions (tested).

export const FOOTER_DISCLAIMER = "Tools and estimates only, not betting advice. Results not guaranteed. 21+, bet responsibly.";
export const WIZARD_DONE_KEY = "abb_promo_wizard_done_v1";
export const ABOUT_PHOTO_URL = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ABOUT_PHOTO_URL) || "";
export const DEMO_VIDEO_URL = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_DEMO_VIDEO_URL) || "";

function hasSupabaseSession(storage) {
  try {
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k) && storage.getItem(k)) return true;
    }
  } catch { /* storage blocked */ }
  return false;
}

// Which top-level page to render. "landing" only for a plain "/" visit by a
// logged-out visitor; any hash (deep link), auth callback param or saved
// session goes straight to the app so old links and signed-in users still work.
export function pickTopLevelPage(loc, storage) {
  const path = ((loc && loc.pathname) || "/").replace(/\/+$/, "") || "/";
  if (path === "/learn") return "learn";
  if (path === "/app") return "app";
  if (path !== "/") return "app";
  const hash = (loc && loc.hash) || "";
  if (hash && hash !== "#") return "app";
  const q = new URLSearchParams((loc && loc.search) || "");
  for (const k of ["code", "error", "error_description", "next", "auth_next", "app"]) if (q.has(k)) return "app";
  if (hasSupabaseSession(storage)) return "app";
  return "landing";
}

export function shouldShowWizard({ storage, activeTab, hasDeepLink }) {
  if (activeTab !== "promo" || hasDeepLink) return false;
  try { return !(storage && storage.getItem(WIZARD_DONE_KEY)); } catch { return false; }
}

const DEFAULT_SPORTS_LABEL = "default sports";
// Names the filters most likely to have emptied the results, newest-visitor
// language first. Returns [{ key, text }].
export function diagnoseEmptyPromo(f) {
  const out = [];
  const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const minF = num(f.minFinalOdds), maxF = num(f.maxFinalOdds), minL = num(f.minLegOdds), maxL = num(f.maxLegOdds);
  if (minF != null) {
    const strict = (f.numLegs || 1) <= 1 ? minF >= 300 : minF >= 1500;
    out.push({ key: "minFinalOdds", text: `Min Final Odds is +${minF}${strict ? ` — that's very long for ${f.numLegs || 1} leg${(f.numLegs || 1) === 1 ? "" : "s"}, so few bets qualify` : ""}.` });
  }
  if (maxF != null) out.push({ key: "maxFinalOdds", text: `Max Final Odds is ${maxF > 0 ? "+" : ""}${maxF}.` });
  if (minL != null) out.push({ key: "minLegOdds", text: `Min Leg Odds is ${minL > 0 ? "+" : ""}${minL}.` });
  if (maxL != null) out.push({ key: "maxLegOdds", text: `Max Leg Odds is ${maxL > 0 ? "+" : ""}${maxL}.` });
  if (f.includeTeam && String(f.includeTeam).trim()) out.push({ key: "include", text: `Must include “${String(f.includeTeam).trim()}”.` });
  if (f.excludeTeam && String(f.excludeTeam).trim()) out.push({ key: "exclude", text: `Must exclude “${String(f.excludeTeam).trim()}”.` });
  if (f.dateRange === "today") out.push({ key: "date", text: "Date is set to Today only." });
  if (f.sportsCount === 0) out.push({ key: "sports", text: `No sports selected (${DEFAULT_SPORTS_LABEL} are off).` });
  return out;
}

export const GLOSSARY = Object.freeze([
  { term: "EV (expected value)", def: "What a bet is worth on average if you made it many times. +$20 EV on a $100 bet means it averages about $20 profit over the long run — any single bet can still lose." },
  { term: "True Odds / fair odds", def: "Our estimate of the real chance of winning, with the sportsbook's built-in margin (vig) removed, using sharper books and exchanges." },
  { term: "Boost", def: "A sportsbook promo that raises your winnings (e.g. 30% more profit). Boosts add the most value on the right legs — that's what Promo Builder finds." },
  { term: "Free bet", def: "Site credit you can bet with. If it wins you keep the profit, not the stake." },
  { term: "No Sweat", def: "A cash bet that is refunded as site credit if it loses." },
  { term: "ML (moneyline)", def: "Bet on who wins the game." },
  { term: "SPR (spread)", def: "Bet on a team to win by more than (or lose by less than) a set number of points, e.g. Knicks -3.5." },
  { term: "TT (team total)", def: "Bet on how many points one team scores, over or under a number, e.g. Celtics TT u125.5." },
  { term: "Hedge / opposite side (opp)", def: "Betting the other outcome somewhere else to reduce risk. “Best Opp” is the best price we found on that other side." },
  { term: "Liquidity", def: "How much money is available at a price on an exchange. “Hide low liquidity” removes bets where only small amounts can be placed." },
  { term: "Depth", def: "How big a bet the market can take at that price, shown as potential profit." },
  { term: "American odds", def: "-150 means bet $150 to win $100; +200 means bet $100 to win $200." },
]);

// Browser wrappers so App.jsx never touches storage directly.
export function initialWizardOpen(win, parseHash) {
  try {
    if (new URLSearchParams(win.location.search).get("wizard") === "1") return true;
    const route = parseHash(win.location.hash) || {};
    return shouldShowWizard({ storage: win.localStorage, activeTab: route.tab || "promo", hasDeepLink: Boolean(route.cardId) });
  } catch { return false; }
}
export function markWizardDone(win) {
  try { win.localStorage.setItem(WIZARD_DONE_KEY, "1"); } catch { /* ignore */ }
}
