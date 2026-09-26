// ESM (.mjs) on purpose. The Vite app imports this file. Shipping a CommonJS
// assignment into the browser throws "module is not defined" and blanks the
// page. Node API routes load the same bindings through lib/player-td.cjs.

// NFL player touchdown and MLB batter home run (1+ HR) matching, ticker/slug
// parsing, and fair-price math.
// New Odds Board and Promo both use this. Prices that leave this module are
// American odds (integers such as -178 / +170), never cents or percents.
//
// A player is only compared to another player in the same game. Name
// normalization strips Jr/Sr/II/III/IV, punctuation, and case. If the full
// name still misses, a single-letter first name can match the first initial
// plus last name (T. Kelce ↔ Travis Kelce).

const TAKER_FEE_RATE = Object.freeze({
  kalshi: 0.07,
  polymarket: 0.07,
});

const MONTHS = Object.freeze({
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
});

// Kalshi packs two clubs into the game token. These abbreviations are two
// letters; everything else in a 5-letter blob is a three-letter club.
const TWO_LETTER = new Set(['NE', 'SF', 'GB', 'KC', 'TB', 'LV', 'NO', 'AZ']);

const ABBR_ALIAS = Object.freeze({
  WSH: 'WAS',
  JAC: 'JAX',
  ARZ: 'ARI',
  LA: 'LAR',
});

const NFL_TEAMS = Object.freeze([
  ['ARI', 'Arizona Cardinals', 'Cardinals'],
  ['ATL', 'Atlanta Falcons', 'Falcons'],
  ['BAL', 'Baltimore Ravens', 'Ravens'],
  ['BUF', 'Buffalo Bills', 'Bills'],
  ['CAR', 'Carolina Panthers', 'Panthers'],
  ['CHI', 'Chicago Bears', 'Bears'],
  ['CIN', 'Cincinnati Bengals', 'Bengals'],
  ['CLE', 'Cleveland Browns', 'Browns'],
  ['DAL', 'Dallas Cowboys', 'Cowboys'],
  ['DEN', 'Denver Broncos', 'Broncos'],
  ['DET', 'Detroit Lions', 'Lions'],
  ['GB', 'Green Bay Packers', 'Packers'],
  ['HOU', 'Houston Texans', 'Texans'],
  ['IND', 'Indianapolis Colts', 'Colts'],
  ['JAX', 'Jacksonville Jaguars', 'Jaguars'],
  ['KC', 'Kansas City Chiefs', 'Chiefs'],
  ['LV', 'Las Vegas Raiders', 'Raiders'],
  ['LAC', 'Los Angeles Chargers', 'Chargers'],
  ['LAR', 'Los Angeles Rams', 'Rams'],
  ['MIA', 'Miami Dolphins', 'Dolphins'],
  ['MIN', 'Minnesota Vikings', 'Vikings'],
  ['NE', 'New England Patriots', 'Patriots'],
  ['NO', 'New Orleans Saints', 'Saints'],
  ['NYG', 'New York Giants', 'Giants'],
  ['NYJ', 'New York Jets', 'Jets'],
  ['PHI', 'Philadelphia Eagles', 'Eagles'],
  ['PIT', 'Pittsburgh Steelers', 'Steelers'],
  ['SF', 'San Francisco 49ers', '49ers'],
  ['SEA', 'Seattle Seahawks', 'Seahawks'],
  ['TB', 'Tampa Bay Buccaneers', 'Buccaneers'],
  ['TEN', 'Tennessee Titans', 'Titans'],
  ['WAS', 'Washington Commanders', 'Commanders'],
]);

// Full catalog. v1 enables anytime only. Adding 'two' or 'first' turns those
// markets back on for the board, Promo legs, and (for first) the Kalshi series.
const TD_MARKETS = Object.freeze(['anytime', 'two', 'first']);
const ENABLED_TD_MARKETS = Object.freeze(['anytime']);

// Promo's book list (ALL_BOOKS / TRUSTED_BOOK_KEYS in promo-ev.js) never
// includes Fliff or Courtside. Player TD fair prices and picks drop those
// Odds API keys too, including rows already stored before this filter.
const PLAYER_TD_EXCLUDED_BOOKS = Object.freeze(['fliff', 'courtside']);

const MARKET_LABEL = Object.freeze({
  anytime: '1+ TD',
  two: '2+ TD',
  first: 'First TD',
  hr: '1+ HR',
});

// MLB batter home runs. v1 is 1+ (Odds API batter_home_runs Over 0.5,
// Kalshi KXMLBHR ...-1, Polymarket US baseball_player_home_runs line 1,
// Underdog ml_player_hr 0.5). 2+ and other lines are ignored.
const MLB_PROP_SPORT = 'baseball_mlb';
const NFL_PROP_SPORT = 'americanfootball_nfl';
const HR_MARKETS = Object.freeze(['hr']);

// Per-sport Promo leg spec for rows in player_prop_cache. The row's sport
// picks which market slots are read and which leg market tag is used.
const PLAYER_PROP_SPECS = Object.freeze({
  [NFL_PROP_SPORT]: Object.freeze({ kind: 'td', markets: ENABLED_TD_MARKETS, legMarket: 'TD' }),
  [MLB_PROP_SPORT]: Object.freeze({ kind: 'hr', markets: HR_MARKETS, legMarket: 'HR' }),
});
const PLAYER_PROP_SPORTS = Object.freeze(Object.keys(PLAYER_PROP_SPECS));

