// Trial-key sportsbooks from the Betstamp appendix. Keys stay aligned with the
// existing Odds Board where the same shop already exists (logos / Best column).

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
]);

export const BETSTAMP_BOOK_IDS = BETSTAMP_TRIAL_BOOKS.map((b) => b.id);

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

export const MNF_LABEL = "Monday Night Football";
export const MNF_AWAY_ALIASES = Object.freeze(["broncos", "denver", "den"]);
export const MNF_HOME_ALIASES = Object.freeze(["chiefs", "kansas city", "kc"]);
// DEN @ KC, 2026-09-14 ET / kickoff around 2026-09-15 UTC.
export const MNF_WINDOW_START_MS = Date.parse("2026-09-14T12:00:00-04:00");
export const MNF_WINDOW_END_MS = Date.parse("2026-09-15T08:00:00-04:00");

export function bookById(id) {
  const n = Number(id);
  return BOOKS_BY_ID.get(n) || null;
}

export function bookByKey(key) {
  return BOOKS_BY_KEY.get(key) || null;
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

function normName(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function nameMatchesAliases(name, abbr, aliases) {
  const n = normName(name);
  const a = normName(abbr);
  for (const alias of aliases) {
    if (n && (n === alias || n.includes(alias))) return true;
    if (a && a === alias) return true;
  }
  return false;
}

export function isMnfFixture(game, nowMs) {
  if (!game) return false;
  const awayHit = nameMatchesAliases(game.away, game.awayAbbr, MNF_AWAY_ALIASES);
  const homeHit = nameMatchesAliases(game.home, game.homeAbbr, MNF_HOME_ALIASES);
  if (!awayHit || !homeHit) return false;
  const t = Date.parse(game.commence_time);
  if (!isFinite(t)) return true;
  if (t >= MNF_WINDOW_START_MS && t <= MNF_WINDOW_END_MS) return true;
  // If Kevin opens the board after the window, still pin tonight's namesake.
  if (nowMs != null && nowMs >= MNF_WINDOW_START_MS && nowMs <= MNF_WINDOW_END_MS) return true;
  return false;
}
