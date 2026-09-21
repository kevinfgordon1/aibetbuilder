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
  FALLBACK_PICKEM_STATS,
  INDEX_SPORTS,
  SPORT_BY_UNDERDOG_ID,
  TEAM_PICKS_MARKET_GROUP,
  contentLinesUrl,
  gamesFromContentLines,
  indexGames,
  linesFromContent,
  matchGroupedLinesUrl,
  pickemStatsFromScaffold,
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
    const linesUrl = contentLinesUrl(cfg, 'CFB', FALLBACK_PICKEM_STATS.CFB[0].id);
    assert.match(linesUrl, /\/v1\/lobbies\/content\/lines\?/);
    assert.match(linesUrl, /filter_type=PickemStat/);
    assert.match(linesUrl, /sport_id=CFB/);
    assert.match(linesUrl, /include_live=true/);
    assert.match(linesUrl, /show_mass_option_markets=false/);
    assert.match(linesUrl, /product=fantasy/);
    assert.match(linesUrl, new RegExp(`filter_id=${FALLBACK_PICKEM_STATS.CFB[0].id}`));
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
    assert.equal(FALLBACK_PICKEM_STATS.CFB.find((s) => s.label === 'Moneyline').id, 'e669e437-9dc7-48d8-9d93-2aabd5a13d10');
    assert.equal(FALLBACK_PICKEM_STATS.MLB.find((s) => s.label === 'Moneyline').id, '3f157ade-e2af-41ff-a5c6-9e0ca4f8c018');
    assert.equal(FALLBACK_PICKEM_STATS.NFL.find((s) => s.label === 'Moneyline').id, '0251dd94-773d-47ec-878d-8a7349b8b967');
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
    const pills = pickemStatsFromScaffold(scaffoldFor('CFB', FALLBACK_PICKEM_STATS.CFB[0].id));
    assert.deepEqual(pills.map((p) => p.label), ['Moneyline']);
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
          ? FALLBACK_PICKEM_STATS.CFB[0].id
          : '11111111-2222-4333-8444-555555555555';
        return jsonRes(200, scaffoldFor(sport, filterId));
      }
      if (String(url).includes('/lobbies/content/lines')) {
        const filterId = filterOf(url);
        if (sport === 'CFB' && filterId === FALLBACK_PICKEM_STATS.CFB[0].id) return jsonRes(200, cfbLines);
        if (sport === 'NFL' && filterId === FALLBACK_PICKEM_STATS.NFL[0].id) return jsonRes(200, nflLines);
        if (sport === 'MLB' && filterId === FALLBACK_PICKEM_STATS.MLB[0].id) return jsonRes(200, mlbLines);
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
    const mlb = res.body.games.find((g) => g.sport === 'MLB');
    assert.equal(mlb.away, 'Cleveland Guardians');
    assert.equal(mlb.lines.find((l) => l.name === 'Cleveland Guardians').american, 104);
    const cfb = res.body.games.find((g) => g.matchId === 224202);
    assert.equal(cfb.sport, 'NCAAF');
    assert.equal(cfb.lines.find((l) => l.name === 'Ole Miss Rebels').american, 127);
    const lineCalls = calls.filter((c) => c.url.includes('/lobbies/content/lines'));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'CFB' && filterOf(c.url) === FALLBACK_PICKEM_STATS.CFB[0].id));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'NFL' && filterOf(c.url) === FALLBACK_PICKEM_STATS.NFL[0].id));
    assert.ok(lineCalls.some((c) => sportOf(c.url) === 'MLB' && filterOf(c.url) === FALLBACK_PICKEM_STATS.MLB[0].id));
    assert.ok(calls.every((c) => c.url.includes(PHONE_EXPERIENCE_ID)));
    assert.equal(calls[0].headers.accept, 'application/json');
    assert.equal(calls[0].headers['client-type'], 'web');
    assert.equal(calls[0].headers['client-version'], '20260918170103');
    assert.ok(!calls.some((c) => /betstamp|over_under_lines|match_grouped_lines/i.test(c.url)));
    assert.ok(!calls.some((c) => c.url.includes(STICKER_EXPERIENCE_ID)));
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
        if (String(url).includes('/content/lines') && filterOf(url) === FALLBACK_PICKEM_STATS[sport][0].id) {
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

  console.log('underdog-predict.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