function playerPropSpec(sport) {
  return PLAYER_PROP_SPECS[sport || NFL_PROP_SPORT] || null;
}

// Kickoff must be in the future and at most 72 hours away.
const PLAYER_TD_LOOKAHEAD_MS = 72 * 60 * 60 * 1000;

function canonAbbr(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return '';
  return ABBR_ALIAS[code] || code;
}

function nflTeamByAbbr(abbr) {
  const code = canonAbbr(abbr);
  return NFL_TEAMS.find((row) => row[0] === code) || null;
}

function nflAbbrFromName(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return '';
  const direct = canonAbbr(raw);
  if (nflTeamByAbbr(direct) && raw.length <= 3) return canonAbbr(direct);
  for (const [abbr, full, nick] of NFL_TEAMS) {
    if (raw === full.toLowerCase() || raw === nick.toLowerCase() || raw === abbr.toLowerCase()) return abbr;
  }
  return '';
}

function teamDisplayName(abbr, fallback) {
  const row = nflTeamByAbbr(abbr);
  if (row) return row[1];
  const text = String(fallback || '').trim();
  return text || canonAbbr(abbr);
}

function splitTeamCode(code) {
  const s = String(code || '').toUpperCase();
  if (s.length === 6) return [s.slice(0, 3), s.slice(3)];
  if (s.length === 4) return [s.slice(0, 2), s.slice(2)];
  if (s.length === 5) {
    if (TWO_LETTER.has(s.slice(0, 2))) return [s.slice(0, 2), s.slice(2)];
    if (TWO_LETTER.has(s.slice(-2))) return [s.slice(0, 3), s.slice(-2)];
  }
  return [];
}

function teamsFromKalshiGameToken(token) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/.exec(String(token || '').toUpperCase());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  const codes = splitTeamCode(m[4]);
  if (codes.length !== 2) return null;
  const away = canonAbbr(codes[0]);
  const home = canonAbbr(codes[1]);
  if (!away || !home || away === home) return null;
  const date = `${2000 + Number(m[1])}-${month}-${m[3]}`;
  return {
    away,
    home,
    date,
    gameToken: `${m[1]}${m[2]}${m[3]}${m[4]}`,
    gameKey: gameKeyOf(away, home, date),
  };
}

function gameKeyOf(away, home, date) {
  const a = canonAbbr(away);
  const h = canonAbbr(home);
  const d = String(date || '').trim();
  if (!a || !h) return '';
  return d ? `${a}|${h}|${d}` : `${a}|${h}`;
}

function pairKeyFromSlug(slug) {
  const m = /^nfl-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$/i.exec(String(slug || '').trim());
  if (!m) return null;
  const away = canonAbbr(m[1]);
  const home = canonAbbr(m[2]);
  if (!away || !home || away === home) return null;
  const date = m[3];
  return {
    away,
    home,
    date,
    gameKey: gameKeyOf(away, home, date),
    slug: slugFromTeams(away, home, date),
  };
}

function slugFromTeams(away, home, date) {
  const a = canonAbbr(away).toLowerCase();
  const h = canonAbbr(home).toLowerCase();
  const d = String(date || '').trim();
  if (!a || !h || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return `nfl-${a}-${h}-${d}`;
}

function slugFromGameKey(gameKey) {
  const parts = String(gameKey || '').split('|');
  if (parts.length < 3) return '';
  return slugFromTeams(parts[0], parts[1], parts[2]);
}

function easternDate(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(t));
  } catch (_) {
    return '';
  }
}

function gameKeyFromTeams(awayName, homeName, commence) {
  const away = nflAbbrFromName(awayName);
  const home = nflAbbrFromName(homeName);
  const date = easternDate(commence);
  if (!away || !home || !date) return '';
  return gameKeyOf(away, home, date);
}

// MLB clubs. Codes are the Kalshi / Polymarket US / MLB Stats API ones
// (AZ, ATH, CWS, WSH); aliases fold other feeds' spellings onto them.
const MLB_TEAMS = Object.freeze([
  ['AZ', 'Arizona Diamondbacks', 'Diamondbacks'],
  ['ATH', 'Athletics', 'Athletics'],
  ['ATL', 'Atlanta Braves', 'Braves'],
  ['BAL', 'Baltimore Orioles', 'Orioles'],
  ['BOS', 'Boston Red Sox', 'Red Sox'],
  ['CHC', 'Chicago Cubs', 'Cubs'],
  ['CWS', 'Chicago White Sox', 'White Sox'],
  ['CIN', 'Cincinnati Reds', 'Reds'],
  ['CLE', 'Cleveland Guardians', 'Guardians'],
  ['COL', 'Colorado Rockies', 'Rockies'],
  ['DET', 'Detroit Tigers', 'Tigers'],
  ['HOU', 'Houston Astros', 'Astros'],
  ['KC', 'Kansas City Royals', 'Royals'],
  ['LAA', 'Los Angeles Angels', 'Angels'],
  ['LAD', 'Los Angeles Dodgers', 'Dodgers'],
  ['MIA', 'Miami Marlins', 'Marlins'],
  ['MIL', 'Milwaukee Brewers', 'Brewers'],
  ['MIN', 'Minnesota Twins', 'Twins'],
  ['NYM', 'New York Mets', 'Mets'],
  ['NYY', 'New York Yankees', 'Yankees'],
  ['PHI', 'Philadelphia Phillies', 'Phillies'],
  ['PIT', 'Pittsburgh Pirates', 'Pirates'],
  ['SD', 'San Diego Padres', 'Padres'],
  ['SF', 'San Francisco Giants', 'Giants'],
  ['SEA', 'Seattle Mariners', 'Mariners'],
  ['STL', 'St. Louis Cardinals', 'Cardinals'],
  ['TB', 'Tampa Bay Rays', 'Rays'],
  ['TEX', 'Texas Rangers', 'Rangers'],
  ['TOR', 'Toronto Blue Jays', 'Blue Jays'],
  ['WSH', 'Washington Nationals', 'Nationals'],
]);

