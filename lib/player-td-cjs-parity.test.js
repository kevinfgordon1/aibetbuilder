'use strict';

// lib/player-td.cjs is generated from lib/player-td.mjs by
// scripts/build-player-td-cjs.js. Fail when it drifts or when any .cjs
// requires an .mjs (Node API routes would crash on require of ESM).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const libDir = __dirname;
  const src = fs.readFileSync(path.join(libDir, 'player-td.mjs'), 'utf8');
  const out = fs.readFileSync(path.join(libDir, 'player-td.cjs'), 'utf8');
  const [line1, line2] = out.split('\n');
  assert.equal(line1, '// Generated from lib/player-td.mjs with esbuild (CommonJS for Node API routes). Do not edit by hand.');
  const hash = crypto.createHash('sha256').update(src).digest('hex');
  assert.equal(line2, `// Source sha256: ${hash}`, 'lib/player-td.cjs is stale. Run: node scripts/build-player-td-cjs.js');

  for (const name of fs.readdirSync(libDir)) {
    if (!name.endsWith('.cjs')) continue;
    const text = fs.readFileSync(path.join(libDir, name), 'utf8');
    assert.doesNotMatch(text, /require\(\s*["'][^"']*\.mjs["']\s*\)/, `${name} must not require an .mjs`);
  }

  const esm = await import(pathToFileURL(path.join(libDir, 'player-td.mjs')).href);
  const cjs = require('./player-td.cjs');
  const esmKeys = Object.keys(esm).filter((k) => k !== 'default').sort();
  assert.deepEqual(Object.keys(cjs).sort(), esmKeys);
  for (const key of esmKeys) assert.equal(typeof cjs[key], typeof esm[key], key);

  assert.equal(cjs.noAskAmericanFromYesBid(0.32, 0.07), esm.noAskAmericanFromYesBid(0.32, 0.07));
  assert.deepEqual(cjs.PLAYER_TD_EXCLUDED_BOOKS, esm.PLAYER_TD_EXCLUDED_BOOKS);
  const slot = { opp: { price: -150, book: 'kalshi', source: 'exchange' }, opps: [{ price: -150, book: 'kalshi', source: 'exchange', levels: [{ american: -150, size: 10 }] }] };
  assert.deepEqual(cjs.pickPlayerTdOpp(slot, ['kalshi']), esm.pickPlayerTdOpp(slot, ['kalshi']));

  console.log('player-td-cjs-parity.test.js ok');
})().catch((err) => { console.error(err); process.exit(1); });
