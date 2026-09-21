'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const handler = require('./underdog-predict');
const {
  DEFAULT_CLIENT_VERSION,
  DEFAULT_PRODUCT_EXPERIENCE_ID,
  DEFAULT_STATE_CONFIG_ID,
  MONEYLINE_FILTER_IDS,
  SPREAD_FILTER_IDS,
  TOTAL_FILTER_IDS,
  INDEX_SPORTS,
  SPORT_BY_UNDERDOG_ID,
  TEAM_PICKS_MARKET_GROUP,
  contentLinesUrl,
  gamesFromContentLines,
  indexGames,
  linesFromContent,
  matchGroupedLinesUrl,
  moneylineFilterFromScaffold,
  spreadFilterFromScaffold,
  totalFilterFromScaffold,
  readConfig,
  sportScaffoldUrl,
} = require('../lib/underdog-lobby');

const PHONE_EXPERIENCE_ID = '018e1234-5678-9abc-def0-123456789009';
const STICKER_EXPERIENCE_ID = 'b34dfd93-d0e8-4da3-8bf4-45c15c548dec';

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { this.ended = true; },
  };
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function line(title, stat, displayStat, displayMode, statValue, options) {
  return {
    stat_value: statValue,
    over_under: {
      title,
      category: 'core',
      display_mode: displayMode,
      appearance_stat: { display_stat: displayStat, stat },
    },
    options,
  };
}

function opt(header, choice, choiceDisplay, american, fantasyAmerican) {
  return {
    selection_header: header,
    choice,
    choice_display: choiceDisplay,
    american_price: fantasyAmerican || american,
    odds: {
      prediction: { american, decimal: american === '+245' ? '3.45' : undefined, probability: american === '+245' ? '27' : undefined },
      fantasy: fantasyAmerican ? { american: fantasyAmerican } : null,
    },
  };
}

// Live 2026-09-21 shape: over_under_lines is an object, not a scaffold.
const giantsContent = {
  over_under_lines: {
    ml: line('NYG @ LAR Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      opt('New York Giants', 'away', 'Giants to win', '+245', '+252'),
      opt('Los Angeles Rams', 'home', 'Rams to win', '-313', '-280'),
    ]),
    spr: line('NYG @ LAR Spread', 'spread', 'Spread', 'spread', '-6.5', [
      opt('New York Giants', 'away', 'NYG +6.5', '+100'),
      opt('Los Angeles Rams', 'home', 'LAR -6.5', '-122'),
    ]),
  },
};

const scaffoldSectionsOnly = {
  sections: [{ id: 'popular', title: 'New York Giants +245', content_type: 'match_scoreboard' }],
};

function contentBody(game) {
  const appearanceId = `app-${game.id}`;
  const over_under_lines = {};
  for (const [i, row] of (game.lines || []).entries()) {
    const lineId = `line-${game.id}-${i}`;
    over_under_lines[lineId] = {
      ...row,
      id: lineId,
      over_under: {
        ...row.over_under,
        prediction_market: true,
        appearance_stat: {
          ...(row.over_under.appearance_stat || {}),
          appearance_id: appearanceId,
          pickem_stat_id: 'stat',
        },
      },
    };
  }
  return {
    games: {
      [game.id]: {
        id: game.id,
        sport_id: game.sportId,
        status: game.status || 'scheduled',
        full_team_names_title: game.title,
        scheduled_at: game.scheduledAt || null,
      },
    },
    appearances: {
      [appearanceId]: { id: appearanceId, match_id: game.id, match_type: 'Game', type: 'Match' },
    },
    over_under_lines,
  };
}

const nflLines = contentBody({
  id: 178911,
  sportId: 'NFL',
  title: 'New York Giants @ Los Angeles Rams',
  scheduledAt: '2026-09-22T00:15:00Z',
  lines: [
    line('NYG @ LAR Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      opt('New York Giants', 'away', 'Giants to win', '+245', '+252'),
      opt('Los Angeles Rams', 'home', 'Rams to win', '-313', '-280'),
    ]),
    line('NYG @ LAR Spread', 'spread', 'Spread', 'spread', '-6.5', [
      opt('New York Giants', 'away', 'NYG +6.5', '+100'),
      opt('Los Angeles Rams', 'home', 'LAR -6.5', '-122'),
    ]),
  ],
});

const mlbLines = contentBody({
  id: 142714,
  sportId: 'MLB',
  title: 'Cleveland Guardians @ Boston Red Sox',
  scheduledAt: '2026-09-22T22:45:00Z',
  lines: [
    line('CLE @ BOS Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      opt('Cleveland Guardians', 'away', 'Guardians to win', '+104'),
      opt('Boston Red Sox', 'home', 'Red Sox to win', '-134'),
    ]),
  ],
});

const cfbLines = contentBody({
  id: 224202,
  sportId: 'CFB',
  title: 'Ole Miss Rebels @ Florida Gators',
  scheduledAt: '2026-09-26T19:30:00Z',
  lines: [
    line('MISS @ FLA Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      opt('Ole Miss Rebels', 'away', 'Ole Miss to win', '+127', '+129'),
      opt('Florida Gators', 'home', 'Florida to win', '-157'),
    ]),
  ],
});

const fantasyOnlyLines = contentBody({
  id: 99,
  sportId: 'CFB',
  title: 'Fantasy Only @ Nowhere',
  lines: [
    line('Fantasy Only Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      {
        selection_header: 'Fantasy Only',
        choice: 'away',
        choice_display: 'to win',
        american_price: '+252',
        odds: { prediction: null, fantasy: { american: '+252' } },
      },
    ]),
  ],
});

function sportOf(url) {
  const match = /[?&]sport_id=([A-Z0-9]+)/.exec(String(url));
  return match ? match[1] : null;
}

function filterOf(url) {
  const match = /[?&]filter_id=([0-9a-f-]{36})/i.exec(String(url));
  return match ? match[1] : null;
}

