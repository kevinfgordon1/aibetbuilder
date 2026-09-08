'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'odds-cache.js'), 'utf8');
assert.match(src, /loadSelectedSportsOdds/);
assert.match(src, /parseRequestedSports/);
assert.match(src, /eventSince/);
assert.match(src, /maxDuration: 30/);
assert.match(src, /GET only/);
assert.match(src, /req\.method !== 'GET'/);
assert.match(src, /status = out\.featured\.length \? 200 : 504/);

const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
assert.equal(vercel.functions['api/odds-cache.js'].maxDuration, 30);

console.log('odds-cache api tests passed');
