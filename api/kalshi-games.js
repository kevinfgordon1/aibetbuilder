// ─────────────────────────────────────────────────────────────────────────
// api/kalshi-games.js — same-origin feed of Kalshi single-game markets for the
// Combo Locks tab. Proxies Kalshi (public, keyless) so the browser avoids CORS.
//
// Pulls three series per sport and groups them under one game key:
//   MLB   side=KXMLBGAME    spread=KXMLBSPREAD   total=KXMLBTOTAL
//   NFL   side=KXNFLGAME    spread=KXNFLSPREAD   total=KXNFLTOTAL
//   NCAAF side=KXNCAAFGAME  spread=KXNCAAFSPREAD total=KXNCAAFTOTAL
//   NHL   side=KXNHLGAME    spread=KXNHLSPREAD   total=KXNHLTOTAL
//   NBA   side=KXNBAGAME    spread=KXNBASPREAD   total=KXNBATOTAL
// Series tickers were confirmed against the live Kalshi series catalog; if a
// type 404s later, that ladder is simply empty (moneyline still ships).
// All share the game key `<SERIES>-<DATE[TIME]><TEAMS>` (group on the part after
// the series prefix). MLB keys include HHMM (e.g. 26AUG071840TORPHI); NFL/NCAAF/NHL
// keys are date-only (e.g. 26SEP09NESEA, 26SEP03MASSRUTG, 26SEP30PITPHI).
// NHL spreads are the puck line ("Toronto wins by over 1.5 goals" -> Toronto -1.5 /
// New York I +1.5; Kalshi lists 1.5 and 2.5) and totals run Over 1.5..9.5 goals.
// Goals in overtime count; a shootout decides the game as ONE goal for the winner
// (Kalshi HOCKEYTOTALS rules_secondary), so a shootout game never pushes a .5 line.
//
// Kalshi lists only ONE side of each spread/total as a market; the OTHER side is
// that market's NO. We expand every market into BOTH selectable legs with clean
// labels so a leg carries the exact (ticker, side) an RFQ will contain:
//   total "Over 7.5 runs scored"          -> Over 7.5 (yes) / Under 7.5 (no)
//   spread "Philadelphia wins by over 1.5" -> Philadelphia −1.5 (yes) / opponent +1.5 (no)
// NFL spread titles use abbreviated names ("SF 49ers wins by over 8.5 points")
// while moneyline labels are cities ("San Francisco", "Arizona"). The opponent
// is the other moneyline team by ticker code (SF9 → SF), not the first city
// whose name isn't an exact string match — that mislabeled every NO as the
// first side (San Francisco +8.5) and dropped Arizona +8.5.
//
// IDENTITY ONLY — no prices/odds. CJS (api/package.json commonjs).
// Also proxies GET /markets/{ticker} when called as /api/kalshi-games?tickers=A,B
// so Combo Locks can show official combo settlement (status/result) without CORS.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const COMBO_COLLECTION = process.env.KALSHI_COMBO_COLLECTION || 'KXMVESPORTSMULTIGAMEEXTENDED-R';
const MARKET_SERIES = {
  mlb: { side: 'KXMLBGAME', spread: 'KXMLBSPREAD', total: 'KXMLBTOTAL' },
  nfl: { side: 'KXNFLGAME', spread: 'KXNFLSPREAD', total: 'KXNFLTOTAL' },
  ncaaf: { side: 'KXNCAAFGAME', spread: 'KXNCAAFSPREAD', total: 'KXNCAAFTOTAL' },
  nhl: { side: 'KXNHLGAME', spread: 'KXNHLSPREAD', total: 'KXNHLTOTAL' },
  // NBA (verified Oct 19 2026 against live Kalshi: KXNBAGAME-26OCT20OKCSAS,
  // KXNBASPREAD-...-OKC5 "Oklahoma City wins by over 4.5 points", KXNBATOTAL-...-232).
  nba: { side: 'KXNBAGAME', spread: 'KXNBASPREAD', total: 'KXNBATOTAL' },
  // Soccer: 3-way regulation result (90' + stoppage; no extra time/penalties).
  // Moneyline only — each event lists <TEAM A>, <TEAM B> and TIE (shown as "Draw").
  mls: { side: 'KXMLSGAME' },
  epl: { side: 'KXEPLGAME' },
  laliga: { side: 'KXLALIGAGAME' },
  seriea: { side: 'KXSERIEAGAME' },
  bundesliga: { side: 'KXBUNDESLIGAGAME' },
  ligue1: { side: 'KXLIGUE1GAME' },
  ucl: { side: 'KXUCLGAME' },
  // UFC: one event per fight, two markets (one per fighter). Moneyline only.
  ufc: { side: 'KXUFCFIGHT' },
};
const SOCCER_SPORTS = new Set(['mls', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl']);
// Player props ride on the same game key (KXMLBHR-26OCT031600ATLLAD,
// KXNFLTD-26OCT05ATLNO, KXNHLGOAL-26OCT06FLALA) and only ever attach to a game
// that already has its moneyline pair. Only the 1+ rung of a named player is
// exposed (MLB 1+ HR, NFL anytime TD, NHL anytime goal); label stays Kalshi's
// own "Matt Olson: 1+" / "Trevor Moore: 1+" because the combo-worker's
// Polymarket prop crosswalk verifies that exact string.
const PROP_SERIES = {
  mlb: { series: 'KXMLBHR', kind: 'hr' },
  nfl: { series: 'KXNFLTD', kind: 'td' },
  nhl: { series: 'KXNHLGOAL', kind: 'goal' },
};
// NHL keys are date-only (26SEP30PITPHI) but every market's occurrence_datetime is
// puck drop + 3h (checked against ESPN's scoreboard: 46 of 47 listed games), so the
// real start is occurrence - 3h. Used for the pre-game cutoff so a 7:30 PM game
// drops at puck drop instead of lingering until midnight ET.
// UFC occurrence_datetime sits ~3.5-4h after the fight's walkout (checked against
// Odds API commence times, Oct 17 2026 card), so 4h back is the start estimate.
// NBA occurrence_datetime is also tip-off + 3h (KXNBAGAME-26OCT20OKCSAS 04:30Z for a
// 9:30 PM ET tip; KXNBAGAME-26OCT20BOSDET likewise).
const OCCURRENCE_START_OFFSET_MS = { nhl: 3 * 3600 * 1000, nba: 3 * 3600 * 1000, ufc: 4 * 3600 * 1000 };
// NFL / college football occurrence_datetime is kickoff + 3h (Oct 19 2026: every
// KXNCAAFGAME with a real time sat exactly 3.0h after ESPN's and the odds feed's
// kickoff, e.g. Missouri St. vs Delaware 10 PM vs 7 PM ET; KXNFLGAME-26OCT19WASSF
// 03:15Z for an 8:15 PM ET kickoff). Mis-dated games use a 03:00Z placeholder, so
// ESPN's kickoff wins whenever ESPN lists the game (see groupSportGames).
const FOOTBALL_OCCURRENCE_OFFSET_MS = 3 * 3600 * 1000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// Combo Locks settlement: GET /api/kalshi-games?tickers=A,B returns official
// market status/result (public, keyless). Tickers are Kalshi market ids only.
const TICKER_RE = /^[A-Za-z0-9]+-[A-Za-z0-9_-]{1,70}$/;
function tickersFromReq(req) {
  let raw = '';
  if (req && req.query) {
    const q = req.query.tickers || req.query.ticker || '';
    raw = Array.isArray(q) ? q.join(',') : String(q);
  }
  if (!raw && req && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      raw = u.searchParams.get('tickers') || u.searchParams.get('ticker') || '';
    } catch (_) {}
  }
  return [...new Set(String(raw).split(/[,\s]+/).map((s) => s.trim()).filter((s) => TICKER_RE.test(s)))].slice(0, 25);
}
function slimMarket(market) {
  if (!market || !market.ticker) return null;
  return {
    ticker: market.ticker,
    status: market.status || null,
    result: market.result == null ? '' : String(market.result),
  };
}
async function fetchMarketSettlements(tickers) {
  const markets = {};
  await Promise.all((tickers || []).map(async (ticker) => {
    const data = await fetchJson(`${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}`);
    const slim = slimMarket(data && data.market);
    if (slim) markets[slim.ticker] = slim;
  }));
  return markets;
}

const gameKeyOf = (t) => { const i = String(t || '').indexOf('-'); return i === -1 ? t : t.slice(i + 1); };
const marketLabel = (m) => m.yes_sub_title || m.subtitle || m.title || m.ticker;

// Game start (UTC ms) from the key's leading YYMONDD[HHMM], interpreted as US Eastern —
// Kalshi tickers + market rules_primary use ET (e.g. MLB "...071840..." = Aug 7 at
// 6:40 PM EDT). NFL/NCAAF keys omit HHMM (e.g. 26SEP09NESEA) — those resolve to the
// start of that ET calendar day. NOTE: occurrence_datetime / expected_expiration_time
// are the game END/settlement (~3h later) on MLB, so they are not used for the
// pre-game cutoff. Returns NaN if unparseable.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function etWallToUtcMs(y, mon, d, hh, mm) {
  const asUTC = Date.UTC(y, mon, d, hh, mm);
  // Shift the ET wall-clock time to true UTC using the America/New_York offset at that instant (handles EDT/EST).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(asUTC));
  const p = {}; parts.forEach((x) => (p[x.type] = x.value));
  const etAsIfUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUTC + (asUTC - etAsIfUTC);
}
function firstPitchUtcMs(gameKey) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})/.exec(gameKey || '');
  if (!m) return NaN;
  const y = 2000 + Number(m[1]), mon = MONTHS[m[2]], d = Number(m[3]), hh = Number(m[4]), mm = Number(m[5]);
  if (mon == null) return NaN;
  return etWallToUtcMs(y, mon, d, hh, mm);
}
function dateOnlyUtcMs(gameKey) {
  if (Number.isFinite(firstPitchUtcMs(gameKey))) return NaN;
  const m = /^(\d{2})([A-Z]{3})(\d{2})(?![0-9])/.exec(gameKey || '');
  if (!m) return NaN;
  const y = 2000 + Number(m[1]), mon = MONTHS[m[2]], d = Number(m[3]);
  if (mon == null) return NaN;
  return etWallToUtcMs(y, mon, d, 0, 0);
}
function gameStartUtcMs(gameKey) {
  const timed = firstPitchUtcMs(gameKey);
  if (Number.isFinite(timed)) return timed;
  return dateOnlyUtcMs(gameKey);
}
function isUpcomingGame(gameKey, nowMs) {
  const timed = firstPitchUtcMs(gameKey);
  if (Number.isFinite(timed)) return timed > nowMs;
  const dayStart = dateOnlyUtcMs(gameKey);
  if (!Number.isFinite(dayStart)) return false;
  // Date-only football keys: keep the slate through the end of that ET day.
  return dayStart + 24 * 3600 * 1000 > nowMs;
}
function occurrenceMsOf(ev) {
  let best = Infinity;
  for (const m of ev && ev.markets || []) {
    const t = Date.parse(m.occurrence_datetime);
    if (Number.isFinite(t) && t < best) best = t;
  }
  return best === Infinity ? NaN : best;
}

