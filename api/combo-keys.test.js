'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('./combo-keys.js');
const keys = require('./combo-keys-lib.js');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const T = 'dd23a3a8-cb45-4866-be11-df72b4767c26'; // the one approved tester
const EMAILS = { [KEVIN]: 'kev120909@gmail.com', [T]: 'gmoneyvikes@gmail.com' };
const STRANGER = '11111111-2222-4333-8444-555555555555';
const { privateKey: rsa } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = rsa.export({ type: 'pkcs1', format: 'pem' });
const { privateKey: ed } = crypto.generateKeyPairSync('ed25519');
const ED_PEM = ed.export({ type: 'pkcs8', format: 'pem' });
const PM_SECRET = crypto.randomBytes(64).toString('base64');
const KID = 'a1b2c3d4-e5f6-4711-8899-aabbccdd1234';

// --- lib: scope rules -------------------------------------------------------
{
  const ok = keys.assessKalshiKey({ api_key_id: KID, scopes: ['read', 'write::trade', 'write::transfer'] }, 9999999999, 1);
  assert.equal(ok.scopeStatus, 'ok');
  assert.equal(ok.autoFund, true);
  assert.deepEqual(ok.warnings, []);
  const full = keys.assessKalshiKey({ api_key_id: KID, scopes: ['read', 'write'] }, 9999999999, 1);
  assert.equal(full.autoFund, true, 'Full access enables auto-funding');
  assert.deepEqual(full.warnings, []);
  const tradeOnly = keys.assessKalshiKey({ api_key_id: KID, scopes: ['read', 'write::trade'] }, 9999999999, 1);
  assert.equal(tradeOnly.scopeStatus, 'ok', 'Read + Trade keys still connect and trade');
  assert.equal(tradeOnly.autoFund, false);
  assert.equal(tradeOnly.warnings.length, 1);
  assert.match(tradeOnly.warnings[0], /Auto-funding is off/);
  assert.match(tradeOnly.warnings[0], /Full access \(or check Transfers too\)/);
  const bad = (scopes, extra = {}, ts = 9999999999) => {
    try { keys.assessKalshiKey({ api_key_id: KID, scopes, ...extra }, ts, 100); return null; } catch (e) { return e.code; }
  };
  // Accepted.
  assert.equal(bad(['read', 'write']), null, 'Full access (old Read + Write format too)');
  assert.equal(bad(['read', 'write::trade', 'write']), null, 'Full access listed with Trade');
  assert.equal(bad(['read', 'write', 'write::block_trade_accept', 'write::transfer', 'write::trade']), null, 'Full access with its implied children');
  assert.equal(bad(['read', 'write::trade', 'write::transfer']), null);
  assert.equal(bad(['read', 'read::portfolio_balance', 'read::block_trade_accept', 'write::trade', 'write::transfer']), null, 'Kalshi screen: Read all data + Trade + Transfers');
  assert.equal(bad([' READ ', 'Write::Trade', 'WRITE::TRANSFER']), null, 'case/whitespace tolerant');
  assert.equal(bad(['read', 'write::trade']), null, 'Read + Trade only: accepted, auto-funding off');
  // Refused.
  assert.equal(bad(['write']), 'missing_read');
  assert.equal(bad(['read']), 'missing_trade');
  assert.equal(bad(['write::trade', 'write::transfer']), 'missing_read');
  assert.equal(bad(['read', 'write::transfer']), 'missing_trade', 'Transfers without Trade');
  assert.equal(bad(['read::portfolio_balance', 'write::trade', 'write::transfer']), 'missing_read', 'granular read only, no Read all data');
  assert.equal(bad(['read', 'write::trade', 'write::transfer', 'write::block_trade_accept']), 'extra_scope', 'Accept block trades on a granular key');
  assert.equal(bad(['read', 'write::trade', 'write::fcm_risk']), 'extra_scope');
  assert.equal(bad(['read', 'write::trade', 'write::something_new']), 'extra_scope', 'unknown write scope');
  assert.equal(bad(['read', 'write', 'admin']), 'extra_scope', 'unknown scope string even with Full access');
  assert.equal(bad(['read', 'write'], { subaccount: 3 }), 'subaccount_key');
  assert.equal(bad(['read', 'write::trade', 'write::transfer'], { subaccount: 0 }), 'subaccount_key');
  assert.equal(bad(['read', 'write'], {}, 50), 'attestation_lapsed');
  assert.equal(bad([]), 'missing_trade');
  {
    let msg = '';
    try { keys.assessKalshiKey({ api_key_id: KID, scopes: ['read'] }, 9999999999, 1); } catch (e) { msg = e.message; }
    assert.match(msg, /Trade is unchecked/);
    assert.match(msg, /Full access \(simplest\)/);
    assert.match(msg, /Read all data, Trade and Transfers/);
    try { keys.assessKalshiKey({ api_key_id: KID, scopes: ['read', 'write::trade', 'write::block_trade_accept'] }, 9999999999, 1); } catch (e) { msg = e.message; }
    assert.match(msg, /Accept block trades/);
  }
  assert.deepEqual(keys.classifyKalshiScopes(['read', 'write::trade', 'write::transfer', 'write::block_trade_accept']),
    { scopes: ['read', 'write::trade', 'write::transfer', 'write::block_trade_accept'], full: false, extra: ['write::block_trade_accept'], missing: [], autoFund: true });
  assert.equal(keys.kalshiAutoFund(['read', 'write']), true);
  assert.equal(keys.kalshiAutoFund(['read', 'write::trade', 'write::transfer']), true);
  assert.equal(keys.kalshiAutoFund(['read', 'write::trade']), false);
  assert.equal(keys.kalshiAutoFund(null), false);
  const noTs = keys.assessKalshiKey({ api_key_id: KID, scopes: ['read', 'write'] }, null);
  assert.equal(noTs.warnings.length, 1);
  const missing = keys.assessKalshiKey(null, null);
  assert.equal(missing.scopeStatus, 'unverified');
  assert.equal(missing.autoFund, false);
  assert.equal(keys.keyHint(KID), '1234');
  assert.equal(keys.maskedLabel('kalshi', '1234'), 'Kalshi connected ••••1234');
  // Ed25519 (Kalshi's default key type) is accepted and signs with plain Ed25519.
  const edParsed = keys.parseKalshiPem(ED_PEM);
  assert.equal(edParsed.key.asymmetricKeyType, 'ed25519');
  {
    const h = keys.kalshiHeaders(KID, edParsed.key, 'GET', '/trade-api/v2/api_keys', 1700000000000);
    const pub = crypto.createPublicKey(edParsed.key);
    assert.ok(crypto.verify(null, Buffer.from('1700000000000GET/trade-api/v2/api_keys'), pub, Buffer.from(h['KALSHI-ACCESS-SIGNATURE'], 'base64')));
  }
  // Ed25519 body pasted without BEGIN/END lines still parses (as PKCS#8).
  {
    const bare = ED_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const p2 = keys.parseKalshiPem(bare);
    assert.equal(p2.key.asymmetricKeyType, 'ed25519');
    assert.match(p2.pem, /^-----BEGIN PRIVATE KEY-----/);
  }
  // RSA still signs with RSA-PSS.
  {
    const r = keys.parseKalshiPem(RSA_PEM);
    const h = keys.kalshiHeaders(KID, r.key, 'GET', '/trade-api/v2/api_keys', 1700000000000);
    assert.ok(crypto.verify('sha256', Buffer.from('1700000000000GET/trade-api/v2/api_keys'), { key: crypto.createPublicKey(r.key), padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(h['KALSHI-ACCESS-SIGNATURE'], 'base64')));
  }
  {
    const { privateKey: ec } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    assert.throws(() => keys.parseKalshiPem(ec.export({ type: 'pkcs8', format: 'pem' })), /not a Kalshi API key/);
  }
  assert.throws(() => keys.parseKalshiPem('not a key'), /could not be read/);
  assert.throws(() => keys.cleanKeyId('x'), /key ID/);
  const row = keys.publicKeyRow({ venue: 'kalshi', key_hint: '1234', scope_status: 'ok', scopes: ['read', 'write'], key_id: KID, secret_id: 'v' });
  assert.equal(JSON.stringify(row).includes(KID), false);
  assert.equal(JSON.stringify(row).includes('secret'), false);
  assert.equal(row.autoFund, true);
  assert.equal(keys.publicKeyRow({ venue: 'kalshi', key_hint: '47df', scope_status: 'ok', scopes: ['read', 'write::trade'] }).autoFund, false, 'existing Read + Trade key (gmoneyvikes): trades, auto-funding off');
  assert.equal(keys.publicKeyRow({ venue: 'kalshi', key_hint: '1', scope_status: 'unverified', scopes: ['read', 'write'] }).autoFund, false, 'unverified scopes never auto-fund');
  assert.equal('autoFund' in keys.publicKeyRow({ venue: 'polymarket_us', key_hint: '1', scope_status: 'unverified' }), false);
}

// --- handler ----------------------------------------------------------------
function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function setup({ user, live = null, keyRows = [], fetchImpl } = {}) {
  if (user && user.id && !('email' in user)) user = { ...user, email: EMAILS[user.id] || 'someone@example.com' };
  const reads = [];
  const rpcs = [];
  const logs = [];
  const origErr = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  handler._setDeps({
    env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc', KALSHI_API_BASE: 'https://k.test/trade-api/v2', POLYMARKET_API_BASE: 'https://p.test' },
    fetchImpl,
    createClient(_u, key) {
      if (key === 'anon') return { auth: { async getUser(t) { return t === 'good' ? { data: { user }, error: null } : { data: null, error: { message: 'bad' } }; } } };
      return {
        from(table) {
          reads.push(table);
          const api = {
            select() { return api; },
            eq() { return table === 'combo_live_users' ? api : Promise.resolve({ data: keyRows, error: null }); },
            async maybeSingle() { return { data: live, error: null }; },
          };
          return api;
        },
        async rpc(name, args) {
          rpcs.push([name, args]);
          if (name === 'combo_exchange_key_put') keyRows = keyRows.filter((r) => r.venue !== args.p_venue).concat([{ venue: args.p_venue, key_hint: args.p_hint, scopes: args.p_scopes, scope_status: args.p_scope_status, verified_at: 'now', updated_at: 'now' }]);
          if (name === 'combo_exchange_key_delete') keyRows = keyRows.filter((r) => r.venue !== args.p_venue);
          return { data: null, error: null };
        },
      };
    },
  });
  return { rpcs, logs, reads, restore: () => { console.error = origErr; } };
}

const call = (method, body, query) => { const r = res(); return handler({ method, headers: { authorization: 'Bearer good' }, body, query: query || {} }, r).then(() => r); };
const APPROVED = { user_id: T, is_owner: false, can_trade: true, paused: false, max_per_lock_usd: 50, max_per_day_usd: 250 };

function kalshiFetch(scopes, extra = {}) {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return { ok: true, status: 200, async json() { return { api_keys: [{ api_key_id: KID, name: 'combo', scopes, ...extra }], api_key_region_expiration_ts: 9999999999 }; } };
  };
  f.seen = seen;
  return f;
}

