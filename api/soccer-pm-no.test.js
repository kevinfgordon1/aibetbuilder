'use strict';

const assert = require('node:assert/strict');
const handler = require('./soccer-pm-no.js');

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; },
    end() { return this; },
  };
}

{
  const res = mockRes();
  handler({ method: 'GET' }, res);
  assert.equal(res.out.statusCode, 405);
  assert.ok(res.out.body.venues.includes('kalshi'));
  assert.ok(res.out.body.venues.includes('polymarket'));
}

(async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { games: [] } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.deepEqual(res.out.body.quotes, {});
  console.log('soccer-pm-no api tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
