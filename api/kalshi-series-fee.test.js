'use strict';
const assert = require('node:assert/strict');
const h = require('./kalshi-series-fee.js')._helpers;
assert.deepEqual(h.parseSeries({ series: 'kxmvecrosscategory0, KXMVECROSSCATEGORY,../x' }), ['KXMVECROSSCATEGORY0', 'KXMVECROSSCATEGORY']);
(async () => {
  const v = await h.lookup('TESTSERIES', async () => ({ ok: true, json: async () => ({ series: { fee_type: 'quadratic', fee_multiplier: 1 } }) }));
  assert.deepEqual({fee_type:v.fee_type,fee_multiplier:v.fee_multiplier}, { fee_type: 'quadratic', fee_multiplier: 1 });
  assert.ok(Number.isFinite(v.fetched_at));
  assert.equal(await h.lookup('TESTBAD', async () => ({ ok: false })), null);
  console.log('kalshi-series-fee.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
