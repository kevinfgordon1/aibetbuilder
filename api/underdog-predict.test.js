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
  INDEX_SPORTS,
  MATCH_LIMIT,
  MATCH_LIMIT_CEILING,
  SPORT_BY_UNDERDOG_ID,
  gamesWithLines,
  indexGames,
  linesFromContent,
  matchGroupedLinesUrl,
  readConfig,
  sportLobbyUrl,
  widerMatchLimit,
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

function lobbyBody(games) {
  const body = { games: {}, match_groups: [], over_under_lines: {} };
  for (const game of games) {
    body.games[game.id] = {
      id: game.id,
      sport_id: game.sportId,
      status: game.status || 'scheduled',
      full_team_names_title: game.title,
      scheduled_at: game.scheduledAt || null,
    };
    const ids = [];
    for (const [i, row] of (game.lines || []).entries()) {
      const id = `${game.id}-${i}`;
      ids.push(id);
      body.over_under_lines[id] = row;
    }
    body.match_groups.push({ id: game.id, type: 'Game', over_under_line_ids: ids });
  }
  return body;
}

const nflLobby = lobbyBody([{
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
}]);

const mlbLobby = lobbyBody([{
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
}]);

const cfbLobby = lobbyBody([{
  id: 183024,
  sportId: 'CFB',
  title: 'Clemson Tigers @ California Golden Bears',
  scheduledAt: '2026-09-26T02:30:00Z',
  lines: [
    line('CLEM @ CAL Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
      opt('Clemson Tigers', 'away', 'Clemson to win', '-118'),
      opt('California Golden Bears', 'home', 'Cal to win', '-113'),
    ]),
  ],
}]);

const fantasyOnlyLobby = lobbyBody([{
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
}]);

function sportOf(url) {
  const match = /[?&]sport_id=([A-Z0-9]+)/.exec(String(url));
  return match ? match[1] : null;
}

function limitOf(url) {
  const match = /[?&]match_limit=(\d+)/.exec(String(url));
  return match ? Number(match[1]) : null;
}

