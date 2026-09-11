// Soccer 3-way moneyline ↔ prediction-market Yes/No pairing.
// Soft-book / PM "Home wins" pairs with the same binary's No — never Away Yes.
// 2-way sports (NFL/MLB/…) keep other-team Yes as the inverse.

export const SOCCER_SPORT_KEYS = ["soccer_epl", "soccer_usa_mls"];
// League labels for game badges / cache rows. Filter chips collapse these to Soccer.
export const SOCCER_SPORTS = [
  { key: "soccer_epl", label: "EPL" },
  { key: "soccer_usa_mls", label: "MLS" },
];
export const SOCCER_ML_SIDES = ["away", "draw", "home"];
export const DRAW_OUTCOME_NAMES = ["Draw", "Tie"];

const DRAW_LOOKUP = new Set(DRAW_OUTCOME_NAMES.map((n) => n.toLowerCase()));

export function isSoccerSport(sportKey) {
  return SOCCER_SPORT_KEYS.includes(String(sportKey || ""));
}

// If any soccer league key is present, include both Odds API keys (featured fetch / filter).
export function expandSoccerSportKeys(selected) {
  const set = selected instanceof Set ? new Set(selected) : new Set(selected || []);
  if (SOCCER_SPORT_KEYS.some((k) => set.has(k))) {
    for (const k of SOCCER_SPORT_KEYS) set.add(k);
  }
  return set;
}

export function isDrawOutcomeName(name) {
  return DRAW_LOOKUP.has(String(name || "").trim().toLowerCase());
}

export function soccerSideTeam(side, away, home) {
  if (side === "away") return away;
  if (side === "home") return home;
  return "Draw";
}

export function soccerYesName(side, away, home) {
  if (side === "draw") return "Draw";
  return `${soccerSideTeam(side, away, home)} ML`;
}

export function soccerNoName(side, away, home) {
  if (side === "draw") return "Draw No";
  return `${soccerSideTeam(side, away, home)} ML No`;
}

// Odds API h2h_lay uses the same outcome name as h2h Yes (team or Draw).
export function soccerLayOutcomeName(side, away, home) {
  return soccerSideTeam(side, away, home);
}

export function outcomeMatchesName(outcomeName, wantedName) {
  if (isDrawOutcomeName(wantedName)) return isDrawOutcomeName(outcomeName);
  return String(outcomeName || "") === String(wantedName || "");
}

// Kevin's soccer-only rule: prefer same-binary No. Do not fall back to the
// other team's Yes (that inverse is only valid for 2-way sports).
export function preferSoccerBinaryNo(sameBinaryNo, _otherTeamYes) {
  if (sameBinaryNo && sameBinaryNo.best != null) {
    return { ...sameBinaryNo, kind: "same_binary_no" };
  }
  return { best: null, bestBook: null, bestSize: null, count: 0, kind: "none" };
}

export function soccerMlOppResolveArgs(game, side, bookKey) {
  const book = (game && game.bookOdds && game.bookOdds[bookKey]) || {};
  return {
    trustedOpp: game[`best_${side}_no`] ?? null,
    trustedBook: game[`best_${side}_no_book`] ?? null,
    trustedCount: game[`ml_opp_count_${side}`] ?? 0,
    trustedSize: game[`best_${side}_no_size`] ?? null,
    sameBookOpp: book[`ml_${side}_no`] ?? null,
    sameBookKey: bookKey,
    sameBookSize: book[`ml_${side}_no_size`] ?? null,
  };
}
