'use strict';

const assert = require('node:assert/strict');
const handler = require('./share.js');
const { parseSharePath, esc } = handler._helpers;

assert.deepEqual(parseSharePath('promo/boost.draftkings.100.abc'), {
  tab: 'promo', rest: 'boost.draftkings.100.abc', raw: 'promo/boost.draftkings.100.abc',
});
assert.deepEqual(parseSharePath('#combo/lock-1'), {
  tab: 'combo', rest: 'lock-1', raw: 'combo/lock-1',
});
assert.equal(parseSharePath('').tab, 'promo');
assert.equal(esc('<script>"x"&'), '&lt;script&gt;&quot;x&quot;&amp;');

function run(query, url) {
  let status = 0;
  let body = '';
  const headers = {};
  const res = {
    statusCode: 0,
    setHeader(k, v) { headers[k] = v; },
    end(s) { status = this.statusCode; body = s; },
  };
  handler({ query, url, headers: { host: 'aibetbuilder.io', 'x-forwarded-proto': 'https' } }, res);
  return { status, body, headers };
}

{
  const { status, body } = run({ p: 'promo/boost.draftkings.100.k3' });
  assert.equal(status, 200);
  assert.match(body, /og:title/);
  assert.match(body, /Promo pick/);
  assert.match(body, /#promo\/boost\.draftkings\.100\.k3/);
  assert.doesNotMatch(body, /lock-/);
}

{
  const { body } = run({ p: 'combo/secret-lock-99' });
  assert.match(body, /Sign in to continue/);
  assert.doesNotMatch(body, /secret-lock-99 legs|Combo Locks parlay|fill odds/i);
  assert.match(body, /og:title" content="AI Bet Builder"/);
  // Destination may include the id so allowed users land on the lock; OG copy does not describe it.
  assert.match(body, /#combo\/secret-lock-99/);
}

{
  const { body } = run({}, '/s/ev/draftkings.abc');
  assert.match(body, /\+EV pick/);
  assert.match(body, /#ev\/draftkings\.abc/);
}

console.log('api/share.test.js ok');
