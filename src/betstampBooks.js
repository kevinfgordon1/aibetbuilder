// Trial-key sportsbooks from the Betstamp appendix. Keys stay aligned with the
// existing Odds Board where the same shop already exists (logos / Best column).

import { canSeeUnderdogPredict } from "./comboAccess.js";
import { bookLogo } from "./bookLogos.js";

export const BETSTAMP_TRIAL_BOOKS = Object.freeze([
  { id: 100, key: "fanduel", label: "FanDuel", color: "#1493ff", bg: "rgba(20,147,255,0.15)", logo: bookLogo("fanduel") },
  { id: 200, key: "draftkings", label: "DraftKings", color: "#53d769", bg: "rgba(83,215,105,0.15)", logo: bookLogo("draftkings") },
  { id: 400, key: "betmgm", label: "BetMGM", color: "#c4a962", bg: "rgba(196,169,98,0.15)", logo: bookLogo("betmgm") },
  { id: 300, key: "williamhill_us", label: "Caesars", color: "#d4a843", bg: "rgba(212,168,67,0.15)", logo: bookLogo("williamhill_us") },
  { id: 250, key: "pinnacle", label: "Pinnacle", color: "#c9a227", bg: "rgba(201,162,39,0.15)", logo: bookLogo("pinnacle") },
  { id: 613, key: "betonlineag", label: "BetOnline", color: "#10b981", bg: "rgba(16,185,129,0.15)", logo: bookLogo("betonlineag") },
  { id: 642, key: "betcris", label: "BetCris", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", logo: bookLogo("betcris") },
  { id: 150, key: "circa", label: "Circa", color: "#eab308", bg: "rgba(234,179,8,0.15)", logo: bookLogo("circa") },
  { id: 365, key: "bet365", label: "bet365", color: "#027b5b", bg: "rgba(2,123,91,0.15)", logo: bookLogo("bet365") },
  { id: 191, key: "prophetx", label: "ProphetX", color: "#f43f5e", bg: "rgba(244,63,94,0.15)", logo: bookLogo("prophetx"), exchange: true },
  { id: 193, key: "polymarket", label: "Polymarket", color: "#5b6ef5", bg: "rgba(91,110,245,0.15)", logo: bookLogo("polymarket"), exchange: true },
  { id: 194, key: "kalshi", label: "Kalshi", color: "#06b6d4", bg: "rgba(6,182,212,0.15)", logo: bookLogo("kalshi"), exchange: true },
  // Betstamp OpenAPI also lists Fanatics Markets / Crypto.com on 196. UI label is Underdog Predict.
  { id: 196, key: "underdog_predict", label: "Underdog Predict", color: "#84cc16", bg: "rgba(132,204,22,0.15)", logo: bookLogo("underdog_predict"), exchange: true },
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

// Board-local id. Novig is not a Betstamp provider, so it stays out of
// BETSTAMP_TRIAL_BOOKS / BETSTAMP_BOOK_IDS. bookById still resolves it so
// New Odds Board quotes can paint the column.
export const NOVIG_BOARD_BOOK_ID = 195;
export const NOVIG_BOARD_BOOK = Object.freeze({
  id: NOVIG_BOARD_BOOK_ID,
  key: "novig",
  label: "Novig",
  color: "#a855f7",
  bg: "rgba(168,85,247,0.15)",
  logo: null,
  exchange: true,
});

BOOKS_BY_ID.set(NOVIG_BOARD_BOOK.id, NOVIG_BOARD_BOOK);
BOOKS_BY_KEY.set(NOVIG_BOARD_BOOK.key, NOVIG_BOARD_BOOK);

// Board-local id. 4Casters is not a Betstamp provider.
export const FOURCASTERS_BOARD_BOOK_ID = 197;
export const FOURCASTERS_BOARD_BOOK = Object.freeze({
  id: FOURCASTERS_BOARD_BOOK_ID,
  key: "fourcasters",
  label: "4Casters",
  color: "#2dd4bf",
  bg: "rgba(45,212,191,0.15)",
  logo: null,
  exchange: true,
});

BOOKS_BY_ID.set(FOURCASTERS_BOARD_BOOK.id, FOURCASTERS_BOARD_BOOK);
BOOKS_BY_KEY.set(FOURCASTERS_BOARD_BOOK.key, FOURCASTERS_BOARD_BOOK);

// Betstamp Odds Board (Kevin only) extra books. These are Betstamp appendix
// ids the proxy accepts only when a caller lists them in book_ids (#241).
// Registered for bookById so a snapshot that carries them can paint, but kept
// out of BETSTAMP_TRIAL_BOOKS so Promo and the New Odds Board are unchanged.
// Never Fliff (800), never Courtside, never Betstamp Underdog (196).
export const BETSTAMP_EXTRA_BOARD_BOOKS = Object.freeze([
  { id: 722, key: "fanatics", label: "Fanatics", color: "#e11d48", bg: "rgba(225,29,72,0.15)", logo: null },
  { id: 500, key: "betrivers", label: "BetRivers (Kambi)", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", logo: null },
  { id: 105, key: "bet105", label: "Bet105", color: "#38bdf8", bg: "rgba(56,189,248,0.15)", logo: null },
  { id: 614, key: "betus", label: "BetUS", color: "#ef4444", bg: "rgba(239,68,68,0.15)", logo: null },
  { id: 700, key: "thescore", label: "theScore Bet", color: "#60a5fa", bg: "rgba(96,165,250,0.15)", logo: null },
  { id: 850, key: "hardrockbet", label: "Hard Rock", color: "#a78bfa", bg: "rgba(167,139,250,0.15)", logo: null },
]);

for (const b of BETSTAMP_EXTRA_BOARD_BOOKS) {
  if (!BOOKS_BY_ID.has(b.id)) BOOKS_BY_ID.set(b.id, b);
  if (!BOOKS_BY_KEY.has(b.key)) BOOKS_BY_KEY.set(b.key, b);
}

// Column order on the Betstamp Odds Board: Kevin's core books, then the
// Betstamp exchanges. 196 / Fliff / Courtside are never on this list.
export const BETSTAMP_ODDS_BOARD_BOOK_IDS = Object.freeze([
  200, 100, 300, 722, 365,
  642,
  500,
  250, 105, 613, 614, 150,
  700, 850,
  191, 193, 194,
]);
export const BETSTAMP_ODDS_BOARD_FORBIDDEN_BOOK_IDS = Object.freeze([UNDERDOG_PREDICT_BOOK_ID, 800]);

// Kevin's list includes Bet105 (105) and Hard Rock (850), but the current
// Betstamp trial key answers "You do not have access to this provider" for
// both (checked Sep 28 2026). A bare 403 makes /api/betstamp-markets drop
// EVERY opt-in book (Fanatics, Kambi, BetUS, theScore too), so do not send
// them until the plan covers them. Remove an id here once it is entitled.
export const BETSTAMP_ODDS_BOARD_UNENTITLED_BOOK_IDS = Object.freeze([105, 850]);

/** book_ids this board sends to /api/betstamp-markets. */
export function betstampOddsBoardRequestIds() {
  return betstampOddsBoardBooks()
    .map((b) => b.id)
    .filter((id) => !BETSTAMP_ODDS_BOARD_UNENTITLED_BOOK_IDS.includes(id));
}

export function betstampOddsBoardBooks() {
  return BETSTAMP_ODDS_BOARD_BOOK_IDS
    .filter((id) => !BETSTAMP_ODDS_BOARD_FORBIDDEN_BOOK_IDS.includes(id))
    .map((id) => BOOKS_BY_ID.get(id))
    .filter(Boolean);
}

// Kalshi / Polymarket / Novig / 4Casters / ProphetX / Underdog Predict — exchanges the board shows as win probability.
export const PM_WIN_PROB_BOOKS = Object.freeze(["kalshi", "polymarket", "novig", "fourcasters", "prophetx", "underdog_predict"]);

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