// ── player props ──
// Kalshi yes_sub_title is "<Full Name>: 1+". Anything else (2+, 3+, D/ST team
// defenses, blank names) is not exposed — skip, never guess.
function parsePropLabel(label) {
  const m = /^(.+?):\s*1\+\s*$/.exec(String(label || '').trim());
  if (!m) return null;
  const name = m[1].trim();
  if (!name || /D\/ST/i.test(name)) return null;
  return { name };
}
function expandProps(raw, kind) {
  const seen = new Set();
  const legs = [];
  for (const m of raw || []) {
    if (!m || !m.ticker || !/-1$/.test(m.ticker) || seen.has(m.ticker)) continue;
    if (m.status && !/^(active|open)$/i.test(m.status)) continue;
    const p = parsePropLabel(m.label);
    if (!p) continue;
    seen.add(m.ticker);
    legs.push({ ticker: m.ticker, side: 'yes', label: `${p.name}: 1+`, player: p.name, kind });
  }
  return legs.sort((a, b) => a.player.localeCompare(b.player) || a.ticker.localeCompare(b.ticker));
}

// ── label parsers (validated against Kalshi's real strings in the test) ──
function parseTotal(label) {
  const m = /over\s+([\d.]+)/i.exec(label || '');
  return m ? { line: m[1] } : null;
}
function parseSpread(label) {
  const m = /^(.*?)\s+wins by over\s+([\d.]+)/i.exec(label || '');
  return m ? { team: m[1].trim(), line: m[2] } : null;
}

function normTeamLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tickerTail(ticker) {
  const s = String(ticker || '');
  const i = s.lastIndexOf('-');
  return i === -1 ? s : s.slice(i + 1);
}
// Spread suffixes are <TEAM><strike> (SF9 = SF wins by over 8.5, ARI10, RUTG36).
// Moneyline suffixes are the team code alone (SF, ARI, RUTG).
function teamCodeOf(tail) {
  const m = /^([A-Z]+)(\d*)$/.exec(String(tail || '').toUpperCase());
  return m ? m[1] : '';
}
function sideRoster(teamNamesOrSides) {
  const codeToName = {};
  const names = [];
  for (const s of teamNamesOrSides || []) {
    const label = typeof s === 'string' ? s : (s && s.label) || '';
    const ticker = typeof s === 'string' ? '' : (s && s.ticker) || '';
    if (label) names.push(label);
    const code = teamCodeOf(tickerTail(ticker));
    if (code && label && !codeToName[code]) codeToName[code] = label;
  }
  return { codeToName, names };
}
function nameHit(favLabel, names) {
  const favNorm = normTeamLabel(favLabel);
  if (!favNorm) return null;
  const exact = (names || []).find((n) => normTeamLabel(n) === favNorm);
  if (exact) return exact;
  return (names || []).find((n) => {
    const nn = normTeamLabel(n);
    return nn && (favNorm.includes(nn) || nn.includes(favNorm));
  }) || null;
}

