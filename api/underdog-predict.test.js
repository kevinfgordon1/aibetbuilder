'use strict';

const assert = require('node:assert/strict');
const handler = require('./underdog-predict');
const { scaffoldUrl, readConfig, DEFAULT_CLIENT_VERSION } = require('../lib/underdog-lobby');

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

const giantsScaffold = {
  match_grouped_lines: [{
    title: 'Moneyline',
    options: [
      {
        selection_header: 'New York Giants',
        american_price: '+252',
        decimal_price: '3.52',
        odds: {
          prediction: { american: '+245', decimal: '3.45', probability: 27 },
          fantasy: { american: '+252', decimal: '3.52', probability: '27' },
        },
      },
      {
        selection_header: 'Los Angeles Rams',
        american_price: '-280',
        decimal_price: '1.36',
        odds: {
          prediction: { american: '-313', decimal: '1.32', probability: '74' },
          fantasy: { american: '-280', decimal: '1.36' },
        },
      },
    ],
  }],
};

const indexBody = {
  games: [{
    id: 178911,
    sport_id: 'NFL',
    status: 'scheduled',
    full_team_names_title: 'New York Giants @ Los Angeles Rams',
    scheduled_at: '2026-09-22T00:15:00Z',
  }, {
    id: 1,
    sport_id: 'MLB',
    status: 'scheduled',
    full_team_names_title: 'New York Yankees @ Boston Red Sox',
  }],
};

(async () => {
  {
    const res = mockRes();
    const calls = [];
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => { calls.push(String(url)); return jsonRes(200, {}); },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.missingConfig, true);
    assert.deepEqual(res.body.games, []);
    assert.equal(calls.length, 0, 'no Underdog call without state_config_id');
  }

  {
    const cfg = readConfig({
      UNDERDOG_STATE_CONFIG_ID: 'cfg-real',
      UNDERDOG_CLIENT_VERSION: '202609211200',
    });
    const url = scaffoldUrl(cfg, 178911);
    assert.match(url, /state_config_id=cfg-real/);
    assert.match(url, /match_id=178911/);
    assert.match(url, /include_prediction_markets=true/);
    assert.match(url, /product=fantasy/);
    assert.equal(DEFAULT_CLIENT_VERSION, '202609211200');
    assert.doesNotMatch(url, /betstamp|book_ids=196/);
  }

  {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(String(url));
      if (String(url).includes('/over_under_lines')) return jsonRes(200, indexBody);
      if (String(url).includes('match_id=178911')) return jsonRes(200, giantsScaffold);
      return jsonRes(404, { error: { detail: 'missing' } });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: { UNDERDOG_STATE_CONFIG_ID: 'cfg-real' },
      cache: new Map(),
      fetchFn,
    });
    assert.equal(res.body.missingConfig, false);
    assert.equal(res.body.games.length, 1);
    const game = res.body.games[0];
    assert.equal(game.away, 'New York Giants');
    assert.equal(game.home, 'Los Angeles Rams');
    const giants = game.lines.find((l) => l.name === 'New York Giants');
    const rams = game.lines.find((l) => l.name === 'Los Angeles Rams');
    assert.equal(giants.american, 245, 'phone odds.prediction, not fantasy +252');
    assert.equal(rams.american, -313);
    assert.notEqual(giants.american, 252);
    assert.notEqual(giants.american, 240);
    assert.ok(calls.some((u) => u.includes('/lobbies/scaffolds/matches')));
    assert.ok(!calls.some((u) => /betstamp/i.test(u)));
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: { UNDERDOG_STATE_CONFIG_ID: 'missing-id' },
      cache: new Map(),
      fetchFn: async (url) => {
        if (String(url).includes('/over_under_lines')) return jsonRes(200, indexBody);
        return jsonRes(404, { error: { detail: 'not found' } });
      },
    });
    assert.equal(res.body.configRejected, true);
    assert.deepEqual(res.body.games, [], 'rejected config does not invent a line');
  }

  console.log('underdog-predict.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
