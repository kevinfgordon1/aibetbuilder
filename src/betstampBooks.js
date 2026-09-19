// Trial-key sportsbooks from the Betstamp appendix. Keys stay aligned with the
// existing Odds Board where the same shop already exists (logos / Best column).

import { canSeeUnderdogPredict } from "./comboAccess.js";

export const BETSTAMP_TRIAL_BOOKS = Object.freeze([
  { id: 100, key: "fanduel", label: "FanDuel", color: "#1493ff", bg: "rgba(20,147,255,0.15)", logo: "https://www.fanduel.com/favicon.ico" },
  { id: 200, key: "draftkings", label: "DraftKings", color: "#53d769", bg: "rgba(83,215,105,0.15)", logo: "https://www.draftkings.com/favicon.ico" },
  { id: 300, key: "williamhill_us", label: "Caesars", color: "#d4a843", bg: "rgba(212,168,67,0.15)", logo: "https://www.caesars.com/favicon.ico" },
  { id: 250, key: "pinnacle", label: "Pinnacle", color: "#c9a227", bg: "rgba(201,162,39,0.15)", logo: "https://www.pinnacle.com/favicon.ico" },
  { id: 613, key: "betonlineag", label: "BetOnline", color: "#10b981", bg: "rgba(16,185,129,0.15)", logo: null },
  { id: 642, key: "betcris", label: "BetCris", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", logo: null },
  { id: 150, key: "circa", label: "Circa", color: "#eab308", bg: "rgba(234,179,8,0.15)", logo: null },
  { id: 365, key: "bet365", label: "bet365", color: "#027b5b", bg: "rgba(2,123,91,0.15)", logo: null },
  { id: 191, key: "prophetx", label: "ProphetX", color: "#f43f5e", bg: "rgba(244,63,94,0.15)", logo: null, exchange: true },
  { id: 193, key: "polymarket", label: "Polymarket", color: "#5b6ef5", bg: "rgba(91,110,245,0.15)", logo: "https://polymarket.com/favicon.ico", exchange: true },
  { id: 194, key: "kalshi", label: "Kalshi", color: "#06b6d4", bg: "rgba(6,182,212,0.15)", logo: "https://kalshi.com/favicon.ico", exchange: true },
  // Betstamp OpenAPI also lists Fanatics Markets / Crypto.com on 196. UI label is Underdog Predict.
  { id: 196, key: "underdog_predict", label: "Underdog Predict", color: "#84cc16", bg: "rgba(132,204,22,0.15)", logo: "https://underdogfantasy.com/favicon.ico", exchange: true },
]);

export const UNDERDOG_PREDICT_BOOK_ID = 196;
export const UNDERDOG_PREDICT_BOOK_KEY = "underdog_predict";

export const BETSTAMP_BOOK_IDS = BETSTAMP_TRIAL_BOOKS.map((b) => b.id);
export const BETSTAMP_PUBLIC_BOOK_IDS = BETSTAMP_BOOK_IDS.filter((id) => id !== UNDERDOG_PREDICT_BOOK_ID);

const BOOKS_BY_ID = new Map(BETSTAMP_TRIAL_BOOKS.map((b) => [b.id, b]));
const BOOKS_BY_KEY = new Map(BETSTAMP_TRIAL_BOOKS.map((b) => [b.key, b]));

export const BETSTAMP_SPORTS = Object.freeze([
  { id: "americanfootball_nfl", label: "NFL", league: "NFL" },
  { id: "americanfootball_ncaaf", label: "NCAAF", league: "NCAAF" },
]);

export const BETSTAMP_LEAGUES = BETSTAMP_SPORTS.map((s) => s.league);
export const BETSTAMP_DEFAULT_SPORT = "americanfootball_nfl";
export const BETSTAMP_MAIN_BET_TYPES = Object.freeze(["moneyline", "spread", "total"]);
export const BETSTAMP_MAIN_PERIOD = "FT";

export function bookById(id) {
  const n = Number(id);
  return BOOKS_BY_ID.get(n) || null;
}

export function bookByKey(key) {
  return BOOKS_BY_KEY.get(key) || null;
}

// Kalshi / Polymarket / ProphetX / Underdog Predict — same venues the public board treats as PMs.
export const PM_WIN_PROB_BOOKS = Object.freeze(["kalshi", "polymarket", "prophetx", "underdog_predict"]);

export function isPmWinProbBook(key) {
  return PM_WIN_PROB_BOOKS.includes(String(key || "").toLowerCase());
}

export function sportById(id) {
  return BETSTAMP_SPORTS.find((s) => s.id === id) || BETSTAMP_SPORTS[0];
}

export function sportByLeague(league) {
  const needle = String(league || "").toUpperCase();
  return BETSTAMP_SPORTS.find((s) => s.league === needle) || null;
}

export function leagueForSport(sportId) {
  return sportById(sportId).league;
}

/** New Odds Board catalog. Underdog Predict (196) is allowlisted (Kevin + Kenneth by default). */
export function visibleBetstampBooks(user, env) {
  if (canSeeUnderdogPredict(user, env)) return BETSTAMP_TRIAL_BOOKS;
  return BETSTAMP_TRIAL_BOOKS.filter((b) => b.id !== UNDERDOG_PREDICT_BOOK_ID);
}

export function visibleBetstampBookIds(user, env) {
  return visibleBetstampBooks(user, env).map((b) => b.id);
}
