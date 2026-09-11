'use strict';

// CJS copy of src/soccerPairing.js for promo-ev / fetch-odds (API is CJS).
// Keep field names and pairing rule in lockstep with the ESM module.

const SOCCER_SPORT_KEYS = ['soccer_epl', 'soccer_usa_mls'];
const SOCCER_SPORTS = [
  { key: 'soccer_epl', label: 'EPL' },
  { key: 'soccer_usa_mls', label: 'MLS' },
];
const SOCCER_ML_SIDES = ['away', 'draw', 'home'];
const DRAW_OUTCOME_NAMES = ['Draw', 'Tie'];
const DRAW_LOOKUP = new Set(DRAW_OUTCOME_NAMES.map((n) => n.toLowerCase()));

function isSoccerSport(sportKey) {
  return SOCCER_SPORT_KEYS.includes(String(sportKey || ''));
}

function isDrawOutcomeName(name) {
  return DRAW_LOOKUP.has(String(name || '').trim().toLowerCase());
}

function soccerSideTeam(side, away, home) {
  if (side === 'away') return away;
  if (side === 'home') return home;
  return 'Draw';
}

function soccerYesName(side, away, home) {
  if (side === 'draw') return 'Draw';
  return `${soccerSideTeam(side, away, home)} ML`;
}

function soccerNoName(side, away, home) {
  if (side === 'draw') return 'Draw No';
  return `${soccerSideTeam(side, away, home)} ML No`;
}

function soccerLayOutcomeName(side, away, home) {
  return soccerSideTeam(side, away, home);
}

function outcomeMatchesName(outcomeName, wantedName) {
  if (isDrawOutcomeName(wantedName)) return isDrawOutcomeName(outcomeName);
  return String(outcomeName || '') === String(wantedName || '');
}

function preferSoccerBinaryNo(sameBinaryNo, _otherTeamYes) {
  if (sameBinaryNo && sameBinaryNo.best != null) {
    return { ...sameBinaryNo, kind: 'same_binary_no' };
  }
  return { best: null, bestBook: null, bestSize: null, count: 0, kind: 'none' };
}

function soccerMlOppResolveArgs(game, side, bookKey) {
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

module.exports = {
  SOCCER_SPORT_KEYS,
  SOCCER_SPORTS,
  SOCCER_ML_SIDES,
  DRAW_OUTCOME_NAMES,
  isSoccerSport,
  isDrawOutcomeName,
  soccerSideTeam,
  soccerYesName,
  soccerNoName,
  soccerLayOutcomeName,
  outcomeMatchesName,
  preferSoccerBinaryNo,
  soccerMlOppResolveArgs,
};
