'use strict';
// Auto-settle job: dry-run by default, owner/cron auth only, same planner as the
// page, conditional (idempotent) writes that never clobber a page-settled row.
const assert = require('node:assert/strict');
const job = require('./combo-auto-settle.js');

const KEVIN = '79ae1610-097e-4b46-a622-1e952f18e936';
const KENNY = '42b5ee16-68d5-4b3b-a931-40aa17cd1a47';
const OWNER = { id: KEVIN, email: 'kev120909@gmail.com' };

function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
const lit = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v);
function test(op, a, b) { if (op === 'eq') return a == b; if (op === 'neq') return a != b; if (op === 'is') return (a ?? null) === b; throw new Error(op); }
function orPred(e) {
  const ts = splitTop(e).map((t) => { const m = t.match(/^([a-z_]+)\.(not\.)?(eq|neq|is|in)\.(.*)$/); const [, c, n, op, raw] = m;
    const p = op === 'in' ? ((r) => raw.replace(/^\(|\)$/g, '').split(',').includes(String(r[c]))) : ((r) => test(op, r[c], lit(raw)));
    return n ? (r) => !p(r) : p; });
  return (r) => ts.some((t) => t(r));
}
function memClient(db, writes) {
  return {
    from(table) {
      const preds = []; let patch = null; let lim = null;
      const api = {
        select() { return api; }, order() { return api; },
        eq(c, v) { preds.push((r) => r[c] == v); return api; }, neq(c, v) { preds.push((r) => r[c] != v); return api; },
        is(c, v) { preds.push((r) => (r[c] ?? null) === v); return api; }, in(c, vs) { preds.push((r) => vs.includes(r[c])); return api; },
        not(c, op, v) { preds.push((r) => !test(op, r[c], v)); return api; }, or(e) { preds.push(orPred(e)); return api; },
        limit(n) { lim = n; return api; }, range(a, b) { lim = b - a + 1; return api; },
        update(p) { patch = p; return api; },
        then(ok, bad) {
          let rows = (db[table] || []).filter((r) => preds.every((p) => p(r)));
          if (patch) { rows.forEach((r) => Object.assign(r, patch)); writes.push({ table, n: rows.length, patch }); }
          if (lim != null) rows = rows.slice(0, lim);
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(ok, bad);
        },
      };
      return api;
    },
    auth: { async getUser(t) { return t === 'owner' ? { data: { user: OWNER }, error: null } : t === 'kenny' ? { data: { user: { id: KENNY, email: 'kmguido97@gmail.com' } }, error: null } : { data: null, error: {} }; } },
  };
}
const leg = (t, label) => ({ ticker: t, label, side: 'yes', type: 'moneyline' });
function freshDb() {
  return {
    combo_live_users: [],
    combo_parlays: [
      // Kenny: archived, unfilled, nothing stamped (like 85dd17ad on Oct 18).
      { id: 'k1', user_id: KENNY, label: 'Raiders ML + Colts ML', archived_at: '2026-10-19T00:00:00Z', created_at: '2026-10-18T15:00:00Z', starts_at: '2026-10-18T17:00:00Z',
        parlay_stake: 10, parlay_american: 894, fill_american: 762, bet_type: 'boost', is_free_bet: false, kalshi_result: null, underlying_result: null, combo_ticker: null,
        legs: [leg('KXNFLGAME-26OCT18BUFLV-LV', 'Raiders ML'), leg('KXNFLGAME-26OCT18TENIND-IND', 'Colts ML')] },
      // Already settled: never touched.
      { id: 'k0', user_id: KENNY, label: 'old', archived_at: '2026-10-12T00:00:00Z', created_at: '2026-10-11T15:00:00Z', kalshi_result: 'no', underlying_result: 'lost', combo_ticker: 'KXMVE-X', legs: [] },
    ],
    combo_fills: [], combo_submissions: [], quote_outcomes: [], combo_matches: [],
  };
}
const markets = { 'KXNFLGAME-26OCT18BUFLV-LV': { ticker: 'KXNFLGAME-26OCT18BUFLV-LV', status: 'finalized', result: 'no' }, 'KXNFLGAME-26OCT18TENIND-IND': { ticker: 'KXNFLGAME-26OCT18TENIND-IND', status: 'finalized', result: 'yes' } };
const urls = [];
const getJson = async (url) => { urls.push(url); if (url.startsWith('/api/kalshi-games')) { const t = decodeURIComponent(url.split('tickers=')[1]).split(','); return { markets: Object.fromEntries(t.filter((x) => markets[x]).map((x) => [x, markets[x]])) }; } return { games: [] }; };
function setup(env = {}) {
  const db = freshDb(); const writes = []; const logs = [];
  job._setDeps({ env: { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc', CRON_SECRET: 'cron-s', ...env },
    createClient: () => memClient(db, writes), getJson, now: () => Date.parse('2026-10-19T05:00:00Z'), log: (...a) => logs.push(a.join(' ')) });
  return { db, writes, logs };
}
function res() { const r = { code: 0, body: null }; r.setHeader = () => {}; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; }
const call = async (token, query = {}) => { const r = res(); await job({ method: 'GET', headers: token ? { authorization: 'Bearer ' + token } : {}, query }, r); return r; };

(async () => {
  // ── auth ──
  setup();
  assert.equal((await call(null)).code, 401);
  assert.equal((await call('nope')).code, 401);
  assert.equal((await call('kenny')).code, 403, 'a tester cannot run it');
  assert.equal((await call('cron-s')).code, 200, 'Vercel cron secret');
  assert.equal((await call('owner')).code, 200, 'owner session');

  // ── dry-run by default: plans, writes nothing ──
  let s = setup();
  let r = await call('cron-s');
  assert.equal(r.body.mode, 'dry-run');
  assert.equal(s.writes.length, 0, 'dry-run never writes');
  const kenny = r.body.users.find((u) => u.user_id === KENNY);
  assert.equal(kenny.patches.length, 1);
  assert.equal(kenny.patches[0].id, 'k1');
  assert.equal(kenny.patches[0].patch.underlying_result, 'lost');
  assert.equal(kenny.patches[0].pnl, -10, 'History P/L via buildComboStatement: unhedged $10 stake lost');
  assert.ok(s.logs.some((l) => l.includes('[combo-auto-settle]') && l.includes(KENNY)), 'logged per user');
  assert.ok(urls.every((u) => /^\/api\/(kalshi-games|espn-scores)\?/.test(u)), 'same routes the page reads');

  // ── write needs BOTH the env flag and no ?dry=1 ──
  s = setup({ COMBO_AUTO_SETTLE_WRITE: '1' });
  r = await call('cron-s', { dry: '1' });
  assert.equal(r.body.mode, 'dry-run'); assert.equal(s.writes.length, 0);
  r = await call('cron-s');
  assert.equal(r.body.mode, 'write');
  assert.equal(r.body.stamped, 1);
  assert.equal(s.db.combo_parlays.find((p) => p.id === 'k1').underlying_result, 'lost');
  assert.equal(s.db.combo_parlays.find((p) => p.id === 'k0').kalshi_result, 'no', 'settled row untouched');
  // Idempotent: a second run finds nothing to stamp.
  r = await call('cron-s');
  assert.equal(r.body.stamped, 0); assert.equal(r.body.planned, 0);

  // ── concurrent page settle: the conditional write skips a row the page already stamped ──
  s = setup({ COMBO_AUTO_SETTLE_WRITE: '1' });
  const origGet = getJson;
  job._setDeps({ getJson: async (u) => { const out = await origGet(u); const row = s.db.combo_parlays.find((p) => p.id === 'k1'); if (row && !row.underlying_result) Object.assign(row, { underlying_result: 'lost', underlying_source: 'espn' }); return out; } });
  r = await call('cron-s');
  assert.equal(r.body.stamped, 0, 'page won the race; job wrote nothing');
  assert.equal(s.db.combo_parlays.find((p) => p.id === 'k1').underlying_source, 'espn', "page's stamp kept");

  // ── caps exist and are sane ──
  assert.ok(job.CAPS.patchesPerRun > 0 && job.CAPS.patchesPerRun <= 200);
  assert.ok(job.CAPS.locksPerUser > 0 && job.CAPS.msBudget < 60000);
  job._resetDeps();
  console.log('combo-auto-settle tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