const MLB_ABBR_ALIAS = Object.freeze({
  ARI: 'AZ', OAK: 'ATH', CHW: 'CWS', WAS: 'WSH', WSN: 'WSH',
  TBR: 'TB', SDP: 'SD', SFG: 'SF', KCR: 'KC', ANA: 'LAA',
});

const MLB_CODES = new Set(MLB_TEAMS.map((row) => row[0]));

function canonMlbAbbr(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return '';
  const mapped = MLB_ABBR_ALIAS[code] || code;
  return MLB_CODES.has(mapped) ? mapped : '';
}

function teamKeyText(name) {
  return String(name || '').toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
}

function mlbAbbrFromName(name) {
  const raw = teamKeyText(name);
  if (!raw) return '';
  if (raw.length <= 3) {
    const code = canonMlbAbbr(raw);
    if (code) return code;
  }
  if (raw === 'oakland athletics' || raw === 'oakland as' || raw === 'as') return 'ATH';
  for (const [abbr, full, nick] of MLB_TEAMS) {
    if (raw === teamKeyText(full) || raw === teamKeyText(nick)) return abbr;
  }
  return '';
}

// "LAASEA" → ['LAA', 'SEA'], "AZSD" → ['AZ', 'SD'].
function splitMlbTeamCode(blob) {
  const s = String(blob || '').toUpperCase();
  // Exact codes first, then aliases (ARISD → AZ / SD).
  for (const exact of [true, false]) {
    for (let i = 2; i <= s.length - 2; i += 1) {
      const left = s.slice(0, i);
      const right = s.slice(i);
      if (exact && (!MLB_CODES.has(left) || !MLB_CODES.has(right))) continue;
      const a = canonMlbAbbr(left);
      const b = canonMlbAbbr(right);
      if (a && b && a !== b) return [a, b];
    }
  }
  return [];
}

