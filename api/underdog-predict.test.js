'use strict';

const assert = require('node:assert/strict');
const handler = require('./underdog-predict');
const {
  DEFAULT_CLIENT_VERSION,
  DEFAULT_PRODUCT_EXPERIENCE_ID,
  DEFAULT_STATE_CONFIG_ID,
  linesFromContent,
  matchGroupedLinesUrl,
  readConfig,
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
    assert.match(url, new RegExp(`state_config_id=${DEFAULT_STATE_CONFIG_ID}`));
    assert.match(url, new RegExp(`product_experience_id=${PHONE_EXPERIENCE_ID}`));
    assert.doesNotMatch(url, /scaffolds/);
    assert.doesNotMatch(url, new RegExp(STICKER_EXPERIENCE_ID));
    assert.doesNotMatch(url, /betstamp|book_ids=196/);
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
      if (String(url).includes('/over_under_lines')) return jsonRes(200, indexBody);
      if (String(url).includes('/lobbies/content/match_grouped_lines') && String(url).includes('match_id=178911')) {
        return jsonRes(200, giantsContent);
      }
      return jsonRes(404, { error: { detail: 'missing' } });
    };
    const res = mockRes();
    await handler({ method: 'GET' }, res, { env: {}, cache: new Map(), fetchFn });
    assert.equal(res.body.missingConfig, false);
    assert.equal(res.body.games.length, 1);
    const game = res.body.games[0];
    const giants = game.lines.find((l) => l.name === 'New York Giants' && l.market === 'h2h');
    const rams = game.lines.find((l) => l.name === 'Los Angeles Rams' && l.market === 'h2h');
    assert.equal(giants.american, 245, 'phone odds.prediction, not fantasy +252');
    assert.equal(rams.american, -313);
    assert.notEqual(giants.american, 252);
    assert.notEqual(giants.american, 240);
    const priceCall = calls.find((c) => c.url.includes('/lobbies/content/match_grouped_lines'));
    assert.ok(priceCall, 'fetches match_grouped_lines');
    assert.match(priceCall.url, new RegExp(PHONE_EXPERIENCE_ID));
    assert.equal(priceCall.headers.accept, 'application/json');
    assert.equal(priceCall.headers['client-type'], 'web');
    assert.equal(priceCall.headers['client-version'], '20260918170103');
    assert.ok(!calls.some((c) => /scaffolds|betstamp/i.test(c.url)));
  }

  {
    const res = mockRes();
    await handler({ method: 'GET' }, res, {
      env: {},
      cache: new Map(),
      fetchFn: async (url) => {
        if (String(url).includes('/over_under_lines')) return jsonRes(200, indexBody);
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
        if (String(url).includes('/over_under_lines')) return jsonRes(200, indexBody);
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

  console.log('underdog-predict.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
