'use strict';
// Pending-lock "Check market price" (POST /api/combo-probe { lockId }).
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('crypto');
const handler = require('./combo-probe.js');
const lib = require('./combo-probe-lib');
const lc = require('./combo-lock-check-lib');

const KEVIN = { email: 'kev120909@gmail.com', id: lib.OWNER_USER_ID };
const HIGGINS = { email: 'c.w.higgins1@gmail.com', id: '721c1166-be0b-4856-8a88-6de3a8b047b9' };
const KENNY = { email: 'kmguido97@gmail.com', id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47' };
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

function mockRes() {
  const out = { statusCode: 0, body: null };
  return { out, setHeader() {}, status(c) { out.statusCode = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
}
const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body == null ? '' : JSON.stringify(body)) });

const lock = (over = {}) => ({
  id: 'lock-1', user_id: HIGGINS.id, active: true, paused: false, max_contracts: 120, fill_american: 302,
  combo_ticker: 'KXMVESPORTSMULTIGAMEEXTENDED-S1-X', mve_collection: 'KXMVESPORTSMULTIGAMEEXTENDED-R',
  legs: [{ ticker: 'KXNFLGAME-26OCT11GBMIN-GB', side: 'yes' }, { ticker: 'KXNFLGAME-26OCT11GBMIN-MIN', side: 'no' }],
  ...over,
});

// ── pure helpers ──
assert.equal(lc.LOCK_CHECK_WAIT_MS, 10_000);
assert.equal(lc.PROBE_PAUSE_MAX_MS, 30_000);
assert.equal(lc.lockCheckAccess(lock(), HIGGINS).ok, true);
assert.equal(lc.lockCheckAccess(lock(), KENNY).status, 403, 'not your lock');
assert.equal(lc.lockCheckAccess(lock(), KEVIN).status, 403, 'owner does not run checks on a tester lock (would need the tester key)');
assert.equal(lc.lockCheckAccess(null, HIGGINS).status, 404);
{
  const r = lc.lockCheckAccess(lock({ combo_ticker: 'caoc-abc' }), HIGGINS);
  assert.equal(r.ok, false); assert.equal(r.polyNotAvailable, true); assert.match(r.error, /Polymarket/);
}
assert.equal(lc.credsPlanFor(lock({ user_id: KEVIN.id }), lib.OWNER_USER_ID), 'owner-env');
assert.equal(lc.credsPlanFor(lock(), lib.OWNER_USER_ID), 'user-vault');
assert.deepEqual(lc.probePausePatch(Date.parse('2026-10-10T23:00:00Z')), {
  probe_paused_at: '2026-10-10T23:00:00.000Z', probe_pause_until: '2026-10-10T23:00:30.000Z',
});
assert.equal(lc.isMissingProbePauseColumn({ message: "Could not find the 'probe_paused_at' column of 'combo_parlays' in the schema cache" }), true);
assert.equal(lc.isMissingProbePauseColumn({ message: 'permission denied' }), false);
assert.deepEqual(lc.competitorQuotes([
  { id: 'q-self', creator_id: 'me' }, { id: 'q-own-open' , creator_id: 'other' }, { id: 'q-x', creator_id: 'other' },
], { selfCreatorId: 'me', ownQuoteIds: ['q-own-open'] }).map((q) => q.id), ['q-x']);