function mlbGameKeyOf(away, home, date) {
  const a = canonMlbAbbr(away);
  const h = canonMlbAbbr(home);
  const d = String(date || '').trim();
  if (!a || !h || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return `MLB|${a}|${h}|${d}`;
}

function mlbGameKeyFromTeams(awayName, homeName, commence) {
  return mlbGameKeyOf(mlbAbbrFromName(awayName), mlbAbbrFromName(homeName), easternDate(commence));
}

function easternClock(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}${get('minute')}`;
}

// Eastern wall clock (date + HHMM) → UTC ISO. Kalshi MLB game tokens carry
// the scheduled first pitch in ET (26SEP262140 = Sep 26, 9:40 PM ET).
function easternWallClockToIso(date, hhmm) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{2})(\d{2})$/.exec(String(hhmm || ''));
  if (!d || !t) return null;
  for (const offset of [4, 5]) {
    const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]) + offset, Number(t[2]));
    if (easternClock(ms) === `${d[1]}-${d[2]}-${d[3]} ${t[1]}${t[2]}`) return new Date(ms).toISOString();
  }
  return null;
}

// KXMLBHR-26SEP262140LAASEA-SEAJRODRGUEZ44-1 → 1+ HR, LAA @ SEA, first pitch
// 9:40 PM ET. Kalshi occurrence_datetime on these markets runs 3 hours late
// (same as NFL), so the commence comes from the ticker's ET clock instead.
// Only the -1 (1+) strike maps to a market; 2+ returns null.
function parseKalshiHrTicker(ticker) {
  const parts = String(ticker || '').split('-').filter(Boolean);
  if (parts.length < 3) return null;
  const series = parts[0].toUpperCase();
  if (series !== 'KXMLBHR') return null;
  const m = /^(\d{2})([A-Z]{3})(\d{2})(\d{4})([A-Z]+)$/.exec(parts[1].toUpperCase());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (!month) return null;
  const codes = splitMlbTeamCode(m[5]);
  if (codes.length !== 2) return null;
  const threshold = Number(parts[parts.length - 1]);
  if (threshold !== 1) return null;
  const [away, home] = codes;
  const date = `${2000 + Number(m[1])}-${month}-${m[3]}`;
  const playerToken = parts.length >= 4 ? parts[2].toUpperCase() : '';
  let team = '';
  for (const code of [away, home].sort((a, b) => b.length - a.length)) {
    if (playerToken.startsWith(code)) { team = code; break; }
  }
  return {
    series,
    market: 'hr',
    threshold,
    ticker: parts.join('-'),
    away,
    home,
    date,
    team,
    commence: easternWallClockToIso(date, m[4]),
    gameKey: mlbGameKeyOf(away, home, date),
  };
}

// mlb-cle-kc-2026-09-26 (Polymarket US event slug) → CLE @ KC.
function pairKeyFromMlbSlug(slug) {
  const m = /^mlb-([a-z]+)-([a-z]+)-(\d{4}-\d{2}-\d{2})$/i.exec(String(slug || '').trim());
  if (!m) return null;
  const away = canonMlbAbbr(m[1]);
  const home = canonMlbAbbr(m[2]);
  if (!away || !home || away === home) return null;
  return { away, home, date: m[3], gameKey: mlbGameKeyOf(away, home, m[3]), slug: mlbSlugFromTeams(away, home, m[3]) };
}

function mlbSlugFromTeams(away, home, date) {
  const a = canonMlbAbbr(away).toLowerCase();
  const h = canonMlbAbbr(home).toLowerCase();
  const d = String(date || '').trim();
  if (!a || !h || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return `mlb-${a}-${h}-${d}`;
}

function hrMarketFromLine(line) {
  const n = Number(line);
  if (n === 1 || n === 0.5) return 'hr';
  return null;
}

// Doubleheaders share teams and date. A quote with a start time must sit
// within this window of the sportsbook event's commence to join that game.
const MLB_COMMENCE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

function commenceCompatible(a, b, toleranceMs = MLB_COMMENCE_TOLERANCE_MS) {
  const ta = typeof a === 'number' ? a : Date.parse(a || '');
  const tb = typeof b === 'number' ? b : Date.parse(b || '');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) <= toleranceMs;
}

// Same-day MLB window for the props cron: first pitch in the future and on
// today's Eastern calendar date.
function startsLaterTodayEt(commence, now) {
  const t = typeof commence === 'number' ? commence : Date.parse(commence || '');
  const clock = Number(now);
  if (!Number.isFinite(t) || !Number.isFinite(clock) || t <= clock) return false;
  return easternDate(new Date(t).toISOString()) === easternDate(new Date(clock).toISOString());
}

// KXNFLTD-26SEP28PHICHI-CHIDSWIFT4-3 → anytime/two/three on PHI@CHI.
// KXNFLFIRSTTD-26SEP28PHICHI-CHICKEENUM11 → first TD. Team-first is not
// the game-first scorer market and is ignored.
function parseKalshiTdTicker(ticker) {
  const parts = String(ticker || '').split('-').filter(Boolean);
  if (parts.length < 3) return null;
  const series = parts[0].toUpperCase();
  const teams = teamsFromKalshiGameToken(parts[1]);
  if (!teams) return null;
  let market = null;
  let threshold = null;
  if (series === 'KXNFLTD') {
    threshold = Number(parts[parts.length - 1]);
    if (threshold === 1) market = 'anytime';
    else if (threshold === 2) market = 'two';
    else if (threshold === 3) market = 'three';
    else return null;
  } else if (series === 'KXNFLFIRSTTD') {
    market = 'first';
  } else {
    return null;
  }
  return { series, market, threshold, ticker: parts.join('-'), ...teams };
}

function playerNameFromKalshiTitle(title, yesSub) {
  const raw = String(title || yesSub || '').trim();
  if (!raw) return '';
  const head = raw.split(':')[0].trim();
  return head || raw;
}

function normalizePlayerName(name) {
  let s = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/['’.]/g, '');
  s = s.toLowerCase().replace(/[^a-z\s]/g, ' ');
  s = s.replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function nameParts(norm) {
  const parts = String(norm || '').split(' ').filter(Boolean);
  return {
    parts,
    first: parts[0] || '',
    last: parts.length ? parts[parts.length - 1] : '',
  };
}

function samePlayer(a, b) {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = nameParts(na);
  const pb = nameParts(nb);
  if (!pa.last || pa.last !== pb.last) return false;
  if (pa.parts.length < 2 || pb.parts.length < 2) return false;
  const aInitial = pa.first.length === 1;
  const bInitial = pb.first.length === 1;
  if ((aInitial || bInitial) && pa.first[0] === pb.first[0]) return true;
  return false;
}

function teamsCompatible(a, b) {
  const left = canonAbbr(a);
  const right = canonAbbr(b);
  if (!left || !right) return true;
  return left === right;
}

// Join by game first. The same normalized name in another matchup is not a hit.
function samePlayerInGame(nameA, gameA, nameB, gameB, teamA, teamB) {
  if (!gameA || !gameB || gameA !== gameB) return false;
  if (!teamsCompatible(teamA, teamB)) return false;
  return samePlayer(nameA, nameB);
}

function asUnitProb(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return n;
}

function impliedFromAmerican(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return 100 / (n + 100);
}

function americanFromProb(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  if (n >= 0.5) return -Math.round((100 * n) / (1 - n));
  return Math.round((100 * (1 - n)) / n);
}

function parseAmerican(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? Math.round(raw) : null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/^\+/, '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  if (/[.]/.test(s) && Math.abs(n) < 50) return null;
  return Math.round(n);
}

function takerFeeRate(book) {
  const rate = TAKER_FEE_RATE[String(book || '').toLowerCase()];
  return rate == null ? 0 : rate;
}

function effectiveTakerPrice(price, rate) {
  const p = Number(price);
  if (!(p > 0 && p < 1)) return null;
  const r = Number(rate);
  if (!(r > 0)) return p;
  const eff = p + (r * p * (1 - p));
  if (!(eff > 0 && eff < 1)) return null;
  return eff;
}

// Fee-inclusive American for a Yes or No ask, matching the New Odds Board
// taker formula: cost = P + rate·P·(1−P).
function boardYesAmerican(price, rate) {
  const eff = effectiveTakerPrice(price, rate);
  if (eff == null) return null;
  return americanFromProb(eff);
}

// Kalshi / Polymarket No ask = 1 − Yes bid. The fee is charged on that No ask.
function noAskAmericanFromYesBid(yesBid, feeRate) {
  const bid = Number(yesBid);
  if (!(bid > 0 && bid < 1)) return null;
  const noAsk = 1 - bid;
  if (!(noAsk > 0 && noAsk < 1)) return null;
  return boardYesAmerican(noAsk, feeRate);
}

// Fair Yes American = 1 − implied(No). This is the price Promo compares to
// the sportsbook Yes. It is not a normalization across players.
function fairYesAmericanFromNo(noAmerican) {
  const imp = impliedFromAmerican(noAmerican);
  if (imp == null) return null;
  const yes = 1 - imp;
  if (!(yes > 0 && yes < 1)) return null;
  return americanFromProb(yes);
}

// Multiplicative de-vig of a two-sided Over/Under. Returns the fair Yes
// American and the opposite (No) American Promo stores as bestOpp.
function devigTwoWay(overAmerican, underAmerican) {
  const over = impliedFromAmerican(overAmerican);
  const under = impliedFromAmerican(underAmerican);
  if (over == null || under == null) return null;
  const sum = over + under;
  if (!(sum > 0)) return null;
  const fairYes = over / sum;
  const fairNo = 1 - fairYes;
  if (!(fairYes > 0 && fairYes < 1) || !(fairNo > 0 && fairNo < 1)) return null;
  return {
    fairYesAmerican: americanFromProb(fairYes),
    oppAmerican: americanFromProb(fairNo),
  };
}

function bestAmericanQuote(quotes) {
  let best = null;
  for (const quote of quotes || []) {
    const price = Number(quote && quote.price);
    if (!Number.isFinite(price) || price === 0) continue;
    if (!best || price > best.price) best = { price, book: quote.book || null, source: quote.source || null };
  }
  return best;
}

function quoteUpdatedMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function quoteIsOlderThan(updatedAt, now, maxAgeMs) {
  const ts = quoteUpdatedMs(updatedAt);
  if (ts == null) return false;
  const clock = Number(now);
  if (!Number.isFinite(clock)) return false;
  return clock - ts > Number(maxAgeMs);
}

// Two parlays legs correlate when they name the same game, or when both are
// player TD legs from the same matchup even if the display string differs.
function promoLegsCorrelate(a, b) {
  if (!a || !b) return false;
  if (a.game === b.game) return true;
  if (a.playerTd && b.playerTd && a.tdGameKey && a.tdGameKey === b.tdGameKey) return true;
  return false;
}

function conflictsWithAny(cand, legs) {
  return (legs || []).some((leg) => promoLegsCorrelate(cand, leg));
}

function playerTdBookExcluded(key) {
  return PLAYER_TD_EXCLUDED_BOOKS.includes(String(key || '').toLowerCase());
}

function kickoffInPlayerTdWindow(commence, now) {
  const t = typeof commence === 'number' ? commence : Date.parse(commence || '');
  const clock = Number(now);
  if (!Number.isFinite(t) || !Number.isFinite(clock)) return false;
  return t > clock && t <= clock + PLAYER_TD_LOOKAHEAD_MS;
}

// Kalshi occurrence_datetime on NFL touchdown markets is the Eastern kickoff
// clock stored with a Pacific offset. ET and PT differ by 3 hours all year,
// so the UTC instant is exactly 3 hours late: 1:00 PM ET arrives as 20:00Z
// and renders as 4:00 PM ET. Polymarket startTime and Underdog scheduled_at
// are true UTC. Prefer those when they sit within a few hours of the Kalshi
// stamp. A Kalshi-only game is rewound by that same 3 hours.
const KALSHI_KICKOFF_LATE_MS = 3 * 60 * 60 * 1000;
const KICKOFF_SOURCE_SKEW_MS = 8 * 60 * 60 * 1000;

function canonicalKickoffMs(quotes) {
  let kalshi = null;
  let other = null;
  for (const quote of quotes || []) {
    const t = Date.parse(quote && quote.commence || '');
    if (!Number.isFinite(t)) continue;
    if (quote.book === 'kalshi') {
      if (kalshi == null || t < kalshi) kalshi = t;
    } else if (other == null || t < other) {
      other = t;
    }
  }
  if (other != null && (kalshi == null || Math.abs(other - kalshi) <= KICKOFF_SOURCE_SKEW_MS)) return other;
  if (kalshi != null) return kalshi - KALSHI_KICKOFF_LATE_MS;
  return null;
}

function formatKickoffEt(iso) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(t)).replace(/\u202f/g, ' ');
  return `${time} ET`;
}

// Keep enabled markets whose game has a kickoff inside the 72h window.
// 2+ and first quotes stay parseable; they drop here until enabled.
function selectPlayerTdQuotes(quotes, now, markets = ENABLED_TD_MARKETS) {
  const allowed = new Set(markets && markets.length ? markets : ENABLED_TD_MARKETS);
  const clock = now != null ? Number(now) : Date.now();
  const byGame = new Map();
  for (const quote of quotes || []) {
    if (!quote || !quote.gameKey || !allowed.has(quote.market)) continue;
    if (!byGame.has(quote.gameKey)) byGame.set(quote.gameKey, []);
    byGame.get(quote.gameKey).push(quote);
  }
  const out = [];
  for (const list of byGame.values()) {
    const kick = canonicalKickoffMs(list);
    if (kick == null || !kickoffInPlayerTdWindow(kick, clock)) continue;
    out.push(...list);
  }
  return out;
}

function legName(player, market) {
  const who = String(player || '').trim();
  const label = MARKET_LABEL[market] || market;
  return `${who} ${label}`;
}

function playerTdsFromCacheRows(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row) continue;
    const data = row.data && typeof row.data === 'object' ? row.data : {};
    const players = Array.isArray(data.players) ? data.players : [];
    if (!players.length) continue;
    out.push({
      eventId: row.event_id || data.eventId || null,
      sport: row.sport || 'americanfootball_nfl',
      away: row.away_team || data.away || '',
      home: row.home_team || data.home || '',
      commence_time: row.commence_time || data.commence_time || null,
      gameKey: data.gameKey || '',
      players,
    });
  }
  return out;
}

function normalizeBookSet(books) {
  if (!books) return null;
  if (books instanceof Set) return books;
  if (Array.isArray(books)) return new Set(books);
  return null;
}

function validOppQuote(quote) {
  if (!quote || quote.price == null) return false;
  const price = Number(quote.price);
  if (!Number.isFinite(price) || price === 0) return false;
  return !playerTdBookExcluded(quote.book);
}

// Every fair "No" candidate stored for a player slot. Rows cached before
// per-venue storage only carry slot.opp; treat that as the single candidate.
function playerTdOppCandidates(slot) {
  if (!slot) return [];
  const list = Array.isArray(slot.opps) && slot.opps.length ? slot.opps : (slot.opp ? [slot.opp] : []);
  return list.filter(validOppQuote);
}

// Fair price for a Promo leg. No selection: the stored best (slot.opp).
// With a Matching books selection: the best exchange No among selected
// venues, else a selected de-vig book. An unselected venue never prices a leg.
// Fliff and Courtside are never a fair source.
// Venues whose stored No ladders are merged for the Promo $500 depth blend.
// Underdog stays top-of-book (no ladder), same as game lines.
const PLAYER_TD_LADDER_VENUES = Object.freeze(['kalshi', 'polymarket']);
const MAX_MERGED_LADDER_LEVELS = 24;

// One combined No ask book across the given candidates' ladders, best
// (highest American) first. Each level is { american, size } with size the
// dollar stake at that fee-adjusted price.
function mergeNoLadders(candidates) {
  const levels = [];
  for (const quote of candidates || []) {
    if (!quote || !PLAYER_TD_LADDER_VENUES.includes(quote.book) || !Array.isArray(quote.levels)) continue;
    for (const lvl of quote.levels) {
      const american = Number(lvl && lvl.american);
      const size = Number(lvl && lvl.size);
      if (!Number.isFinite(american) || american === 0 || !Number.isFinite(size) || size <= 0) continue;
      levels.push({ american, size, book: quote.book });
    }
  }
  levels.sort((a, b) => b.american - a.american);
  return levels.slice(0, MAX_MERGED_LADDER_LEVELS);
}

function pickPlayerTdOpp(slot, matchingBooks) {
  if (!slot) return null;
  const selected = normalizeBookSet(matchingBooks);
  const candidates = playerTdOppCandidates(slot);
  const allowed = selected ? candidates.filter((quote) => selected.has(quote.book)) : candidates;
  let best = null;
  let count = 1;
  if (!selected) {
    if (!validOppQuote(slot.opp)) return null;
    best = slot.opp;
    count = slot.opp.count || 1;
  } else {
    if (!allowed.length) return null;
    const exchange = allowed.filter((quote) => quote.source !== 'devig');
    const pool = exchange.length ? exchange : allowed;
    for (const quote of pool) {
      if (!best || Number(quote.price) > Number(best.price)) best = quote;
    }
    count = exchange.length ? exchange.length : (best.count || 1);
  }
  const out = { ...best, count };
  delete out.levels;
  // Depth blend only when an exchange ladder venue priced the leg.
  if (PLAYER_TD_LADDER_VENUES.includes(out.book) && out.source !== 'devig') {
    const merged = mergeNoLadders(allowed.filter((quote) => quote.source !== 'devig'));
    if (merged.length) out.levels = merged;
    else if (Array.isArray(best.levels) && best.levels.length) out.levels = best.levels;
  }
  return out;
}

function playerTdLegsForBook(playerTds, book, opts) {
  const options = opts || {};
  const sportFilter = options.sportFilter || null;
  const dateRange = options.dateRange || 'any';
  const now = options.now != null ? Number(options.now) : Date.now();
  const inRange = options.isWithinDateRange || (() => true);
  const inBounds = options.passesOddsBounds || ((price) => price != null);
  const resolveOpp = options.resolveOpp || ((args) => ({
    bestOpp: args && args.trustedOpp,
    bestOppBook: args && args.trustedBook,
    bestOppCount: args && args.trustedCount,
    bestOppSize: args && args.trustedSize != null ? args.trustedSize : null,
  }));
  const underdogStale = options.underdogIsStale || (() => false);
  // Optional Matching books selection (Set or array of book keys).
  const matchingBooks = normalizeBookSet(options.matchingBooks);
  const legs = [];
  for (const game of playerTds || []) {
    if (!game) continue;
    const commence = game.commence_time;
    if (!kickoffInPlayerTdWindow(commence, now)) continue;
    if (commence && !inRange(commence, dateRange)) continue;
    if (sportFilter && !sportFilter.includes(game.sport)) continue;
    const spec = playerPropSpec(game.sport);
    if (!spec) continue;
    const matchup = `${game.away} @ ${game.home}`;
    for (const player of game.players || []) {
      const markets = player && player.markets;
      if (!markets) continue;
      for (const market of spec.markets) {
        const slot = markets[market];
        if (!slot || playerTdBookExcluded(book)) continue;
        const opp = pickPlayerTdOpp(slot, matchingBooks);
        if (!opp) continue;
        const offer = (slot.offers || []).find((row) => row && row.book === book && row.price != null && !playerTdBookExcluded(row.book));
        if (!offer) continue;
        if (book === 'underdog_predict' && underdogStale(offer.updatedAt, now)) continue;
        if (!inBounds(offer.price, options.minLegOdds, options.maxLegOdds)) continue;
        const oppSize = Number(opp.size);
        const resolved = resolveOpp({
          trustedOpp: opp.price,
          trustedBook: opp.book,
          trustedCount: opp.count || 1,
          trustedSize: Number.isFinite(oppSize) && oppSize > 0 ? oppSize : null,
          sameBookOpp: null,
          sameBookKey: book,
          bookOdds: offer.price,
        }) || {};
        if (resolved.bestOpp == null) continue;
        const name = legName(player.name, market);
        const leg = {
          name,
          dk: offer.price,
          market: spec.legMarket,
          // playerTd marks every player-prop leg (TD and HR): Promo scoping,
          // Underdog freshness and same-game correlation key off it.
          playerTd: true,
          playerProp: spec.kind,
          tdMarket: market,
          tdGameKey: game.gameKey || matchup,
          game: matchup,
          commence_time: commence,
          sport: game.sport,
          bookKey: book,
          bestOppName: `${player.name} No ${MARKET_LABEL[market] || ''}`.trim(),
          isAlt: false,
          bestOpp: resolved.bestOpp,
          bestOppBook: resolved.bestOppBook,
          bestOppCount: resolved.bestOppCount,
          bestOppSize: resolved.bestOppSize ?? null,
          fairSource: opp.source || null,
        };
        // Combined Kalshi + Polymarket No ladder (dollar stake per level) so
        // the $500 depth blend runs without a live depth call.
        if (Array.isArray(opp.levels) && opp.levels.length && resolved.bestOppBook === opp.book && resolved.bestOpp === opp.price) {
          leg.bestOppLevels = opp.levels;
        }
        if (book === 'underdog_predict') {
          leg.predictionAmerican = offer.price;
          leg.bookUpdatedAt = quoteUpdatedMs(offer.updatedAt);
        } else if (offer.updatedAt) {
          leg.bookUpdatedAt = quoteUpdatedMs(offer.updatedAt);
        }
        legs.push(leg);
      }
    }
  }
  return legs;
}

function thresholdFromLine(line, label) {
  const n = Number(line);
  if (n === 1 || n === 0.5) return 'anytime';
  if (n === 2 || n === 1.5) return 'two';
  if (n === 3 || n === 2.5) return 'three';
  const text = String(label || '');
  if (/^1\+/.test(text)) return 'anytime';
  if (/^2\+/.test(text)) return 'two';
  if (/^3\+/.test(text)) return 'three';
  return null;
}

function emptyPriceCell() {
  return { kalshi: null, polymarket: null, underdog_predict: null, best: null, bestBook: null };
}

function putCellPrice(cell, book, american) {
  const price = parseAmerican(american);
  if (price == null) return;
  if (book !== 'kalshi' && book !== 'polymarket' && book !== 'underdog_predict') return;
  const prev = cell[book];
  if (prev == null || price > prev) cell[book] = price;
}

function finishCell(cell) {
  const quotes = ['kalshi', 'polymarket', 'underdog_predict']
    .filter((book) => cell[book] != null)
    .map((book) => ({ book, price: cell[book] }));
  const best = bestAmericanQuote(quotes);
  cell.best = best ? best.price : null;
  cell.bestBook = best ? best.book : null;
  return cell;
}

function boardFromQuotes(quotes) {
  const games = new Map();
  for (const quote of quotes || []) {
    if (!quote || !quote.gameKey || !quote.player || !quote.market) continue;
    if (!ENABLED_TD_MARKETS.includes(quote.market)) continue;
    if (quote.yesAmerican == null) continue;
    let game = games.get(quote.gameKey);
    if (!game) {
      game = {
        gameKey: quote.gameKey,
        away: quote.awayName || teamDisplayName(quote.away, quote.away),
        home: quote.homeName || teamDisplayName(quote.home, quote.home),
        awayAbbr: quote.away || '',
        homeAbbr: quote.home || '',
        commence: null,
        sources: [],
        players: new Map(),
      };
      games.set(quote.gameKey, game);
    } else {
      if (quote.awayName && quote.awayName.length > String(game.away || '').length) game.away = quote.awayName;
      if (quote.homeName && quote.homeName.length > String(game.home || '').length) game.home = quote.homeName;
    }
    if (quote.commence) game.sources.push({ book: quote.book, commence: quote.commence });
    const norm = normalizePlayerName(quote.player);
    let player = null;
    for (const existing of game.players.values()) {
      if (!samePlayer(existing.name, quote.player)) continue;
      if (!teamsCompatible(existing.team, quote.team)) continue;
      player = existing;
      break;
    }
    if (!player) {
      player = {
        name: quote.player,
        team: canonAbbr(quote.team) || '',
        anytime: emptyPriceCell(),
        two: emptyPriceCell(),
        first: emptyPriceCell(),
      };
      game.players.set(`${canonAbbr(quote.team) || ''}|${norm}|${game.players.size}`, player);
    } else if (String(quote.player).length > String(player.name).length) {
      player.name = quote.player;
    }
    if (!player.team && quote.team) player.team = canonAbbr(quote.team);
    putCellPrice(player[quote.market], quote.book, quote.yesAmerican);
  }
  const list = [...games.values()].map((game) => ({
    gameKey: game.gameKey,
    away: game.away,
    home: game.home,
    awayAbbr: game.awayAbbr,
    homeAbbr: game.homeAbbr,
    commence: (() => {
      const kick = canonicalKickoffMs(game.sources);
      return kick == null ? null : new Date(kick).toISOString();
    })(),
    players: [...game.players.values()].map((player) => ({
      name: player.name,
      team: player.team,
      anytime: finishCell(player.anytime),
      two: finishCell(player.two),
      first: finishCell(player.first),
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }));
  list.sort((a, b) => String(a.commence || '').localeCompare(String(b.commence || '')) || String(a.gameKey).localeCompare(String(b.gameKey)));
  return list;
}

export {
  MLB_PROP_SPORT,
  NFL_PROP_SPORT,
  HR_MARKETS,
  PLAYER_PROP_SPECS,
  PLAYER_PROP_SPORTS,
  playerPropSpec,
  MLB_TEAMS,
  canonMlbAbbr,
  mlbAbbrFromName,
  splitMlbTeamCode,
  mlbGameKeyOf,
  mlbGameKeyFromTeams,
  easternWallClockToIso,
  parseKalshiHrTicker,
  pairKeyFromMlbSlug,
  mlbSlugFromTeams,
  hrMarketFromLine,
  MLB_COMMENCE_TOLERANCE_MS,
  commenceCompatible,
  startsLaterTodayEt,
  TAKER_FEE_RATE,
  TD_MARKETS,
  ENABLED_TD_MARKETS,
  PLAYER_TD_EXCLUDED_BOOKS,
  playerTdBookExcluded,
  PLAYER_TD_LOOKAHEAD_MS,
  MARKET_LABEL,
  canonAbbr,
  nflAbbrFromName,
  teamDisplayName,
  splitTeamCode,
  teamsFromKalshiGameToken,
  gameKeyOf,
  gameKeyFromTeams,
  pairKeyFromSlug,
  slugFromTeams,
  slugFromGameKey,
  easternDate,
  parseKalshiTdTicker,
  playerNameFromKalshiTitle,
  normalizePlayerName,
  samePlayer,
  samePlayerInGame,
  asUnitProb,
  impliedFromAmerican,
  americanFromProb,
  parseAmerican,
  takerFeeRate,
  effectiveTakerPrice,
  boardYesAmerican,
  noAskAmericanFromYesBid,
  fairYesAmericanFromNo,
  devigTwoWay,
  bestAmericanQuote,
  quoteIsOlderThan,
  quoteUpdatedMs,
  promoLegsCorrelate,
  conflictsWithAny,
  legName,
  playerTdsFromCacheRows,
  playerTdLegsForBook,
  playerTdOppCandidates,
  pickPlayerTdOpp,
  mergeNoLadders,
  PLAYER_TD_LADDER_VENUES,
  thresholdFromLine,
  boardFromQuotes,
  kickoffInPlayerTdWindow,
  canonicalKickoffMs,
  formatKickoffEt,
  KALSHI_KICKOFF_LATE_MS,
  selectPlayerTdQuotes,
};
