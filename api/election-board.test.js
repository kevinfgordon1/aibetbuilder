'use strict';

const assert = require('node:assert/strict');
const handler = require('./election-board');

function jsonRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; },
    end() { this.ended = true; },
  };
}

(async () => {
  const res = jsonRes();
  await handler({ method: 'GET', url: '/api/election-board' }, res, {
    loadElectionBoard: async () => ({
      ok: true,
      updatedAt: '2026-11-03T23:00:00Z',
      venues: { polymarket: { status: 'ok', races: 1 }, kalshi: { status: 'ok', races: 1 } },
      races: [{ id: 'senate:TX', title: 'Texas Senate', sides: [] }],
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.races[0].id, 'senate:TX');
  assert.equal(res.headers['Cache-Control'], 'no-store');

  const denied = jsonRes();
  await handler({ method: 'POST' }, denied, { loadElectionBoard: async () => ({ ok: true, races: [] }) });
  assert.equal(denied.statusCode, 405);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
