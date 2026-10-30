'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLove23Client, assertAllowedPath, readCreds, BACKOFF_BASE_MS } = require('./love23-client');

test('wager, proxy and unknown endpoints are refused before any request', () => {
  for (const p of ['/v1/wagers/0/send', '/v1/wagers/1/compile', '/v1/proxy/wager/teasers', '/v1/proxy/player/history']) {
    assert.throws(() => assertAllowedPath('POST', p), /read-only|not allowed/);
    assert.throws(() => assertAllowedPath('GET', p), /read-only|not allowed/);
  }
  assert.throws(() => assertAllowedPath('GET', '/v1/players/anything'));
  assert.throws(() => assertAllowedPath('POST', '/v1/players/me'));
  assert.doesNotThrow(() => assertAllowedPath('GET', '/v1/sports/schedule?leagueIds=1,2&route_id=0'));
  assert.doesNotThrow(() => assertAllowedPath('POST', '/v1/auth/login'));
});

test('the module source never names a wager endpoint', () => {
  const src = require('node:fs').readFileSync(require.resolve('./love23-client'), 'utf8');
  assert.doesNotMatch(src, /wagers\/\$\{|\/send['"`]|\/compile['"`]/);
});

test('creds come from env only', () => {
  assert.equal(readCreds({}), null);
  assert.deepEqual(readCreds({ LOVE23_USERNAME: ' u ', LOVE23_PASSWORD: 'p' }), { username: 'u', password: 'p' });
});

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, method: opts.method, auth: opts.headers.authorization || null });
    const step = script(url, opts, calls.length);
    return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => JSON.stringify(step.body ?? {}) };
  };
  fn.calls = calls;
  return fn;
}

test('logs in once, caches schedule 30s, backs off on 5xx and serves stale', async () => {
  let t = 1_000_000;
  let fail = false;
  const f = fakeFetch((url) => {
    if (url.endsWith('/v1/auth/login')) return { status: 200, body: { access_token: 'A', refresh_token: 'R', expires_in: 3600, refresh_expires_in: 86400 } };
    if (url.includes('/v1/sports/schedule')) return fail ? { status: 503, body: { detail: 'down' } } : { status: 200, body: [{ id: 1 }] };
    return { status: 404 };
  });
  const c = createLove23Client({ creds: () => ({ username: 'u', password: 'p' }), fetchImpl: f, now: () => t, base: 'https://x' });
  const a = await c.schedule([1]);
  assert.deepEqual(a.data, [{ id: 1 }]);
  assert.equal(f.calls.filter((x) => x.url.endsWith('/login')).length, 1);
  assert.equal(f.calls.find((x) => x.url.includes('schedule')).auth, 'Bearer A');
  t += 10_000;
  const b = await c.schedule([1]);
  assert.equal(b.cached, true);
  t += 31_000;
  fail = true;
  const s = await c.schedule([1]);
  assert.equal(s.stale, true);
  assert.ok(s.backoffUntil >= t + BACKOFF_BASE_MS);
  const n = f.calls.length;
  t += 5_000;
  await c.schedule([1]); // inside backoff -> no network
  assert.equal(f.calls.length, n);
});

test('a 401 (session revoked) triggers one re-login', async () => {
  let logins = 0;
  let first = true;
  const f = fakeFetch((url) => {
    if (url.endsWith('/v1/auth/login')) { logins += 1; return { status: 200, body: { access_token: 'T' + logins, refresh_token: 'R', expires_in: 3600, refresh_expires_in: 86400 } }; }
    if (url.includes('/balance')) { if (first) { first = false; return { status: 401, body: { detail: 'expired' } }; } return { status: 200, body: { credit: 5000 } }; }
    return { status: 404 };
  });
  const c = createLove23Client({ creds: () => ({ username: 'u', password: 'p' }), fetchImpl: f, base: 'https://x' });
  const r = await c.balance();
  assert.equal(r.data.credit, 5000);
  assert.equal(logins, 2);
});

test('missing creds is a clear 503, not a crash', async () => {
  const c = createLove23Client({ creds: () => null, fetchImpl: async () => { throw new Error('no network'); }, base: 'https://x' });
  await assert.rejects(() => c.balance(), (e) => e.status === 503 && /LOVE23_USERNAME/.test(e.message));
});