// ── expand raw markets into both-side legs ──
function expandTotals(raw) {
  const legs = [];
  for (const m of raw) {
    const p = parseTotal(m.label);
    if (!p) { legs.push({ ticker: m.ticker, side: 'yes', label: m.label }); continue; } // fallback: raw yes
    legs.push({ ticker: m.ticker, side: 'yes', label: `Over ${p.line}`, sort: parseFloat(p.line) });
    legs.push({ ticker: m.ticker, side: 'no',  label: `Under ${p.line}`, sort: parseFloat(p.line) + 0.001 });
  }
  return legs.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
function expandSpreads(raw, teamNamesOrSides) {
  const { codeToName, names } = sideRoster(teamNamesOrSides);
  const codes = Object.keys(codeToName);
  const favoriteName = (favLabel, favCode) => {
    if (favCode && codeToName[favCode]) return codeToName[favCode];
    return nameHit(favLabel, names) || favLabel;
  };
  // Opponent is the other moneyline team. Exact string inequality against the
  // abbreviated spread title ("SF 49ers" !== "San Francisco") used to pick
  // whichever city was listed first and stamp that name on every NO leg.
  const opponentName = (favLabel, favCode) => {
    if (favCode && codeToName[favCode] && codes.length >= 2) {
      const otherCode = codes.find((c) => c !== favCode);
      if (otherCode && codeToName[otherCode]) return codeToName[otherCode];
    }
    const fav = nameHit(favLabel, names);
    if (fav) {
      const other = names.find((n) => n !== fav);
      if (other) return other;
    }
    return 'Other';
  };
  const legs = [];
  for (const m of raw) {
    const p = parseSpread(m.label);
    if (!p) { legs.push({ ticker: m.ticker, side: 'yes', label: m.label }); continue; }
    const favCode = teamCodeOf(tickerTail(m.ticker));
    const fav = favoriteName(p.team, favCode);
    const dog = opponentName(p.team, favCode);
    legs.push({ ticker: m.ticker, side: 'yes', label: `${fav} \u2212${p.line}`, sort: parseFloat(p.line) });
    legs.push({ ticker: m.ticker, side: 'no',  label: `${dog} +${p.line}`, sort: parseFloat(p.line) + 0.001 });
  }
  return legs.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

// A page that fails (Kalshi 429 / timeout under the parallel fan-out) used to
// read as "no events", so a whole sport could vanish from the slate and that
// empty slate was then CDN-cached. Each page now retries, and a series whose
// first page never loads is reported as failed (`events.failed = true`).
async function fetchJsonRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const data = await fetchJson(url);
    if (data) return data;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.floor(Math.random() * 300)));
  }
  return null;
}
async function fetchSeriesEvents(seriesTicker, fetchFn = fetchJsonRetry) {
  const events = []; let cursor = '';
  for (let page = 0; page < 6; page++) {
    const url = `${KALSHI_BASE}/events?series_ticker=${encodeURIComponent(seriesTicker)}` +
      `&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await fetchFn(url);
    if (!data) { events.failed = true; break; }
    (data.events || []).forEach(e => events.push(e));
    cursor = data.cursor || ''; if (!cursor) break;
  }
  return events;
}

// ── ESPN kickoff rescue for mis-dated football tickers ──
// Kalshi sometimes keys a Saturday college game under Friday's date with the
// 03:00Z placeholder time (Oct 17 2026: KXNCAAFGAME-26OCT16MIZZMISS for
// Missouri at Ole Miss, 3:30 PM ET Sat, plus ~35 more). The key-day cutoff then
// drops a game that has not started. A dropped date-only football game is
// kept ONLY when ESPN lists the same two teams as not yet started ("pre") with
// a kickoff in the future, within 3 days after the key date; its startTime
// becomes ESPN's kickoff. Anything ESPN shows as started/final, or cannot
// match, stays dropped — never quote a started game.
const ESPN_FOOTBALL = {
  nfl: ['https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'],
  ncaaf: [
    'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=500',
    'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=81&limit=500',
  ],
};
// Kalshi label -> ESPN name where the words differ (normalized form on both sides).
const ESPN_NAME_ALIASES = { 'university at albany': 'ualbany', albany: 'ualbany' };
function normTeam(s) {
  const n = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '').replace(/\bst\.?(?=\s|$)/g, 'state').replace(/[^a-z0-9]+/g, ' ').trim();
  return ESPN_NAME_ALIASES[n] || n;
}
function espnGamesFrom(body) {
  const out = [];
  for (const e of (body && body.events) || []) {
    const c = e && e.competitions && e.competitions[0];
    const state = e && e.status && e.status.type && e.status.type.state;
    const ms = Date.parse((c && c.date) || e.date);
    if (!c || !Number.isFinite(ms)) continue;
    const teams = (c.competitors || []).map((x) => {
      const t = x.team || {};
      return {
        abbr: String(t.abbreviation || '').toUpperCase(),
        names: [t.location, t.shortDisplayName, t.displayName, t.name && t.location ? `${t.location} ${t.name}` : '', t.nickname]
          .map(normTeam).filter(Boolean),
      };
    });
    if (teams.length === 2) out.push({ id: e.id, kickoffMs: ms, state: state || '', teams });
  }
  return out;
}
function sideMatchesEspnTeam(side, team) {
  const n = normTeam(side.label);
  const code = teamCodeOf(tickerTail(side.ticker));
  return (n && team.names.includes(n)) || (!!code && code === team.abbr);
}
// The one ESPN game with the same two teams kicking off within 4 days after the key date
// (any state), else null (none or ambiguous).
function espnMatchFor(rawSides, espnGames, keyDayMs) {
  const sides = (rawSides || []).filter((s) => !/-TIE$/i.test(s.ticker));
  if (sides.length !== 2 || !Number.isFinite(keyDayMs)) return null;
  const hits = (espnGames || []).filter((eg) => {
    if (!(eg.kickoffMs >= keyDayMs && eg.kickoffMs < keyDayMs + 4 * 24 * 3600 * 1000)) return false;
    const [a, b] = sides;
    return (sideMatchesEspnTeam(a, eg.teams[0]) && sideMatchesEspnTeam(b, eg.teams[1]))
      || (sideMatchesEspnTeam(a, eg.teams[1]) && sideMatchesEspnTeam(b, eg.teams[0]));
  });
  return hits.length === 1 ? hits[0] : null;
}
function espnKickoffFor(rawSides, espnGames, keyDayMs, nowMs) {
  const hit = espnMatchFor(rawSides, espnGames, keyDayMs);
  if (!hit || hit.state !== 'pre' || !(hit.kickoffMs > nowMs)) return null; // started / unmatched: stay dropped
  return hit.kickoffMs;
}
function etYmd(ms) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  return `${p.year}${p.month}${p.day}`;
}
// ESPN's scoreboard rejects date ranges for college football, so ask per ET
// day (today + next 7, so the whole week's kickoff times are known). Cached per
// warm instance for 60s.
const espnCache = new Map();
async function fetchEspnFootball(sport, nowMs = Date.now()) {
  const urls = ESPN_FOOTBALL[sport];
  if (!urls) return [];
  const hit = espnCache.get(sport);
  if (hit && nowMs - hit.at < 60000) return hit.games;
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => etYmd(nowMs + d * 24 * 3600 * 1000));
  const reqs = [];
  urls.forEach((u) => days.forEach((d) => reqs.push(`${u}${u.includes('?') ? '&' : '?'}dates=${d}`)));
  const bodies = await Promise.all(reqs.map((u) => fetchJsonRetry(u, 2)));
  const seen = new Set(); const out = [];
  bodies.forEach((b) => espnGamesFrom(b).forEach((g) => { if (!seen.has(g.id)) { seen.add(g.id); out.push(g); } }));
  if (out.length) espnCache.set(sport, { at: nowMs, games: out });
  return out;
}

// Kalshi sometimes files one game's series under different dates, e.g. Oct 17
// 2026: KXNCAAFGAME-26OCT16UKOKLA (moneyline, wrong day) but
// KXNCAAFSPREAD-26OCT17UKOKLA / KXNCAAFTOTAL-26OCT17UKOKLA. Grouping by the
// full key split them, so the moneyline game had no spreads/totals and the
// spread/total group (no moneyline pair) was dropped. For date-only keys,
// fold a group with no moneyline into the moneyline group with the same teams
// whose date is within one day. Only one candidate is accepted (no guessing).
const DATE_ONLY_KEY = /^(\d{2}[A-Z]{3}\d{2})(?!\d)([A-Z0-9]+)$/;
function mergeOffByOneDateKeys(byKey) {
  const sideByTeams = new Map();
  for (const g of byKey.values()) {
    const m = DATE_ONLY_KEY.exec(g.key);
    if (!m || g.raw.side.length < 2) continue;
    if (!sideByTeams.has(m[2])) sideByTeams.set(m[2], []);
    sideByTeams.get(m[2]).push(g);
  }
  for (const [key, g] of [...byKey.entries()]) {
    const m = DATE_ONLY_KEY.exec(key);
    if (!m || g.raw.side.length >= 2) continue;
    const day = dateOnlyUtcMs(key);
    const hosts = (sideByTeams.get(m[2]) || []).filter((h) => {
      const hd = dateOnlyUtcMs(h.key);
      return Number.isFinite(day) && Number.isFinite(hd) && Math.abs(hd - day) <= 26 * 3600 * 1000;
    });
    if (hosts.length !== 1) continue;
    const host = hosts[0];
    for (const t of ['spread', 'total', 'prop']) {
      if (!(g.raw[t] && g.raw[t].length)) continue;
      // Never mix two ladders: only fill a series the host is missing.
      if (host.raw[t] && host.raw[t].length) continue;
      host.raw[t] = g.raw[t].slice();
    }
    byKey.delete(key);
  }
}

function groupSportGames(eventsByType, nowMs = Date.now(), opts = {}) {
  const occOffset = Number(opts && opts.occurrenceStartOffsetMs) || 0;
  const byKey = new Map(); // key -> { key, title, date, occurrenceMs, raw:{side,spread,total} }
  for (const [type, events] of Object.entries(eventsByType || {})) {
    if (!events) continue;
    for (const ev of events) {
      const key = gameKeyOf(ev.event_ticker || ev.ticker); if (!key) continue;
      let g = byKey.get(key);
      if (!g) { g = { key, title: null, date: null, occurrenceMs: NaN, raw: { side: [], spread: [], total: [], prop: [] } }; byKey.set(key, g); }
      // Props never name the game or move its start: "<Away> vs <Home>: Home Runs"
      // is not a game title, and prop occurrence times differ from the game's.
      if (type !== 'prop' && (type === 'side' || !g.title)) { g.title = ev.title || g.title; g.date = ev.sub_title || g.date; }
      const occ = type === 'prop' ? NaN : occurrenceMsOf(ev);
      if (Number.isFinite(occ) && (!Number.isFinite(g.occurrenceMs) || occ < g.occurrenceMs)) g.occurrenceMs = occ;
      if (!g.raw[type]) g.raw[type] = [];
      (ev.markets || []).forEach(m => { if (m.ticker) g.raw[type].push({ ticker: m.ticker, label: type === 'prop' ? (m.yes_sub_title || '') : marketLabel(m), ...(type === 'prop' ? { status: m.status || '' } : {}) }); });
    }
  }
  mergeOffByOneDateKeys(byKey);
  const games = [];
  for (const g of byKey.values()) {
    if (g.raw.side.length < 2) continue; // needs a real moneyline pair
    // PRE-GAME: MLB (datetime key) drops once first pitch has passed. Football
    // (date-only key) stays through the end of that ET calendar day. NHL (date-only
    // key, but occurrence - 3h is the real puck drop) drops at puck drop.
    const exactOcc = occOffset > 0 && Number.isFinite(g.occurrenceMs) && !Number.isFinite(firstPitchUtcMs(g.key));
    let rescuedMs = NaN;
    // Football with an ESPN listing: ESPN's kickoff is the start (exact). Started on ESPN = drop.
    const footballOff = Number(opts && opts.footballOccurrenceOffsetMs) || 0;
    const espnHit = footballOff && opts.espnGames && !exactOcc && !Number.isFinite(firstPitchUtcMs(g.key))
      ? espnMatchFor(g.raw.side, opts.espnGames, dateOnlyUtcMs(g.key)) : null;
    if (espnHit) {
      if (espnHit.state !== 'pre' || !(espnHit.kickoffMs > nowMs)) continue;
      rescuedMs = espnHit.kickoffMs;
    } else if (exactOcc ? !(g.occurrenceMs - occOffset > nowMs) : !isUpcomingGame(g.key, nowMs)) {
      const keyDay = dateOnlyUtcMs(g.key);
      const k = opts && opts.espnGames && Number.isFinite(keyDay) && !exactOcc
        ? espnKickoffFor(g.raw.side, opts.espnGames, keyDay, nowMs) : null;
      if (!k) continue;
      rescuedMs = k;
    }
    const timed = firstPitchUtcMs(g.key);
    // Soccer occurrence_datetime is settlement (hours after full time), so use the ET day.
    const startMs = Number.isFinite(rescuedMs) ? rescuedMs
      : Number.isFinite(timed) ? timed
      : (opts && opts.dateOnlyStart) ? dateOnlyUtcMs(g.key)
      : exactOcc ? g.occurrenceMs - occOffset
        : (Number.isFinite(g.occurrenceMs) ? g.occurrenceMs - footballOff : dateOnlyUtcMs(g.key));
    if (!Number.isFinite(startMs)) continue;
    games.push({
      key: g.key, title: g.title,
      // ESPN kickoff: Kalshi's "(Oct 16)" can be the wrong day; show ESPN's kickoff day.
      date: Number.isFinite(rescuedMs) && g.date
        ? String(g.date).replace(/\([A-Z][a-z]{2} \d{1,2}\)\s*$/, `(${new Date(rescuedMs).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })})`)
        : g.date,
      startTime: new Date(startMs).toISOString(),
      ...(exactOcc ? { startExact: true } : {}),
      ...(Number.isFinite(rescuedMs) ? { kickoffSource: 'espn', ...(espnHit ? { startExact: true } : {}) } : {}),
      markets: {
        side: g.raw.side.map(m => ({ ticker: m.ticker, side: 'yes', label: /-TIE$/i.test(m.ticker) ? 'Draw' : m.label })),
        spread: expandSpreads(g.raw.spread || [], g.raw.side),
        total: expandTotals(g.raw.total || []),
        ...(opts && opts.propKind ? { prop: expandProps(g.raw.prop || [], opts.propKind) } : {}),
      },
    });
  }
  return games;
}

async function fetchSportGames(seriesByType, opts) {
  const eventsByType = {};
  const espnP = opts && opts.espnSport ? fetchEspnFootball(opts.espnSport).catch(() => []) : null;
  await Promise.all(Object.entries(seriesByType || {}).map(async ([type, series]) => {
    eventsByType[type] = await fetchSeriesEvents(series);
  }));
  const espnGames = espnP ? await espnP : null;
  const games = groupSportGames(eventsByType, Date.now(), { ...opts, ...(espnGames ? { espnGames } : {}) });
  // Moneyline series never loaded: the sport's slate is unknown, not empty.
  games.failed = !!(eventsByType.side && eventsByType.side.failed);
  return games;
}

// Combo eligibility: Kalshi only builds combos from events listed in the combo
// collection. A game whose moneyline event is missing there gets a 400
// invalid_parameters on Probe / RFQ, so flag it (null = unknown, fail open).
async function fetchCollectionEventSet(collection) {
  const data = await fetchJson(`${KALSHI_BASE}/multivariate_event_collections/${encodeURIComponent(collection)}`);
  const c = data && data.multivariate_contract;
  if (!c) return null;
  const set = new Set();
  (c.associated_event_tickers || []).forEach((t) => t && set.add(String(t).toUpperCase()));
  (c.associated_events || []).forEach((e) => e && e.ticker && set.add(String(e.ticker).toUpperCase()));
  return set.size ? set : null;
}
function markComboEligible(games, sideSeries, eventSet) {
  return (games || []).map((g) => ({
    ...g,
    comboEligible: eventSet ? eventSet.has(`${sideSeries}-${g.key}`.toUpperCase()) : null,
  }));
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const tickers = tickersFromReq(req);
    if (tickers.length) {
      const markets = await fetchMarketSettlements(tickers);
      res.status(200).json({ markets, updatedAt: new Date().toISOString() });
      return;
    }
    const sports = {};
    const failed = [];
    const eventSetP = fetchCollectionEventSet(COMBO_COLLECTION).catch(() => null);
    await Promise.all(Object.entries(MARKET_SERIES).map(async ([sport, seriesByType]) => {
      const propSpec = PROP_SERIES[sport];
      const games = await fetchSportGames(propSpec ? { ...seriesByType, prop: propSpec.series } : seriesByType, {
        occurrenceStartOffsetMs: OCCURRENCE_START_OFFSET_MS[sport] || 0,
        ...(SOCCER_SPORTS.has(sport) ? { dateOnlyStart: true } : {}),
        ...(propSpec ? { propKind: propSpec.kind } : {}),
        ...(ESPN_FOOTBALL[sport] ? { espnSport: sport, footballOccurrenceOffsetMs: FOOTBALL_OCCURRENCE_OFFSET_MS } : {}),
      });
      if (games.failed) failed.push(sport);
      sports[sport] = markComboEligible(games, seriesByType.side, await eventSetP).map((g) => ({ ...g, sport }));
    }));
    // Never let the CDN keep a slate with a sport missing for 3 minutes.
    if (failed.length) res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: new Date().toISOString(), sports, ...(failed.length ? { failed } : {}) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: null, sports: {}, error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports.MARKET_SERIES = MARKET_SERIES;
module.exports.PROP_SERIES = PROP_SERIES;
module.exports.SOCCER_SPORTS = SOCCER_SPORTS;
module.exports.OCCURRENCE_START_OFFSET_MS = OCCURRENCE_START_OFFSET_MS;
module.exports.FOOTBALL_OCCURRENCE_OFFSET_MS = FOOTBALL_OCCURRENCE_OFFSET_MS;
module.exports._helpers = {
  parseTotal, parseSpread, parsePropLabel, expandProps, expandTotals, expandSpreads, teamCodeOf, tickerTail,
  gameKeyOf, tickersFromReq, slimMarket,
  groupSportGames, mergeOffByOneDateKeys, markComboEligible, fetchSeriesEvents, espnGamesFrom, espnKickoffFor, espnMatchFor, fetchEspnFootball, normTeam, gameStartUtcMs, firstPitchUtcMs, dateOnlyUtcMs, isUpcomingGame,
};
