'use strict';

// Parse the love23 (DGS pay-per-head) /v1/sports/schedule payload.
//
// Shape (verified Oct 30 2026 with the test login):
//   [{ id: idLeague, name, sport: "NFL"|"CFB"|"NBA"|"NHL"|..., groups: [{ name, pd: "GAME", games: [row] }] }]
//   row: { id, link, kickoff (unix s), rot, vtm, htm, ap, apm, hp, hpm, ou, om, um, am, hm, dm, lt, cc, ... }
//     id === link and no " ALT n" suffix  -> main game (ML am/hm, spread ap/apm hp/hpm, total ou om/um)
//     "<TEAM> ALT n"                       -> alternate spread + total for game `link`
//     "<TEAM> TEAM TOTAL" (team-total leagues, e.g. 156) -> ou/om/um for that team, game `link`
//     "<PLAYER> (TEAM) - TOTAL POINTS" (prop leagues)    -> ou/om/um player prop
//   A price of 0 means "not offered".
// Bet leg id for reference only (we never place): {gameId}_{play}_{base}_{price},
// play 0 visitor spread, 1 home spread, 2 over, 3 under, 11 visitor ML, 12 home ML.

const SPORT_KEYS = Object.freeze({
  NFL: 'americanfootball_nfl',
  CFB: 'americanfootball_ncaaf',
  NBA: 'basketball_nba',
  NHL: 'icehockey_nhl',
  MLB: 'baseball_mlb',
});

// Main + team-total + prop leagues we read (full game only).
const DEFAULT_LEAGUE_IDS = Object.freeze([1, 156, 2, 954, 3, 97, 7, 110, 4021]);

const PARTIAL_GAME = /\b(1H|2H|1Q|2Q|3Q|4Q|1ST|2ND|3RD|PERIOD|HALF|QUARTER|INNING|F5|FCS)\b/i;

function cleanSport(s) { return String(s || '').trim().toUpperCase(); }

function leagueKind(league) {
  const name = String(league && league.name || '').toUpperCase();
  if (PARTIAL_GAME.test(name)) return null;
  if (/WNBA/.test(name)) return null;
  if (/PLAYER|PROPS?\b/.test(name)) return 'prop';
  if (/TEAM TOTAL/.test(name)) return 'team_total';
  return 'game';
}

function propStat(name) {
  const n = String(name || '').toUpperCase();
  if (/POINTS \+ REBS \+ ASSISTS/.test(n)) return 'player_points_rebounds_assists';
  if (/TOTAL POINTS/.test(n)) return 'player_points';
  if (/REBOUNDS/.test(n)) return 'player_rebounds';
  if (/ASSISTS/.test(n)) return 'player_assists';
  if (/3PTS|THREES/.test(n)) return 'player_threes';
  if (/RECEIVING YARDS/.test(n)) return 'player_reception_yds';
  if (/RUSHING YARDS/.test(n)) return 'player_rush_yds';
  if (/PASSING YARDS/.test(n)) return 'player_pass_yds';
  if (/PASSING TDS/.test(n)) return 'player_pass_tds';
  if (/RECEPTIONS/.test(n)) return 'player_receptions';
  return null;
}

function priceOk(p) {
  const n = Number(p);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) >= 100;
}

function legId(gameId, play, base, price) {
  return `${gameId}_${play}_${Number(base) || 0}_${price}`;
}

/**
 * Flatten the schedule into games (main rows) and selections (one per side we could bet).
 * Returns { games: Map(link -> game), selections: [...] }.
 */
