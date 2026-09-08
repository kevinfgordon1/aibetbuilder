'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'fetch-odds.js'), 'utf8');
assert.match(src, /runFetchOddsJob/);
assert.match(src, /parseRequestedSports/);
assert.match(src, /featuredOnly/);
assert.match(src, /maxDuration: 60/);
assert.match(src, /Promo Builder never calls this/);
assert.match(src, /res\.status\(200\)\.json\(\{ success: true, results \}\)/);

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
assert.equal(vercel.functions['api/fetch-odds.js'].maxDuration, 60);
assert.equal(vercel.functions['api/odds-cache.js'].maxDuration, 30);

console.log('fetch-odds api tests passed');
