'use strict';

// Vercel Node 20 loads api/*.js and lib/*.js as CommonJS (see api/package.json
// and lib/package.json). require() of an ES module throws ERR_REQUIRE_ESM and
// the function dies with FUNCTION_INVOCATION_FAILED before the handler runs.
//
// CI runs this file on Node 20 (.github/workflows/cjs-require-node20.yml).
// Newer Node can require() ESM unless --no-experimental-require-module is set;
// this process sets that flag when the runtime accepts it so the same crash
// still fails the check.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const major = Number(process.versions.node.split('.')[0]);

function flagSupported() {
  const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', 'process.exit(0)'], { encoding: 'utf8' });
  return r.status === 0;
}

const flags = flagSupported() ? ['--no-experimental-require-module'] : [];
if (major !== 20 && !flags.length) {
  console.error(`cjs require check needs Node 20 (got ${process.version})`);
  process.exit(1);
}

function list(dir) {
  return fs.readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map((name) => `${dir}/${name}`)
    .sort();
}

const files = [...list('lib'), ...list('api')];
if (!files.length) {
  console.error('cjs require check found no lib/*.js or api/*.js');
  process.exit(1);
}

const mjsRequire = /require\(\s*["'][^"']+\.mjs["']\s*\)/;
const failed = [];
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (mjsRequire.test(text)) {
    failed.push(`${rel} require()s an ES module (.mjs)`);
    continue;
  }
  // A few routes construct a Supabase client at load. Placeholder values let
  // that line finish so a missing local env is not a failed require(). Vercel
  // still crashes earlier, on ERR_REQUIRE_ESM, when a dependency is ESM.
  // Node 20 has no global WebSocket. Current @supabase/supabase-js throws while
  // evaluating createClient unless one is present. Vercel provides the runtime
  // the deployed client was published against; this only lets the require finish.
  const prelude = `if (typeof WebSocket === "undefined") { try { global.WebSocket = require("ws"); } catch (e) {} }`;
  const r = spawnSync(process.execPath, [...flags, '-e', `${prelude} require(${JSON.stringify('./' + rel)})`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL || 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'test-service-key',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'test-anon-key',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key',
    },
  });
  if (r.status !== 0) {
    const msg = String(r.stderr || r.stdout || (r.error && r.error.message) || '').trim().split('\n').slice(0, 8).join('\n');
    failed.push(`${rel}\n${msg}`);
  }
}

if (failed.length) {
  console.error(failed.join('\n\n'));
  process.exit(1);
}

const runtime = flags.length ? `${process.version} --no-experimental-require-module` : process.version;
console.log(`required ${files.length} lib/*.js and api/*.js on Node ${runtime}`);
