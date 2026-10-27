'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAlert, pushEnabled, sendPushAlert } = require('./push-alerts');
test('alert copy, American odds, no guaranteed wording', () => {
  assert.match(buildAlert('lock_filled', { label: 'Rockets/Pacers', contracts: 40, american: 1060, lockId: 'x' }).body, /\+1060/);
  assert.equal(buildAlert('outbid', { lockId: 'y', bestAmerican: 1780, ourAmerican: 1600 }).link, '#combo/y');
  assert.match(buildAlert('ev_boost', { book: 'DraftKings', boostPct: 30, legs: 'Army ML +195', ev: 24 }).body, /est\. \+\$24\.00 EV/);
  assert.doesNotMatch(buildAlert('lock_filled', { label: 'guaranteed risk-free' }).body, /guarantee|risk-free/i);
});
test('flag defaults off; no network when off', async () => {
  assert.equal(pushEnabled({}), false);
  const r = await sendPushAlert({ supabase: null, userId: 'u', kind: 'outbid', payload: {} }, { env: {}, fetch: () => { throw new Error('no'); } });
  assert.equal(r.skipped, 'disabled');
});
test('sends to opted-in tokens only', async () => {
  const calls = [];
  const sb = { from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: [{ id: 1, token: 'a', alerts: { outbid: true } }, { id: 2, token: 'b', alerts: { outbid: false } }] }) }) }) }) };
  const r = await sendPushAlert({ supabase: sb, userId: 'u', kind: 'outbid', payload: {} }, { env: { PUSH_NOTIFICATIONS_ENABLED: '1', FCM_PROJECT_ID: 'p' }, accessToken: 't', fetch: async (u, o) => { calls.push(JSON.parse(o.body).message.token); return { ok: true }; } });
  assert.equal(r.sent, 1); assert.deepEqual(calls, ['a']);
});
