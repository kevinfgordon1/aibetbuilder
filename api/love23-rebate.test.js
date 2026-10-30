'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('./love23-rebate');
const nfl = require('../lib/fixtures-love23-schedule-nfl-2026-10-30.json');

function mockRes() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

function fakeDb(tables = {}) {
  const q = (name) => {
    const rows = tables[name] || [];
    const chain = {
      select: () => chain, in: () => chain, gt: () => chain, order: () => chain, limit: () => chain, eq: () => chain,
      single: async () => ({ data: rows[0] || null, error: null }),
      upsert: async () => ({ error: null }),
      insert: (row) => ({ select: () => ({ single: async () => ({ data: { id: 'x', ...row }, error: null }) }) }),
      then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return chain;
  };
  return { from: q };
}

test('route is owner-gated like the Live Trading Desk and never calls a wager endpoint', () => {
  const src = fs.readFileSync(path.join(__dirname, 'love23-rebate.js'), 'utf8');
  assert.match(src, /canSeeOwnerTools\(user\)/);
  assert.match(src, /import\('\.\.\/src\/comboAccess\.js'\)/);
  assert.doesNotMatch(src, /\/v1\/wagers/);
  assert.doesNotMatch(src, /LOVE23_(USERNAME|PASSWORD)\s*=\s*['"]/);
});

test('non-owner gets 403, no love23 call', async () => {
  let called = false;
  handler.setDeps({ requireOwner: async () => ({ ok: false, status: 403, error: 'Not allowed' }), love23: () => { called = true; return {}; } });
  const res = mockRes();
  await handler({ method: 'GET', query: { view: 'picks' }, headers: {} }, res);
  assert.equal(res.code, 403);
  assert.equal(called, false);
  handler.resetDeps();
});

test('picks view ranks hedged picks in American odds', async () => {
  const kick = '2026-11-01T18:00:00Z';
  const now = Date.parse(kick) - 86400000;
  const odds = [{
    sport: 'americanfootball_nfl', fetched_at: new Date(now - 60000).toISOString(), data: [{
      id: 'e1', commence_time: kick, home_team: 'Detroit Lions', away_team: 'Minnesota Vikings',
      bookmakers: [
        { key: 'pinnacle', markets: [{ key: 'h2h', outcomes: [{ name: 'Minnesota Vikings', price: 159 }, { name: 'Detroit Lions', price: -181 }] }] },
        { key: 'novig', markets: [{ key: 'h2h', outcomes: [{ name: 'Minnesota Vikings', price: 160 }, { name: 'Detroit Lions', price: -172 }] }] },
      ],
    }],
  }];
  handler.setDeps({
    requireOwner: async () => ({ ok: true, user: { email: 'kev120909@gmail.com' } }),
    love23: () => ({ schedule: async () => ({ data: nfl, fetchedAt: now, stale: false }) }),
    db: () => fakeDb({ odds_cache: odds, event_odds_cache: [] }),
    now: () => now,
  });
  const res = mockRes();
  await handler({ method: 'GET', query: { view: 'picks', carry: '1500', weekNet: '-2000' }, headers: {} }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.state.carry, 1500);
  assert.equal(res.body.state.weekNet, -2000);
  assert.equal(res.body.state.source, 'query');
  assert.equal(typeof res.body.weekly.expectedRebateThisWeek, 'number');
  assert.ok(res.body.weekly.pThisWeekPastCarry >= 0 && res.body.weekly.pThisWeekPastCarry <= 1);
  assert.ok(res.body.picks.length >= 1);
  const p = res.body.picks[0];
  assert.equal(p.hedge.venue, 'novig');
  assert.ok(Number.isInteger(p.love23American) && Math.abs(p.love23American) >= 100);
  assert.ok(Number.isInteger(p.hedge.american));
  assert.ok(p.stake <= 500);
  assert.equal(typeof p.totalHedged, 'number');
  assert.ok(!JSON.stringify(res.body).includes('access_token'));
  handler.resetDeps();
});

test('query config is clamped (max bet never above $500)', () => {
  const c = handler.cfgFromQuery({ maxBet: '5000', weeks: '-3', rate: '2', cap: '7500', credit: '0' });
  assert.equal(c.maxBet, 500);
  assert.equal(c.weeksLeft, 1);
  assert.equal(c.weeklyLossCap, 7500);
  assert.equal(c.creditLimit, null);
  assert.equal(c.weekStartDow, 2);
  assert.equal(c.rebateRate, 1);
});

test('hedge P&L from result', () => {
  assert.equal(handler.hedgePnl(-120, 600, 'won'), 500);
  assert.equal(handler.hedgePnl(-120, 600, 'lost'), -600);
  assert.equal(handler.hedgePnl(-120, 600, 'push'), 0);
});
