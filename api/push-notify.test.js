'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./push-notify');
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
test('401 without secret, disabled by default', async () => {
  let r = res(); await handler({ method: 'POST', headers: {} }, r, { env: {} }); assert.equal(r.code, 401);
  r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer s' }, body: {} }, r, { env: { PUSH_NOTIFY_SECRET: 's' } });
  assert.equal(r.body.skipped, 'disabled');
});