(async () => {
  // Auth.
  {
    const s = setup({ user: { id: T } });
    const r = res(); await handler({ method: 'GET', headers: {}, query: {} }, r);
    assert.equal(r.code, 401);
    s.restore();
  }
  // Combo Locks is private: anyone outside COMBO_LOCKS_ACCOUNTS gets 403 on every
  // method, before any DB read, even if a combo_live_users row exists for them.
  for (const user of [{ id: STRANGER, email: 'random@example.com' }, { id: STRANGER, email: 'gmoneyvikes@gmail.com' }, { id: T, email: 'random@example.com' }, { id: '42b5ee16-68d5-4b3b-a931-40aa17cd1a47', email: 'kmguido97@gmail.com' }]) {
    const f = kalshiFetch(['read', 'write::trade']);
    const s = setup({ user, live: { ...APPROVED, user_id: user.id }, fetchImpl: f });
    assert.equal((await call('GET')).code, 403);
    assert.equal((await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM })).code, 403);
    assert.equal((await call('DELETE', null, { venue: 'kalshi' })).code, 403);
    assert.deepEqual(s.reads, []);
    assert.equal(s.rpcs.length, 0);
    assert.equal(f.seen.length, 0);
    s.restore();
  }
  // Not approved: GET shows approved=false; POST refused before contacting the exchange.
  {
    const f = kalshiFetch(['read', 'write::trade']);
    const s = setup({ user: { id: T }, live: null, fetchImpl: f });
    const g = await call('GET');
    assert.equal(g.code, 200);
    assert.equal(g.body.approved, false);
    assert.equal(g.headers['Cache-Control'], 'no-store');
    assert.equal(g.headers['Access-Control-Allow-Origin'], undefined, 'same-origin only');
    const p = await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM });
    assert.equal(p.code, 403);
    assert.equal(f.seen.length, 0);
    assert.equal(s.rpcs.length, 0);
    s.restore();
  }
  // Kevin is refused (his desk uses the server keys).
  {
    const s = setup({ user: { id: KEVIN }, live: { ...APPROVED, user_id: KEVIN, is_owner: true } });
    assert.equal((await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM })).code, 403);
    assert.equal((await call('GET')).body.owner, true);
    s.restore();
  }
  // Ed25519 key (Kalshi's default) with Kalshi's current scope list connects too.
  {
    const f = kalshiFetch(['read', 'read::portfolio_balance', 'read::block_trade_accept', 'write::trade']);
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: f });
    const p = await call('POST', JSON.stringify({ venue: 'kalshi', key_id: KID, secret: ED_PEM }));
    assert.equal(p.code, 200, JSON.stringify(p.body));
    const h = f.seen[0].headers;
    assert.ok(crypto.verify(null, Buffer.from(h['KALSHI-ACCESS-TIMESTAMP'] + 'GET/trade-api/v2/api_keys'), crypto.createPublicKey(ed), Buffer.from(h['KALSHI-ACCESS-SIGNATURE'], 'base64')));
    assert.equal(s.rpcs[0][1].p_scope_status, 'ok');
    assert.match(s.rpcs[0][1].p_secret, /BEGIN PRIVATE KEY/);
  }
  // Approved tester connects a Read+Trade Kalshi key: signed check, stored via RPC, masked reply.
  {
    const f = kalshiFetch(['read', 'write::trade']);
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: f });
    const p = await call('POST', JSON.stringify({ venue: 'kalshi', key_id: KID, secret: RSA_PEM }));
    assert.equal(p.code, 200, JSON.stringify(p.body));
    assert.equal(f.seen[0].url, 'https://k.test/trade-api/v2/api_keys');
    assert.equal(f.seen[0].headers['KALSHI-ACCESS-KEY'], KID);
    assert.ok(f.seen[0].headers['KALSHI-ACCESS-SIGNATURE']);
    const [name, args] = s.rpcs[0];
    assert.equal(name, 'combo_exchange_key_put');
    assert.equal(args.p_user, T);
    assert.equal(args.p_venue, 'kalshi');
    assert.equal(args.p_hint, '1234');
    assert.deepEqual(args.p_scopes, ['read', 'write::trade']);
    assert.equal(args.p_scope_status, 'ok');
    assert.equal(p.body.venues.kalshi.label, 'Kalshi connected ••••1234');
    assert.equal(p.body.venues.kalshi.autoFund, false);
    assert.match(p.body.warnings.join(' '), /Auto-funding is off/);
    assert.deepEqual(p.body.caps, { perLockUsd: 50, perDayUsd: 250 });
    const out = JSON.stringify(p.body);
    assert.ok(!out.includes(KID) && !out.includes('PRIVATE KEY'), 'reply never echoes the key');
    // Disconnect.
    const d = await call('DELETE', null, { venue: 'kalshi' });
    assert.equal(d.code, 200);
    assert.deepEqual(s.rpcs[1], ['combo_exchange_key_delete', { p_user: T, p_venue: 'kalshi' }]);
    assert.equal(d.body.venues.kalshi.connected, false);
    s.restore();
  }
  // Full access key connects with auto-funding on.
  {
    const f = kalshiFetch(['read', 'write']);
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: f });
    const p = await call('POST', { venue: 'kalshi', key_id: KID, secret: ED_PEM });
    assert.equal(p.code, 200, JSON.stringify(p.body));
    assert.deepEqual(s.rpcs[0][1].p_scopes, ['read', 'write']);
    assert.equal(p.body.venues.kalshi.autoFund, true);
    assert.deepEqual(p.body.warnings, []);
    s.restore();
  }
  // Read + Trade + Transfers connects with auto-funding on.
  {
    const f = kalshiFetch(['read', 'write::trade', 'write::transfer']);
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: f });
    const p = await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM });
    assert.equal(p.code, 200, JSON.stringify(p.body));
    assert.equal(p.body.venues.kalshi.autoFund, true);
    s.restore();
  }
  // Sub-account key / block-trade scope refused; nothing stored; secret not in logs or reply.
  for (const [scopes, extra, code] of [[['read', 'write'], { subaccount: 2 }, 'subaccount_key'], [['read', 'write::trade', 'write::transfer', 'write::block_trade_accept'], {}, 'extra_scope']]) {
    const f = kalshiFetch(scopes, extra);
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: f });
    const p = await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM });
    assert.equal(p.code, 400);
    assert.equal(p.body.code, code);
    assert.equal(s.rpcs.length, 0);
    assert.ok(!JSON.stringify(p.body).includes('PRIVATE KEY'));
    assert.ok(!s.logs.join('\n').includes('PRIVATE KEY'));
    s.restore();
  }
  // Kalshi rejects the pair.
  {
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: async () => ({ ok: false, status: 401, async json() { return {}; } }) });
    const p = await call('POST', { venue: 'kalshi', key_id: KID, secret: RSA_PEM });
    assert.equal(p.code, 400);
    assert.equal(p.body.code, 'venue_rejected');
    s.restore();
  }
  // Polymarket US: read-only signed check, stored as unverified (no scopes to inspect).
  {
    const seen = [];
    const s = setup({ user: { id: T }, live: APPROVED, fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, async json() { return {}; } }; } });
    const p = await call('POST', { venue: 'polymarket_us', key_id: 'pm-key-abcd9876', secret: PM_SECRET });
    assert.equal(p.code, 200, JSON.stringify(p.body));
    assert.equal(seen[0].url, 'https://p.test/v1/portfolio/positions');
    assert.equal(seen[0].init.method, 'GET');
    assert.equal(seen[0].init.headers['X-PM-Access-Key'], 'pm-key-abcd9876');
    assert.equal(s.rpcs[0][1].p_scope_status, 'unverified');
    assert.equal(p.body.venues.polymarket_us.label, 'Polymarket US connected ••••9876');
    assert.ok(!JSON.stringify(p.body).includes(PM_SECRET));
    const bad = await call('POST', { venue: 'polymarket_us', key_id: 'pm-key-abcd9876', secret: 'short' });
    assert.equal(bad.code, 400);
    s.restore();
  }
  // Paused testers may still disconnect; unknown venue rejected.
  {
    const s = setup({ user: { id: T }, live: { ...APPROVED, paused: true }, keyRows: [{ venue: 'kalshi', key_hint: '1234', scope_status: 'ok' }] });
    assert.equal((await call('DELETE', null, { venue: 'binance' })).code, 400);
    assert.equal((await call('DELETE', null, { venue: 'kalshi' })).code, 200);
    s.restore();
  }
  handler._resetDeps();
  console.log('combo-keys.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