function lobbiesFor(url) {
  const sport = sportOf(url);
  if (sport === 'NFL') return nflLobby;
  if (sport === 'MLB') return mlbLobby;
  if (sport === 'CFB') return cfbLobby;
  return { games: {}, match_groups: [], over_under_lines: {} };
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
    assert.match(url, /match_type=Game/);
    assert.match(url, /product=fantasy/);
    assert.match(url, /include_live=true/);
    assert.match(url, /show_more_picks_cta=false/);
    assert.match(url, /two_box_enabled_surface=false/);
    assert.equal(cfg.base, 'https://api.underdogfantasy.com');
    assert.match(url, /^https:\/\/api\.underdogfantasy\.com\/v1\/lobbies\/content\/match_grouped_lines\?/);
    assert.match(url, new RegExp(`state_config_id=${DEFAULT_STATE_CONFIG_ID}`));
    assert.match(url, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.doesNotMatch(url, /scaffolds/);
    assert.doesNotMatch(url, new RegExp(STICKER_EXPERIENCE_ID));
    assert.doesNotMatch(url, /betstamp|book_ids=196/);
    const cfbUrl = sportLobbyUrl(cfg, 'CFB', MATCH_LIMIT);
    assert.match(cfbUrl, /\/v1\/lobbies\/content\/match_grouped_lines\?/);
    assert.match(cfbUrl, /sport_id=CFB/);
    assert.match(cfbUrl, new RegExp(`match_limit=${MATCH_LIMIT}`));
    assert.match(cfbUrl, /market_categories(?:\[\]|%5B%5D)=core/);
    assert.match(cfbUrl, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.match(cfbUrl, new RegExp(`state_config_id=${DEFAULT_STATE_CONFIG_ID}`));
    assert.doesNotMatch(cfbUrl, /\/v1\/over_under_lines/);
    assert.doesNotMatch(cfbUrl, new RegExp(STICKER_EXPERIENCE_ID));
    assert.doesNotMatch(cfbUrl, /betstamp|book_ids=196/);
    assert.equal(widerMatchLimit(MATCH_LIMIT, MATCH_LIMIT), MATCH_LIMIT_CEILING);
    assert.equal(widerMatchLimit(226, MATCH_LIMIT), null);
    assert.equal(widerMatchLimit(MATCH_LIMIT_CEILING, MATCH_LIMIT_CEILING), null);
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
    const priced = gamesWithLines(cfbLobby, 'CFB');
    assert.equal(priced.length, 1);
    assert.equal(priced[0].sport, 'NCAAF');
    assert.equal(priced[0].away, 'Clemson Tigers');
    assert.equal(priced[0].lines.find((l) => l.market === 'h2h' && l.name === 'Clemson Tigers').american, -118);
    assert.deepEqual(gamesWithLines(fantasyOnlyLobby, 'CFB'), [], 'fantasy american is not a phone quote');
    const mlbPriced = gamesWithLines(mlbLobby, 'MLB');
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
      assert.doesNotMatch(String(url), /\/v1\/over_under_lines/);
      if (String(url).includes('/lobbies/content/match_grouped_lines')) return jsonRes(200, lobbiesFor(url));
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
    assert.notEqual(giants.american, 240);
    const mlb = res.body.games.find((g) => g.sport === 'MLB');
    assert.equal(mlb.away, 'Cleveland Guardians');
    assert.equal(mlb.lines.find((l) => l.name === 'Cleveland Guardians').american, 104);
    const cfb = res.body.games.find((g) => g.matchId === 183024);
    assert.equal(cfb.sport, 'NCAAF');
    assert.equal(cfb.lines.find((l) => l.name === 'Clemson Tigers').american, -118);
    const sports = calls.map((c) => sportOf(c.url));
    assert.deepEqual(sports.sort(), ['CFB', 'MLB', 'NFL']);
    assert.ok(calls.every((c) => c.url.includes('/lobbies/content/match_grouped_lines')));
    assert.ok(calls.every((c) => c.url.includes(PHONE_EXPERIENCE_ID)));
    assert.equal(calls[0].headers.accept, 'application/json');
    assert.equal(calls[0].headers['client-type'], 'web');
    assert.equal(calls[0].headers['client-version'], '20260918170103');
    assert.ok(!calls.some((c) => /scaffolds|betstamp|over_under_lines/i.test(c.url)));
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        if (String(url).includes('match_grouped_lines')) return jsonRes(200, scaffoldSectionsOnly);
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
        if (String(url).includes('match_grouped_lines')) return jsonRes(404, { error: { detail: 'not found' } });
        return jsonRes(404, {});
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
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      const sport = sportOf(url);
      const limit = limitOf(url);
      if (sport === 'CFB' && limit === 1) return jsonRes(200, cfbLobby);
      if (sport === 'CFB' && limit === MATCH_LIMIT_CEILING) {
        return jsonRes(200, lobbyBody([
          cfbLobby.games[183024] && {
            id: 183024,
            sportId: 'CFB',
            title: 'Clemson Tigers @ California Golden Bears',
            lines: cfbLobby.over_under_lines['183024-0'] ? [cfbLobby.over_under_lines['183024-0']] : [],
          },
          {
            id: 187129,
            sportId: 'CFB',
            title: 'Texas Longhorns @ Tennessee Volunteers',
            lines: [
              line('TEX @ TENN Moneyline', 'moneyline', 'Moneyline', 'moneyline', null, [
                opt('Texas Longhorns', 'away', 'Texas to win', '+140'),
                opt('Tennessee Volunteers', 'home', 'Tennessee to win', '-166'),
              ]),
            ],
          },
        ].filter((g) => g && g.id)));
      }
      if (limit === 1) return jsonRes(200, sport === 'MLB' ? mlbLobby : nflLobby);
      return jsonRes(200, lobbiesFor(url));
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn, matchLimit: 1 });
    assert.equal(res.body.games.filter((g) => g.sport === 'NCAAF').length, 2, 'a full limit is refetched once');
    assert.ok(calls.some((url) => sportOf(url) === 'CFB' && limitOf(url) === 1));
    assert.ok(calls.some((url) => sportOf(url) === 'CFB' && limitOf(url) === MATCH_LIMIT_CEILING));
    assert.ok(res.body.games.some((g) => g.matchId === 187129 && g.sport === 'NCAAF'));
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        if (sportOf(url) === 'MLB') return jsonRes(404, { error: { detail: 'not found' } });
        return jsonRes(200, lobbiesFor(url));
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