function parseSchedule(payload) {
  const leagues = Array.isArray(payload) ? payload : [];
  const games = new Map();
  const pending = [];
  for (const lg of leagues) {
    const kind = leagueKind(lg);
    const sportKey = SPORT_KEYS[cleanSport(lg && lg.sport)];
    if (!kind || !sportKey) continue;
    for (const grp of (lg.groups || [])) {
      for (const row of (grp.games || [])) {
        if (!row || row.id == null) continue;
        const vtm = String(row.vtm || '').trim();
        const htm = String(row.htm || '').trim();
        const isAlt = /\sALT\s*\d+$/i.test(vtm) || /\sALT\s*\d+$/i.test(htm);
        const base = {
          sportKey,
          leagueId: lg.id,
          id: row.id,
          link: row.link != null ? row.link : row.id,
          kickoffMs: Number(row.kickoff) * 1000,
          rot: row.rot,
        };
        if (kind === 'game' && !isAlt && row.id === base.link) {
          games.set(base.link, { ...base, away: vtm, home: htm });
        }
        pending.push({ kind: kind === 'game' ? (isAlt ? 'alt' : (row.id === base.link ? 'main' : 'alt')) : kind, row, base, league: lg });
      }
    }
  }

  const selections = [];
  for (const { kind, row, base, league } of pending) {
    const game = games.get(base.link) || null;
    const common = {
      ...base,
      kind,
      gameLink: base.link,
      away: game ? game.away : String(row.vtm || '').replace(/\s+ALT\s*\d+$/i, ''),
      home: game ? game.home : String(row.htm || '').replace(/\s+ALT\s*\d+$/i, ''),
    };
    if (kind === 'main' || kind === 'alt') {
      if (kind === 'main' && priceOk(row.am) && priceOk(row.hm)) {
        selections.push({ ...common, market: 'h2h', side: 'away', team: common.away, point: null, american: row.am, oppAmerican: row.hm, legId: legId(row.id, 11, 0, row.am) });
        selections.push({ ...common, market: 'h2h', side: 'home', team: common.home, point: null, american: row.hm, oppAmerican: row.am, legId: legId(row.id, 12, 0, row.hm) });
      }
      if (priceOk(row.apm) && priceOk(row.hpm)) {
        selections.push({ ...common, market: 'spreads', side: 'away', team: common.away, point: Number(row.ap), american: row.apm, oppAmerican: row.hpm, legId: legId(row.id, 0, row.ap, row.apm) });
        selections.push({ ...common, market: 'spreads', side: 'home', team: common.home, point: Number(row.hp), american: row.hpm, oppAmerican: row.apm, legId: legId(row.id, 1, row.hp, row.hpm) });
      }
      if (priceOk(row.om) && priceOk(row.um) && Number(row.ou) > 0) {
        selections.push({ ...common, market: 'totals', side: 'over', team: null, point: Number(row.ou), american: row.om, oppAmerican: row.um, legId: legId(row.id, 2, row.ou, row.om) });
        selections.push({ ...common, market: 'totals', side: 'under', team: null, point: Number(row.ou), american: row.um, oppAmerican: row.om, legId: legId(row.id, 3, row.ou, row.um) });
      }
    } else if (kind === 'team_total') {
      if (priceOk(row.om) && priceOk(row.um) && Number(row.ou) > 0) {
        const team = String(row.vtm || '').replace(/\s+TEAM TOTAL.*$/i, '').trim();
        selections.push({ ...common, market: 'team_totals', side: 'over', team, point: Number(row.ou), american: row.om, oppAmerican: row.um, legId: legId(row.id, 2, row.ou, row.om) });
        selections.push({ ...common, market: 'team_totals', side: 'under', team, point: Number(row.ou), american: row.um, oppAmerican: row.om, legId: legId(row.id, 3, row.ou, row.um) });
      }
    } else if (kind === 'prop') {
      const stat = propStat(league && league.name);
      const m = /^(.*?)\s*\(([^)]+)\)/.exec(String(row.vtm || ''));
      if (stat && m && priceOk(row.om) && priceOk(row.um) && Number(row.ou) > 0) {
        const player = m[1].trim();
        const teamAbbr = m[2].trim();
        selections.push({ ...common, game: null, away: null, home: null, market: stat, side: 'over', player, teamAbbr, point: Number(row.ou), american: row.om, oppAmerican: row.um, legId: legId(row.id, 2, row.ou, row.om) });
        selections.push({ ...common, game: null, away: null, home: null, market: stat, side: 'under', player, teamAbbr, point: Number(row.ou), american: row.um, oppAmerican: row.om, legId: legId(row.id, 3, row.ou, row.um) });
      }
    }
  }
  return { games, selections };
}

module.exports = { parseSchedule, SPORT_KEYS, DEFAULT_LEAGUE_IDS, leagueKind, propStat, legId };