function scaffoldFor(sport, filterId) {
  return {
    sections: [
      { content_type: 'market_filters', title: 'MarketFilters' },
      {
        content_type: 'lines',
        title: 'Moneyline',
        data_source: { url: `https://api.underdogfantasy.com/v1/lobbies/content/lines?filter_id=${filterId}&filter_type=PickemStat&sport_id=${sport}` },
      },
      {
        content_type: 'lines',
        title: 'Receiving Yards',
        data_source: { url: `https://api.underdogfantasy.com/v1/lobbies/content/lines?filter_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&filter_type=PickemStat&sport_id=${sport}` },
      },
    ],
  };
}

function teamPicksScaffold(sport, ids) {
  const section = (title, filterId) => ({
    content_type: 'lines',
    title,
    data_source: {
      url: `https://api.underdogfantasy.com/v1/lobbies/content/lines?filter_id=${filterId}&filter_type=PickemStat&sport_id=${sport}`,
    },
  });
  return {
    sections: [
      { content_type: 'market_filters', title: 'MarketFilters' },
      section('Moneyline', ids.moneyline),
      section('Spread', ids.spread),
      section('Total Points', ids.total),
      section('Receiving Yards', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    ],
  };
}

function concatContent(...bodies) {
  const games = {};
  const appearances = {};
  const over_under_lines = {};
  for (const body of bodies) {
    Object.assign(games, body.games || {});
    Object.assign(appearances, body.appearances || {});
    Object.assign(over_under_lines, body.over_under_lines || {});
  }
  return { games, appearances, over_under_lines };
}

function linesFor(sport) {
  if (sport === 'NFL') return nflLines;
  if (sport === 'MLB') return mlbLines;
  if (sport === 'CFB') return cfbLines;
  return { games: {}, appearances: {}, over_under_lines: {} };
}

(async () => {
  {
    assert.equal(DEFAULT_STATE_CONFIG_ID, 'f8996742-f10c-4d32-955a-dcbcaa5dc5c0');
    assert.equal(DEFAULT_PRODUCT_EXPERIENCE_ID, PHONE_EXPERIENCE_ID);
    assert.notEqual(DEFAULT_PRODUCT_EXPERIENCE_ID, STICKER_EXPERIENCE_ID);
    assert.equal(DEFAULT_CLIENT_VERSION, '20260918170103');
    const cfg = readConfig({});
    const url = matchGroupedLinesUrl(cfg, 178911);
    assert.match(url, /\/v1\/lobbies\/content\/match_grouped_lines\?/);
    assert.match(url, /match_id=178911/);
    assert.match(url, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.doesNotMatch(url, new RegExp(STICKER_EXPERIENCE_ID));
    assert.doesNotMatch(url, /betstamp|book_ids=196/);
    const linesUrl = contentLinesUrl(cfg, 'CFB', MONEYLINE_FILTER_IDS.CFB);
    assert.match(linesUrl, /\/v1\/lobbies\/content\/lines\?/);
    assert.match(linesUrl, /filter_type=PickemStat/);
    assert.match(linesUrl, /sport_id=CFB/);
    assert.match(linesUrl, /include_live=true/);
    assert.match(linesUrl, /show_mass_option_markets=false/);
    assert.match(linesUrl, /product=fantasy/);
    assert.match(linesUrl, new RegExp(`filter_id=${MONEYLINE_FILTER_IDS.CFB}`));
    assert.match(linesUrl, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.match(linesUrl, new RegExp(`state_config_id=${DEFAULT_STATE_CONFIG_ID}`));
    assert.doesNotMatch(linesUrl, /\/v1\/over_under_lines/);
    assert.doesNotMatch(linesUrl, new RegExp(STICKER_EXPERIENCE_ID));
    assert.doesNotMatch(linesUrl, /betstamp|book_ids=196/);
    const scaffoldUrl = sportScaffoldUrl(cfg, 'NFL');
    assert.match(scaffoldUrl, /\/v1\/lobbies\/scaffolds\/sports\?/);
    assert.match(scaffoldUrl, new RegExp(`filter_id=${TEAM_PICKS_MARKET_GROUP}`));
    assert.match(scaffoldUrl, /filter_type=MarketGroup/);
    assert.match(scaffoldUrl, /sport_id=NFL/);
    assert.match(scaffoldUrl, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.equal(MONEYLINE_FILTER_IDS.CFB, 'e669e437-9dc7-48d8-9d93-2aabd5a13d10');
    assert.equal(MONEYLINE_FILTER_IDS.MLB, '3f157ade-e2af-41ff-a5c6-9e0ca4f8c018');
    assert.equal(MONEYLINE_FILTER_IDS.NFL, '0251dd94-773d-47ec-878d-8a7349b8b967');
    assert.equal(SPREAD_FILTER_IDS.NFL, '42ae12ae-89ce-49f3-80fa-2dc1ab9338f8');
    assert.equal(SPREAD_FILTER_IDS.CFB, 'dae11c40-9758-4142-af39-79c75d6fcc46');
    assert.equal(SPREAD_FILTER_IDS.MLB, 'f71ad294-b93c-4c62-be04-d123e7640775');
    assert.equal(TOTAL_FILTER_IDS.NFL, '8f654930-4852-4510-babc-58ba0ff9840f');
    assert.equal(TOTAL_FILTER_IDS.CFB, '0fa6fdd2-afb1-4c3a-bb35-98da0b814ef1');
    assert.equal(TOTAL_FILTER_IDS.MLB, 'efa4c7d0-9e4a-46cf-89f3-24005a3b7c94');
  }

  {
    assert.deepEqual([...INDEX_SPORTS], ['NFL', 'CFB', 'MLB']);
    assert.equal(SPORT_BY_UNDERDOG_ID.NFL, 'NFL');
    assert.equal(SPORT_BY_UNDERDOG_ID.CFB, 'NCAAF');
    assert.equal(SPORT_BY_UNDERDOG_ID.MLB, 'MLB');
    const indexed = indexGames({
      games: [
        { id: 178911, sport_id: 'NFL', status: 'scheduled', full_team_names_title: 'New York Giants @ Los Angeles Rams' },
        { id: 183024, sport_id: 'CFB', status: 'scheduled', full_team_names_title: 'Clemson Tigers @ California Golden Bears' },
        { id: 142714, sport_id: 'MLB', status: 'scheduled', full_team_names_title: 'Cleveland Guardians @ Boston Red Sox' },
        { id: 7, sport_id: 'WNBA', status: 'scheduled', full_team_names_title: 'Dallas Wings @ Phoenix Mercury' },
        { id: 8, sport_id: 'NFL', status: 'closed', full_team_names_title: 'Old Away @ Old Home' },
      ],
    });
    assert.deepEqual(indexed.map((g) => [g.matchId, g.sport]), [
      [178911, 'NFL'],
      [183024, 'NCAAF'],
      [142714, 'MLB'],
    ]);
    assert.equal(moneylineFilterFromScaffold(scaffoldFor('CFB', MONEYLINE_FILTER_IDS.CFB)), MONEYLINE_FILTER_IDS.CFB);
    assert.equal(moneylineFilterFromScaffold(scaffoldSectionsOnly), null);
    const pills = teamPicksScaffold('NFL', {
      moneyline: MONEYLINE_FILTER_IDS.NFL,
      spread: SPREAD_FILTER_IDS.NFL,
      total: TOTAL_FILTER_IDS.NFL,
    });
    assert.equal(spreadFilterFromScaffold(pills), SPREAD_FILTER_IDS.NFL);
    assert.equal(totalFilterFromScaffold(pills), TOTAL_FILTER_IDS.NFL);
    assert.equal(spreadFilterFromScaffold(scaffoldSectionsOnly), null);
    assert.equal(totalFilterFromScaffold(scaffoldSectionsOnly), null);
    const runs = teamPicksScaffold('MLB', {
      moneyline: MONEYLINE_FILTER_IDS.MLB,
      spread: SPREAD_FILTER_IDS.MLB,
      total: TOTAL_FILTER_IDS.MLB,
    });
    runs.sections.find((section) => section.title === 'Total Points').title = 'Total Runs';
    assert.equal(totalFilterFromScaffold(runs), TOTAL_FILTER_IDS.MLB);
    const priced = gamesFromContentLines(cfbLines, 'CFB');
    assert.equal(priced.length, 1);
    assert.equal(priced[0].sport, 'NCAAF');
    assert.equal(priced[0].away, 'Ole Miss Rebels');
    assert.equal(priced[0].lines.find((l) => l.market === 'h2h' && l.name === 'Ole Miss Rebels').american, 127);
    assert.notEqual(priced[0].lines.find((l) => l.name === 'Ole Miss Rebels').american, 129);
    assert.deepEqual(gamesFromContentLines(fantasyOnlyLines, 'CFB'), [], 'fantasy american is not a phone quote');
    const mlbPriced = gamesFromContentLines(mlbLines, 'MLB');
    assert.equal(mlbPriced[0].sport, 'MLB');
    assert.equal(mlbPriced[0].lines.find((l) => l.name === 'Cleveland Guardians').american, 104);
  }

  {
    const quotes = linesFromContent(giantsContent);
    const giants = quotes.find((l) => l.name === 'New York Giants' && l.market === 'h2h');
    const rams = quotes.find((l) => l.name === 'Los Angeles Rams' && l.market === 'h2h');
    assert.equal(giants.american, 245);
    assert.equal(rams.american, -313);
    assert.notEqual(giants.american, 252);
    assert.notEqual(giants.american, 240);
    const giantSpread = quotes.find((l) => l.name === 'New York Giants' && l.market === 'spreads');
    const ramSpread = quotes.find((l) => l.name === 'Los Angeles Rams' && l.market === 'spreads');
    assert.equal(giantSpread.point, 6.5);
    assert.equal(ramSpread.point, -6.5);
    assert.deepEqual(linesFromContent(scaffoldSectionsOnly), [], 'scaffold sections have no phone prices');
  }

  {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url: String(url), headers: (init && init.headers) || {} });
      const sport = sportOf(url);
      if (String(url).includes('/lobbies/scaffolds/sports')) {
        const filterId = sport === 'CFB'
          ? MONEYLINE_FILTER_IDS.CFB
          : '11111111-2222-4333-8444-555555555555';
        return jsonRes(200, scaffoldFor(sport, filterId));
      }
      if (String(url).includes('/lobbies/content/lines')) {
        const filterId = filterOf(url);
        if (sport === 'CFB' && filterId === MONEYLINE_FILTER_IDS.CFB) return jsonRes(200, cfbLines);
        if (sport === 'NFL' && filterId === MONEYLINE_FILTER_IDS.NFL) return jsonRes(200, nflLines);
        if (sport === 'MLB' && filterId === MONEYLINE_FILTER_IDS.MLB) return jsonRes(200, mlbLines);
        return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
      }
      return jsonRes(404, { error: { detail: 'missing' } });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn });
    assert.equal(res.body.missingConfig, false);
    assert.equal(res.body.configRejected, false);
    assert.equal(res.body.games.length, 3);
    const game = res.body.games.find((g) => g.matchId === 178911);
    const giants = game.lines.find((l) => l.name === 'New York Giants' && l.market === 'h2h');
    const rams = game.lines.find((l) => l.name === 'Los Angeles Rams' && l.market === 'h2h');
    assert.equal(game.sport, 'NFL');
    assert.equal(giants.american, 245, 'phone odds.prediction, not fantasy +252');
    assert.equal(rams.american, -313);
    assert.notEqual(giants.american, 252);
    assert.ok(res.body.games.every((g) => g.lines.every((l) => l.market === 'h2h')), 'empty spread and total feeds leave moneylines');
    assert.equal(game.lines.some((l) => l.market === 'spreads'), false);
    const mlb = res.body.games.find((g) => g.sport === 'MLB');
    assert.equal(mlb.away, 'Cleveland Guardians');
    assert.equal(mlb.lines.find((l) => l.name === 'Cleveland Guardians').american, 104);
    const cfb = res.body.games.find((g) => g.matchId === 224202);
    assert.equal(cfb.sport, 'NCAAF');
    assert.equal(cfb.lines.find((l) => l.name === 'Ole Miss Rebels').american, 127);
    const lineCalls = calls.filter((c) => c.url.includes('/lobbies/content/lines'));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'CFB' && filterOf(c.url) === MONEYLINE_FILTER_IDS.CFB));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'NFL' && filterOf(c.url) === MONEYLINE_FILTER_IDS.NFL));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'MLB' && filterOf(c.url) === MONEYLINE_FILTER_IDS.MLB));
    assert.ok(lineCalls.every((c) => c.url.includes('filter_type=PickemStat')));
    assert.ok(calls.every((c) => c.url.includes(PHONE_EXPERIENCE_ID)));
    assert.equal(calls[0].headers.accept, 'application/json');
    assert.equal(calls[0].headers['client-type'], 'web');
    assert.equal(calls[0].headers['client-version'], '20260918170103');
    assert.ok(!calls.some((c) => /betstamp|over_under_lines|match_grouped_lines/i.test(c.url)));
    assert.ok(!calls.some((c) => c.url.includes(STICKER_EXPERIENCE_ID)));
  }

  {
    const empty = { games: {}, appearances: {}, over_under_lines: {} };
    const giantsMl = contentBody({
      id: 178911,
      sportId: 'NFL',
      title: 'New York Giants @ Los Angeles Rams',
      lines: [
        line('NYG @ LAR Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          opt('New York Giants', 'away', 'Giants to win', '+245', '+252'),
          opt('Los Angeles Rams', 'home', 'Rams to win', '-313', '-280'),
        ]),
      ],
    });
    const ravensMl = contentBody({
      id: 175974,
      sportId: 'NFL',
      title: 'Baltimore Ravens @ Dallas Cowboys',
      lines: [
        line('BAL @ DAL Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          opt('Baltimore Ravens', 'away', 'Ravens to win', '-157'),
          opt('Dallas Cowboys', 'home', 'Cowboys to win', '+130'),
        ]),
      ],
    });
    const giantsSpread = contentBody({
      id: 178911,
      sportId: 'NFL',
      title: 'New York Giants @ Los Angeles Rams',
      lines: [
        line('NYG @ LAR Spread', 'spread', 'Spread', 'spread', '-6.5', [
          opt('New York Giants', 'away', 'NYG +6.5', '+100', '+110'),
          opt('Los Angeles Rams', 'home', 'LAR -6.5', '-122'),
        ]),
      ],
    });
    const giantsTotal = contentBody({
      id: 178911,
      sportId: 'NFL',
      title: 'New York Giants @ Los Angeles Rams',
      lines: [
        line('NYG @ LAR Total Points O/U', 'points', 'Total Points', 'over_under', '47.5', [
          opt('NYG @ LAR', 'higher', 'Higher', '-113', '+200'),
          opt('NYG @ LAR', 'lower', 'Lower', '-109'),
        ]),
      ],
    });
    const oleMiss = contentBody({
      id: 224202,
      sportId: 'CFB',
      title: 'Ole Miss Rebels @ Florida Gators',
      lines: [
        line('MISS @ FLA Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          opt('Ole Miss Rebels', 'away', 'Ole Miss to win', '+127', '+129'),
          opt('Florida Gators', 'home', 'Florida to win', '-157'),
        ]),
      ],
    });
    const oleMissSpread = contentBody({
      id: 224202,
      sportId: 'CFB',
      title: 'Ole Miss Rebels @ Florida Gators',
      lines: [
        line('MISS @ FLA Spread', 'spread', 'Spread', 'spread', '-2.5', [
          opt('Ole Miss Rebels', 'away', 'MISS +2.5', '+106'),
          opt('Florida Gators', 'home', 'FLA -2.5', '-134'),
        ]),
      ],
    });
    const oleMissTotal = contentBody({
      id: 224202,
      sportId: 'CFB',
      title: 'Ole Miss Rebels @ Florida Gators',
      lines: [
        line('MISS @ FLA Total Points O/U', 'points', 'Total Points', 'over_under', '51.5', [
          opt('MISS @ FLA', 'higher', 'Higher', '-136'),
          opt('MISS @ FLA', 'lower', 'Lower', '+104'),
        ]),
      ],
    });
    const mlbMl = contentBody({
      id: 142331,
      sportId: 'MLB',
      title: 'Chicago White Sox @ Kansas City Royals',
      lines: [
        line('CWS @ KC Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          opt('Chicago White Sox', 'away', 'White Sox to win', '-122'),
          opt('Kansas City Royals', 'home', 'Royals to win', '+102'),
        ]),
      ],
    });
    const mlbTotal = contentBody({
      id: 142331,
      sportId: 'MLB',
      title: 'Chicago White Sox @ Kansas City Royals',
      lines: [
        line('CWS @ KC Total Runs O/U', 'points', 'Total Runs', 'over_under', '8.5', [
          opt('CWS @ KC', 'higher', 'Higher', '+100'),
          opt('CWS @ KC', 'lower', 'Lower', '-120'),
        ]),
      ],
    });
    const calls = [];
    const fetchFn = async (url) => {
      const sport = sportOf(url);
      const filterId = filterOf(url);
      calls.push(String(url));
      if (String(url).includes('/lobbies/scaffolds/sports')) {
        return jsonRes(200, teamPicksScaffold(sport, {
          moneyline: MONEYLINE_FILTER_IDS.CFB,
          spread: SPREAD_FILTER_IDS.CFB,
          total: TOTAL_FILTER_IDS.CFB,
        }));
      }
      if (!String(url).includes('/lobbies/content/lines')) return jsonRes(404, {});
      if (sport === 'NFL' && filterId === MONEYLINE_FILTER_IDS.NFL) return jsonRes(200, concatContent(giantsMl, ravensMl));
      if (sport === 'NFL' && filterId === SPREAD_FILTER_IDS.NFL) return jsonRes(200, giantsSpread);
      if (sport === 'NFL' && filterId === TOTAL_FILTER_IDS.NFL) return jsonRes(200, giantsTotal);
      if (sport === 'CFB' && filterId === MONEYLINE_FILTER_IDS.CFB) return jsonRes(200, oleMiss);
      if (sport === 'CFB' && filterId === SPREAD_FILTER_IDS.CFB) return jsonRes(200, oleMissSpread);
      if (sport === 'CFB' && filterId === TOTAL_FILTER_IDS.CFB) return jsonRes(200, oleMissTotal);
      if (sport === 'MLB' && filterId === MONEYLINE_FILTER_IDS.MLB) return jsonRes(200, mlbMl);
      if (sport === 'MLB' && filterId === TOTAL_FILTER_IDS.MLB) return jsonRes(200, mlbTotal);
      return jsonRes(200, empty);
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn });
    const giants = res.body.games.find((g) => g.matchId === 178911);
    assert.equal(giants.sport, 'NFL');
    assert.equal(giants.lines.find((l) => l.market === 'h2h' && l.name === 'New York Giants').american, 245);
    assert.notEqual(giants.lines.find((l) => l.market === 'h2h' && l.name === 'New York Giants').american, 252);
    const giantSpread = giants.lines.find((l) => l.market === 'spreads' && l.name === 'New York Giants');
    const ramSpread = giants.lines.find((l) => l.market === 'spreads' && l.name === 'Los Angeles Rams');
    assert.equal(giantSpread.american, 100);
    assert.notEqual(giantSpread.american, 110);
    assert.equal(giantSpread.point, 6.5);
    assert.equal(ramSpread.point, -6.5);
    const over = giants.lines.find((l) => l.market === 'totals' && l.choice === 'higher');
    const under = giants.lines.find((l) => l.market === 'totals' && l.choice === 'lower');
    assert.equal(over.american, -113);
    assert.notEqual(over.american, 200);
    assert.equal(over.point, 47.5);
    assert.equal(under.american, -109);
    assert.equal(under.point, 47.5);
    const ravens = res.body.games.find((g) => g.matchId === 175974);
    assert.ok(ravens.lines.every((l) => l.market === 'h2h'), 'missing spread and total are omitted');
    const cfb = res.body.games.find((g) => g.matchId === 224202);
    assert.equal(cfb.sport, 'NCAAF');
    assert.equal(cfb.lines.find((l) => l.market === 'h2h' && l.name === 'Ole Miss Rebels').american, 127);
    assert.equal(cfb.lines.find((l) => l.market === 'spreads' && l.name === 'Ole Miss Rebels').point, 2.5);
    assert.equal(cfb.lines.find((l) => l.market === 'totals' && l.choice === 'higher').point, 51.5);
    const mlb = res.body.games.find((g) => g.matchId === 142331);
    assert.equal(mlb.sport, 'MLB');
    assert.equal(mlb.lines.some((l) => l.market === 'h2h'), true);
    assert.equal(mlb.lines.some((l) => l.market === 'spreads'), false, 'empty MLB spread feed omits the market');
    assert.equal(mlb.lines.find((l) => l.market === 'totals' && l.choice === 'higher').point, 8.5);
    const lineCalls = calls.filter((url) => url.includes('/lobbies/content/lines'));
    assert.ok(lineCalls.some((url) => sportOf(url) === 'NFL' && filterOf(url) === SPREAD_FILTER_IDS.CFB));
    assert.ok(lineCalls.some((url) => sportOf(url) === 'NFL' && filterOf(url) === SPREAD_FILTER_IDS.NFL));
    assert.ok(lineCalls.some((url) => sportOf(url) === 'NFL' && filterOf(url) === TOTAL_FILTER_IDS.NFL));
    assert.equal(lineCalls.filter((url) => sportOf(url) === 'CFB' && filterOf(url) === SPREAD_FILTER_IDS.CFB).length, 1);
    assert.ok(!lineCalls.some((url) => filterOf(url) === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    assert.ok(calls.every((url) => url.includes(PHONE_EXPERIENCE_ID)));
    assert.ok(!calls.some((url) => url.includes(STICKER_EXPERIENCE_ID)));
    assert.ok(!calls.some((url) => /betstamp|book_ids=196|match_grouped_lines/.test(url)));
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        if (String(url).includes('/scaffolds/')) return jsonRes(200, scaffoldSectionsOnly);
        if (String(url).includes('/content/lines')) return jsonRes(200, scaffoldSectionsOnly);
        return jsonRes(404, {});
      },
    });
    assert.deepEqual(res.body.games, [], 'sections-only body does not invent a line');
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        if (String(url).includes('/scaffolds/')) return jsonRes(200, { sections: [] });
        return jsonRes(404, { error: { detail: 'not found' } });
      },
    });
    assert.equal(res.body.configRejected, true);
    assert.deepEqual(res.body.games, [], 'rejected config does not invent a line');
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async () => { throw new Error('down'); },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.games, [], 'fetch failure omits Underdog');
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        const sport = sportOf(url);
        if (String(url).includes('/scaffolds/')) return jsonRes(200, { sections: [] });
        if (sport === 'MLB') return jsonRes(404, { error: { detail: 'not found' } });
        if (String(url).includes('/content/lines') && filterOf(url) === MONEYLINE_FILTER_IDS[sport]) {
          return jsonRes(200, linesFor(sport));
        }
        return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
      },
    });
    assert.equal(res.body.configRejected, false, 'one sport 404 does not drop the others');
    assert.equal(res.body.games.some((g) => g.sport === 'MLB'), false);
    assert.equal(res.body.games.some((g) => g.sport === 'NFL'), true);
    assert.equal(res.body.games.some((g) => g.sport === 'NCAAF'), true);
  }

  {
    const root = path.join(__dirname, '..');
    const lobbySrc = fs.readFileSync(path.join(root, 'lib/underdog-lobby.js'), 'utf8');
    const apiSrc = fs.readFileSync(path.join(root, 'api/underdog-predict.js'), 'utf8');
    assert.doesNotMatch(lobbySrc, /require\(['"]\.\.\/src\//);
    assert.doesNotMatch(apiSrc, /require\(['"]\.\.\/src\//);
    assert.doesNotMatch(lobbySrc, new RegExp(`product_experience_id:\\s*'${STICKER_EXPERIENCE_ID}'`));
    // Vercel Node does not enable require(esm). This is the boot path that
    // returned FUNCTION_INVOCATION_FAILED when the lobby required src/.
    const loaded = spawnSync(process.execPath, [
      '--no-experimental-require-module',
      '-e',
      "const handler = require('./api/underdog-predict.js'); if (typeof handler !== 'function') throw new Error('handler missing'); require('./lib/underdog-lobby.js');",
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
  }

  {
    const now = Date.parse('2026-09-21T20:20:00.000Z');
    const miami = contentBody({
      id: 183027,
      sportId: 'CFB',
      title: 'Central Michigan Chippewas @ Miami (FL) Hurricanes',
      lines: [
        line('CMU @ MIA Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          {
            ...opt('Central Michigan Chippewas', 'away', 'CMU to win', '+3230'),
            updated_at: '2026-09-21T19:35:16.513Z',
          },
          {
            ...opt('Miami (FL) Hurricanes', 'home', 'Miami to win', '-1112'),
            updated_at: '2026-09-13T02:16:09.235Z',
          },
        ]),
      ],
    });
    const akron = contentBody({
      id: 226516,
      sportId: 'CFB',
      title: 'Akron Zips @ Central Michigan Chippewas',
      lines: [
        line('AKR @ CMU Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          {
            ...opt('Akron Zips', 'away', 'Akron to win', '-527'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
          {
            ...opt('Central Michigan Chippewas', 'home', 'CMU to win', '-715'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
        ]),
        line('AKR @ CMU Spread', 'spread', 'Spread', 'spread', '-3.5', [
          {
            ...opt('Akron Zips', 'away', 'AKR +3.5', '+100'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
          {
            ...opt('Central Michigan Chippewas', 'home', 'CMU -3.5', '-120'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
        ]),
      ],
    });
    const akronMlOnly = contentBody({
      id: 226516,
      sportId: 'CFB',
      title: 'Akron Zips @ Central Michigan Chippewas',
      lines: [
        line('AKR @ CMU Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          {
            ...opt('Akron Zips', 'away', 'Akron to win', '-527'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
          {
            ...opt('Central Michigan Chippewas', 'home', 'CMU to win', '-715'),
            updated_at: '2026-09-21T20:00:00.000Z',
          },
        ]),
      ],
    });
    const juice = contentBody({
      id: 183100,
      sportId: 'CFB',
      title: 'Even Dogs @ Even Cats',
      lines: [
        line('Even Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          opt('Even Dogs', 'away', 'Dogs to win', '-110'),
          opt('Even Cats', 'home', 'Cats to win', '-110'),
        ]),
      ],
    });
    const priced = gamesFromContentLines(miami, 'CFB', now);
    assert.equal(priced.length, 0, 'CMU +3230 is omitted after stale Miami −1112 leaves a one-sided moneyline');
    const akronGames = gamesFromContentLines(akron, 'CFB', now);
    assert.equal(akronGames.length, 1);
    assert.ok(akronGames[0].lines.every((l) => l.market === 'spreads'), 'incoherent −527 / −715 moneyline is omitted; spread stays');
    assert.equal(akronGames[0].lines.some((l) => l.american === -527), false);
    const even = gamesFromContentLines(juice, 'CFB', now);
    assert.equal(even[0].lines.length, 2, 'missing timestamps are not stale, and −110 / −110 stays');

    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      const sport = sportOf(url);
      if (String(url).includes('/lobbies/scaffolds/sports')) {
        return jsonRes(200, scaffoldFor(sport, MONEYLINE_FILTER_IDS[sport] || MONEYLINE_FILTER_IDS.CFB));
      }
      if (String(url).includes('/lobbies/content/lines') && sport === 'CFB' && filterOf(url) === MONEYLINE_FILTER_IDS.CFB) {
        return jsonRes(200, concatContent(miami, akronMlOnly, juice));
      }
      return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn, now });
    assert.equal(res.body.games.find((g) => g.matchId === 183027), undefined, 'API omits the CMU +3230 orphan after the 8-day Miami side');
    assert.equal(res.body.games.find((g) => g.matchId === 226516), undefined, 'incoherent Akron / CMU moneyline is omitted');
    const evenApi = res.body.games.find((g) => g.matchId === 183100);
    assert.equal(evenApi.lines.filter((l) => l.market === 'h2h').length, 2);
    assert.ok(calls.every((url) => url.includes(PHONE_EXPERIENCE_ID)));
    assert.ok(!calls.some((url) => /betstamp|book_ids=196/.test(url)));
  }

  {
    // Board / API omit is 24h. A 2h quote stays; a 25h quote is dropped.
    // Promo ranking (1h) is covered in promoUnderdogFreshness.test.js.
    const { UNDERDOG_BOARD_OMIT_MS, UNDERDOG_STALE_MS } = require('../lib/underdog-freshness');
    assert.equal(UNDERDOG_STALE_MS, 60 * 60 * 1000);
    assert.equal(UNDERDOG_BOARD_OMIT_MS, 24 * 60 * 60 * 1000);
    const now = Date.parse('2026-09-21T20:20:00.000Z');
    const twoHours = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 10 * 60 * 1000).toISOString();
    const twentyFiveHours = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const split = contentBody({
      id: 183200,
      sportId: 'CFB',
      title: 'Pittsburgh Steelers @ Baltimore Ravens',
      lines: [
        line('PIT @ BAL Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          {
            ...opt('Pittsburgh Steelers', 'away', 'Steelers to win', '+180'),
            updated_at: twoHours,
          },
          {
            ...opt('Baltimore Ravens', 'home', 'Ravens to win', '-200'),
            updated_at: fresh,
          },
        ]),
      ],
    });
    const dayOld = contentBody({
      id: 183201,
      sportId: 'CFB',
      title: 'Day Old Dogs @ Day Old Cats',
      lines: [
        line('OLD Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          {
            ...opt('Day Old Dogs', 'away', 'Dogs to win', '+150'),
            updated_at: twentyFiveHours,
          },
          {
            ...opt('Day Old Cats', 'home', 'Cats to win', '-170'),
            updated_at: twentyFiveHours,
          },
        ]),
      ],
    });
    const priced = gamesFromContentLines(split, 'CFB', now);
    assert.equal(priced.length, 1);
    assert.deepEqual(
      priced[0].lines.map((l) => l.american).sort((a, b) => a - b),
      [-200, 180],
      '2h Steelers quote stays on the board payload; 10m Ravens stays',
    );
    assert.equal(gamesFromContentLines(dayOld, 'CFB', now).length, 0, '25h quotes are omitted');

    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      const sport = sportOf(url);
      if (String(url).includes('/lobbies/scaffolds/sports')) {
        return jsonRes(200, scaffoldFor(sport, MONEYLINE_FILTER_IDS[sport] || MONEYLINE_FILTER_IDS.CFB));
      }
      if (String(url).includes('/lobbies/content/lines') && sport === 'CFB' && filterOf(url) === MONEYLINE_FILTER_IDS.CFB) {
        return jsonRes(200, concatContent(split, dayOld));
      }
      return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn, now });
    const game = res.body.games.find((g) => g.matchId === 183200);
    assert.ok(game, '2h game is present on GET /api/underdog-predict');
    assert.equal(game.lines.find((l) => l.name === 'Pittsburgh Steelers').american, 180, '2h side is still in the API');
    assert.equal(game.lines.find((l) => l.name === 'Baltimore Ravens').american, -200, 'fresh side is still in the API');
    assert.equal(res.body.games.find((g) => g.matchId === 183201), undefined, '25h game is omitted from the API');
    assert.ok(calls.every((url) => url.includes(PHONE_EXPERIENCE_ID)));
  }

  {
    // Live 2026-09-21 phone feed: +3230 (7) and −10000 (5) still passed the
    // implied-sum check (~1.02) and one-sided leftovers stayed after the
    // other side was board-omitted. Cap |american| >= 2000, then drop an
    // orphan moneyline. −110 / −110 stays. Spreads and totals stay.
    const { UNDERDOG_H2H_AMERICAN_ABS_MAX, UNDERDOG_BOARD_OMIT_MS, UNDERDOG_STALE_MS } = require('../lib/underdog-freshness');
    assert.equal(UNDERDOG_H2H_AMERICAN_ABS_MAX, 2000);
    assert.equal(UNDERDOG_STALE_MS, 60 * 60 * 1000);
    assert.equal(UNDERDOG_BOARD_OMIT_MS, 24 * 60 * 60 * 1000);
    const now = Date.parse('2026-09-21T20:20:00.000Z');
    const fresh = new Date(now - 10 * 60 * 1000).toISOString();
    const dayOld = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const capped = contentBody({
      id: 183300,
      sportId: 'CFB',
      title: 'Stonehill Skyhawks @ Ohio Bobcats',
      lines: [
        line('STO @ OHIO Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Stonehill Skyhawks', 'away', 'Stonehill to win', '+3230'), updated_at: fresh },
          { ...opt('Ohio Bobcats', 'home', 'Ohio to win', '-10000'), updated_at: fresh },
        ]),
        line('STO @ OHIO Total', 'total', 'Total Points', 'total', '54.5', [
          { ...opt('Over', 'higher', 'Over 54.5', '-110'), updated_at: fresh },
          { ...opt('Under', 'lower', 'Under 54.5', '-110'), updated_at: fresh },
        ]),
      ],
    });
    const chalkOnly = contentBody({
      id: 183301,
      sportId: 'CFB',
      title: 'South Dakota State Jackrabbits @ Ohio State Buckeyes',
      lines: [
        line('SDST @ OSU Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Ohio State Buckeyes', 'home', 'Ohio State to win', '-10000'), updated_at: fresh },
        ]),
      ],
    });
    const longshotOnly = contentBody({
      id: 183302,
      sportId: 'CFB',
      title: 'Bucknell Bison @ Pitt Panthers',
      lines: [
        line('BUCK @ PITT Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Bucknell Bison', 'away', 'Bucknell to win', '+3230'), updated_at: fresh },
        ]),
        line('BUCK @ PITT Spread', 'spread', 'Spread', 'spread', '28.5', [
          { ...opt('Bucknell Bison', 'away', 'BUCK +28.5', '-110'), updated_at: fresh },
          { ...opt('Pitt Panthers', 'home', 'PITT -28.5', '-110'), updated_at: fresh },
        ]),
      ],
    });
    const orphan = contentBody({
      id: 183303,
      sportId: 'CFB',
      title: 'Orphan Dogs @ Orphan Cats',
      lines: [
        line('ORP Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Orphan Dogs', 'away', 'Dogs to win', '+180'), updated_at: dayOld },
          { ...opt('Orphan Cats', 'home', 'Cats to win', '-150'), updated_at: fresh },
        ]),
        line('ORP Spread', 'spread', 'Spread', 'spread', '-3.5', [
          { ...opt('Orphan Dogs', 'away', 'Dogs +3.5', '-105'), updated_at: fresh },
          { ...opt('Orphan Cats', 'home', 'Cats -3.5', '-115'), updated_at: fresh },
        ]),
      ],
    });
    const juice = contentBody({
      id: 183304,
      sportId: 'CFB',
      title: 'Juice Dogs @ Juice Cats',
      lines: [
        line('JCE Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Juice Dogs', 'away', 'Dogs to win', '-110'), updated_at: fresh },
          { ...opt('Juice Cats', 'home', 'Cats to win', '-110'), updated_at: fresh },
        ]),
      ],
    });
    const cmuSpread = contentBody({
      id: 183027,
      sportId: 'CFB',
      title: 'Central Michigan Chippewas @ Miami (FL) Hurricanes',
      lines: [
        line('CMU @ MIA Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
          { ...opt('Central Michigan Chippewas', 'away', 'CMU to win', '+3230'), updated_at: '2026-09-21T19:35:16.513Z' },
          { ...opt('Miami (FL) Hurricanes', 'home', 'Miami to win', '-1112'), updated_at: '2026-09-13T02:16:09.235Z' },
        ]),
        line('CMU @ MIA Spread', 'spread', 'Spread', 'spread', '-21.5', [
          { ...opt('Central Michigan Chippewas', 'away', 'CMU +21.5', '-110'), updated_at: fresh },
          { ...opt('Miami (FL) Hurricanes', 'home', 'Miami -21.5', '-110'), updated_at: fresh },
        ]),
      ],
    });

    const cappedGames = gamesFromContentLines(capped, 'CFB', now);
    assert.equal(cappedGames.length, 1);
    assert.equal(cappedGames[0].lines.some((l) => l.american === 3230), false, '+3230 moneyline is omitted');
    assert.equal(cappedGames[0].lines.some((l) => l.american === -10000), false, '−10000 moneyline is omitted');
    assert.ok(cappedGames[0].lines.every((l) => l.market === 'totals'), 'capped h2h is omitted; total stays');
    assert.equal(gamesFromContentLines(chalkOnly, 'CFB', now).length, 0, '−10000 alone is omitted');
    const bucknell = gamesFromContentLines(longshotOnly, 'CFB', now);
    assert.equal(bucknell[0].lines.some((l) => l.american === 3230), false, '+3230 alone is omitted');
    assert.ok(bucknell[0].lines.every((l) => l.market === 'spreads'), 'spread stays after the capped moneyline is omitted');
    const orphanGames = gamesFromContentLines(orphan, 'CFB', now);
    assert.equal(orphanGames[0].lines.some((l) => l.market === 'h2h'), false, 'orphan single h2h is omitted');
    assert.equal(orphanGames[0].lines.some((l) => l.american === -150), false);
    assert.ok(orphanGames[0].lines.every((l) => l.market === 'spreads'));
    const juiceGames = gamesFromContentLines(juice, 'CFB', now);
    assert.deepEqual(juiceGames[0].lines.map((l) => l.american), [-110, -110], '−110 / −110 stays');
    const cmu = gamesFromContentLines(cmuSpread, 'CFB', now);
    assert.equal(cmu.length, 1);
    assert.equal(cmu[0].lines.some((l) => l.market === 'h2h'), false, 'CMU +3230 orphan after Miami board-omit is dropped');
    assert.equal(cmu[0].lines.some((l) => l.american === 3230 || l.american === -1112), false);
    assert.ok(cmu[0].lines.every((l) => l.market === 'spreads'), 'CMU @ Miami spread stays');

    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      const sport = sportOf(url);
      const filterId = filterOf(url);
      if (String(url).includes('/lobbies/scaffolds/sports')) {
        return jsonRes(200, scaffoldFor(sport, MONEYLINE_FILTER_IDS[sport] || MONEYLINE_FILTER_IDS.CFB));
      }
      if (String(url).includes('/lobbies/content/lines') && sport === 'CFB' && filterId === MONEYLINE_FILTER_IDS.CFB) {
        return jsonRes(200, concatContent(capped, chalkOnly, longshotOnly, orphan, juice, cmuSpread));
      }
      if (String(url).includes('/lobbies/content/lines') && sport === 'CFB' && filterId === SPREAD_FILTER_IDS.CFB) {
        return jsonRes(200, concatContent(longshotOnly, orphan, cmuSpread));
      }
      if (String(url).includes('/lobbies/content/lines') && sport === 'CFB' && filterId === TOTAL_FILTER_IDS.CFB) {
        return jsonRes(200, capped);
      }
      return jsonRes(200, { games: {}, appearances: {}, over_under_lines: {} });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn, now });
    const stonehill = res.body.games.find((g) => g.matchId === 183300);
    assert.ok(stonehill);
    assert.equal(stonehill.lines.some((l) => l.american === 3230 || l.american === -10000), false);
    assert.ok(stonehill.lines.every((l) => l.market === 'totals'));
    assert.equal(res.body.games.find((g) => g.matchId === 183301), undefined, 'API omits Ohio State −10000');
    const pitt = res.body.games.find((g) => g.matchId === 183302);
    assert.ok(pitt);
    assert.equal(pitt.lines.some((l) => l.market === 'h2h' || l.american === 3230), false);
    assert.ok(pitt.lines.every((l) => l.market === 'spreads'));
    const orphanApi = res.body.games.find((g) => g.matchId === 183303);
    assert.ok(orphanApi);
    assert.equal(orphanApi.lines.some((l) => l.market === 'h2h'), false, 'API omits the orphan moneyline');
    assert.ok(orphanApi.lines.every((l) => l.market === 'spreads'));
    const juiceApi = res.body.games.find((g) => g.matchId === 183304);
    assert.deepEqual(juiceApi.lines.map((l) => l.american), [-110, -110]);
    const cmuApi = res.body.games.find((g) => g.matchId === 183027);
    assert.ok(cmuApi, 'CMU @ Miami stays for the spread');
    assert.equal(cmuApi.lines.some((l) => l.market === 'h2h'), false);
    assert.equal(cmuApi.lines.some((l) => l.american === 3230 || l.american === -1112), false);
    assert.ok(calls.every((url) => url.includes(PHONE_EXPERIENCE_ID)));
  }

  console.log('underdog-predict.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
