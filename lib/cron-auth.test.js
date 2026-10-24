'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireCronOrOwner } = require('./cron-auth');

const OWNER = { id: '79ae1610-097e-4b46-a622-1e952f18e936', email: 'kev120909@gmail.com' };
const mkClient = (user) => () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : new Error('bad') }) } });
const env = { CRON_SECRET: 's3cret-value-xyz', SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon' };
const req = (h) => ({ headers: h ? { authorization: h } : {} });

(async () => {
  assert.equal((await requireCronOrOwner(req(), { env })).status, 401);
  assert.equal((await requireCronOrOwner(req('Bearer s3cret-value-xyz'), { env })).via, 'cron');
  assert.equal((await requireCronOrOwner(req('Bearer wrong'), { env, createClient: mkClient(null) })).status, 401);
  assert.equal((await requireCronOrOwner(req('Bearer jwt'), { env, createClient: mkClient(OWNER) })).via, 'owner');
  assert.equal((await requireCronOrOwner(req('Bearer jwt'), { env, createClient: mkClient({ id: 'u2', email: 'x@y.z' }) })).status, 403);
  // No CRON_SECRET: secret-looking token must not pass.
  assert.equal((await requireCronOrOwner(req('Bearer undefined'), { env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a' }, createClient: mkClient(null) })).ok, false);
  for (const f of ['fetch-odds', 'fetch-futures', 'fetch-player-props', 'scan-ev-parlays']) {
    const src = fs.readFileSync(path.join(__dirname, '../api', f + '.js'), 'utf8');
    assert.match(src, /guardCron\(req, res/, f + ' must be gated');
  }
  console.log('cron-auth tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