// ── end to end with stubbed I/O ──
function setup({ parlay, liveSeq = [[]], kalshiOver = {}, setPauseErr = null, user = HIGGINS, vault = true }) {
  let now = 2_000_000;
  const calls = []; const db = [];
  let liveI = 0;
  handler._resetDeps();
  handler._setDeps({
    requireProbeUser: async () => ({ ok: true, user, isOwner: user.id === KEVIN.id }),
    kalshiCreds: () => { calls.push({ creds: 'env' }); return { ok: true, keyId: 'kevin-env', pem }; },
    loadUserKalshiCreds: async (uid) => { calls.push({ creds: 'vault', uid }); return vault ? { ok: true, keyId: 'vault-' + uid, pem } : { ok: false, status: 400, error: lib.CONNECT_KALSHI_ERROR, needKalshiKey: true }; },
    loadParlay: async () => ({ ok: true, parlay }),
    setProbePause: async (id, t) => { db.push(['pause', id, t]); return setPauseErr || { ok: true, pausedAt: new Date(t).toISOString() }; },
    clearProbePause: async (id, at) => { db.push(['resume', id, at]); return { ok: true }; },
    liveQuoteIds: async () => { const ids = liveSeq[Math.min(liveI++, liveSeq.length - 1)]; return { ok: true, ids }; },
    now: () => now,
    sleep: async (ms) => { now += ms; },
    fetchImpl: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const path = new URL(url).pathname;
      const key = (opts && opts.headers && (opts.headers['KALSHI-ACCESS-KEY'] || opts.headers['kalshi-access-key'])) || null;
      calls.push({ method, path, key, at: now });
      if (/accept|confirm/i.test(path)) throw new Error('MUST NOT accept/confirm');
      if (kalshiOver[`${method} ${path.split('/').slice(-1)[0]}`]) return kalshiOver[`${method} ${path.split('/').slice(-1)[0]}`]();
      if (method === 'GET' && path.includes('/multivariate_event_collections/')) return jsonRes(404, {});
      if (method === 'POST' && path.includes('/multivariate_event_collections/')) return jsonRes(200, { market_ticker: 'KXMVE-COMBO-1' });
      if (method === 'GET' && path.includes('/series/')) return jsonRes(200, { series: { fee_type: 'quadratic', fee_multiplier: 1 } });
      if (method === 'GET' && path.endsWith('/communications/id')) return jsonRes(200, { communications_id: 'me' });
      if (method === 'POST' && path.endsWith('/communications/rfqs')) return jsonRes(201, { id: 'rfq-lc-1' });
      if (method === 'GET' && path.endsWith('/communications/quotes')) {
        // A late seller arrives after 6s — must be caught because we keep collecting 10s.
        const qs = [{ id: 'q-self', creator_id: 'me', no_bid_dollars: '0.99', status: 'open' },
          { id: 'q-a', creator_id: 'mm1', no_bid_dollars: '0.70', status: 'open' }];
        if (now - calls.find((c) => c.path && c.path.endsWith('/communications/rfqs')).at >= 6000) qs.push({ id: 'q-late', creator_id: 'mm2', no_bid_dollars: '0.74', status: 'open' });
        return jsonRes(200, { quotes: qs });
      }
      if (method === 'DELETE' && path.endsWith('/rfqs/rfq-lc-1')) return jsonRes(204, null);
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  return { calls, db, nowFn: () => now };
}
const call = async (body = { lockId: 'lock-1' }) => { const res = mockRes(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res); return res.out; };

(async () => {
  // Tester (Higgins) on his own lock: his Vault key, never Kevin's env key; pause → settle → RFQ 10s → delete → resume.
  {
    const s = setup({ parlay: lock(), liveSeq: [['q-own-open'], ['q-own-open'], []] });
    const out = await call();
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const b = out.body;
    assert.equal(b.credsSource, 'user-vault');
    assert.ok(s.calls.some((c) => c.creds === 'vault' && c.uid === HIGGINS.id));
    assert.ok(!s.calls.some((c) => c.creds === 'env'), 'never Kevin key for a tester');
    assert.equal(b.bestNoBid, 0.74, 'late competitor caught; own quote (0.99) excluded');
    assert.equal(b.competitorCount, 2);
    assert.equal(b.ownQuotesExcluded, 1);
    assert.equal(b.makerRate, 0);
    assert.ok(b.waitedMs >= 10_000, `collected full 10s, got ${b.waitedMs}`);
    assert.equal(b.pauseSettleMs, 2000);
    assert.ok(b.checkedAt);
    assert.deepEqual(s.db.map((d) => d[0]), ['pause', 'resume']);
    const rfqAt = s.calls.find((c) => c.path && c.path.endsWith('/communications/rfqs')).at;
    assert.ok(rfqAt - s.db[0][2] >= 2000, 'RFQ only after own quotes cleared');
    assert.ok(s.calls.some((c) => c.method === 'DELETE'));
    assert.ok(s.calls.every((c) => !c.path || !/accept|confirm/.test(c.path)));
  }
  // Rate limit per user: second check within 60s → 429, no pause.
  {
    const s = setup({ parlay: lock() });
    assert.equal((await call()).statusCode, 200);
    handler._setDeps({ setProbePause: async () => { throw new Error('should not pause'); } });
    const out = await call();
    assert.equal(out.statusCode, 429);
    assert.match(out.body.error, /Slow down/);
    void s;
  }
  // Kevin on his own lock → server key.
  {
    const s = setup({ parlay: lock({ user_id: KEVIN.id }), user: KEVIN });
    const out = await call();
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.body.credsSource, 'owner-env');
    assert.ok(!s.calls.some((c) => c.creds === 'vault'));
  }
  // Polymarket lock → clear not-available, nothing paused.
  {
    const s = setup({ parlay: lock({ combo_ticker: 'caoc-xyz' }) });
    const out = await call();
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.polyNotAvailable, true);
    assert.equal(s.db.length, 0);
  }
  // Someone else's lock → 403, nothing paused.
  {
    const s = setup({ parlay: lock(), user: KENNY });
    assert.equal((await call()).statusCode, 403);
    assert.equal(s.db.length, 0);
  }
  // Kalshi error mid-check → still resumed, RFQ never left open.
  {
    const s = setup({ parlay: lock(), kalshiOver: { 'POST rfqs': () => jsonRes(500, { error: { message: 'boom' } }) } });
    const out = await call();
    assert.equal(out.statusCode, 500);
    assert.deepEqual(s.db.map((d) => d[0]), ['pause', 'resume']);
  }
  // Network throw while collecting → resumed + RFQ deleted.
  {
    const s = setup({ parlay: lock(), kalshiOver: { 'GET quotes': () => { throw new Error('net down'); } } });
    const out = await call();
    assert.equal(out.statusCode, 502);
    assert.deepEqual(s.db.map((d) => d[0]), ['pause', 'resume']);
    assert.ok(s.calls.some((c) => c.method === 'DELETE'));
  }
  // Lock already paused by the user → no probe pause written/cleared.
  {
    const s = setup({ parlay: lock({ paused: true }) });
    const out = await call();
    assert.equal(out.statusCode, 200);
    assert.equal(out.body.alreadyPaused, true);
    assert.equal(s.db.length, 0);
  }
  // Column missing → clear message, no RFQ.
  {
    const s = setup({ parlay: lock(), setPauseErr: { ok: false, missingColumn: true } });
    const out = await call();
    assert.equal(out.statusCode, 503);
    assert.match(out.body.error, /database update/);
    assert.ok(!s.calls.some((c) => c.path && c.path.endsWith('/communications/rfqs')));
  }
  // Tester with no key → Connect Kalshi, nothing paused.
  {
    const s = setup({ parlay: lock(), vault: false });
    const out = await call();
    assert.equal(out.statusCode, 400);
    assert.equal(out.body.needKalshiKey, true);
    assert.equal(s.db.length, 0);
  }
  handler._resetDeps();
  console.log('combo-lock-check.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
