'use strict';
// Push alert copy + FCM HTTP v1 sender. OFF unless PUSH_NOTIFICATIONS_ENABLED=1.
// Needs (server env, never in the client): FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON.
// iOS goes through FCM with the APNs key uploaded in the Firebase console.
const crypto = require('node:crypto');

function american(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '';
  return v > 0 ? '+' + v : String(v);
}

const ALERTS = {
  lock_filled: (p = {}) => ({
    title: 'Combo Lock filled',
    body: `${p.label || 'Your lock'} filled${p.contracts ? ` · ${p.contracts} contracts` : ''}${p.american != null ? ` at ${american(p.american)}` : ''}.`,
    link: p.lockId ? `#combo/${p.lockId}` : '#combo',
  }),
  outbid: (p = {}) => ({
    title: 'Outbid on a Combo Lock',
    body: `${p.label || 'Your lock'}: best other seller ${american(p.bestAmerican)} vs your ${american(p.ourAmerican)}.`,
    link: p.lockId ? `#combo/${p.lockId}` : '#combo',
  }),
  ev_boost: (p = {}) => ({
    title: 'New +EV boost pick',
    body: `${p.book || 'Your book'}${p.boostPct ? ` ${p.boostPct}% boost` : ''}: ${p.legs || 'new pick'}${p.ev != null ? ` · est. +$${Number(p.ev).toFixed(2)} EV` : ''}`,
    link: '#promo',
  }),
};

function buildAlert(kind, payload) {
  const f = ALERTS[kind];
  if (!f) throw new Error('unknown alert ' + kind);
  const a = f(payload);
  a.body = a.body.replace(/guarantee(d)?|risk[- ]free/gi, 'est.').slice(0, 178);
  return { kind, ...a };
}

function pushEnabled(env = process.env) {
  return String(env.PUSH_NOTIFICATIONS_ENABLED || '') === '1';
}

function b64url(x) { return Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function fcmAccessToken(sa, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const jwt = head + '.' + claim + '.' + b64url(sig);
  const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  const j = await r.json();
  if (!j.access_token) throw new Error('fcm auth failed');
  return j.access_token;
}

// Sends one alert to every active token of a user who has that alert on.
async function sendPushAlert({ supabase, userId, kind, payload }, deps = {}) {
  const env = deps.env || process.env;
  if (!pushEnabled(env)) return { sent: 0, skipped: 'disabled' };
  const fetchImpl = deps.fetch || fetch;
  const alert = buildAlert(kind, payload);
  const { data: rows, error } = await supabase.from('push_tokens').select('id,token,alerts').eq('user_id', userId).is('disabled_at', null);
  if (error) return { sent: 0, error: error.message };
  const targets = (rows || []).filter((r) => !r.alerts || r.alerts[kind] !== false);
  if (!targets.length) return { sent: 0, skipped: 'no-tokens' };
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON || '{}');
  const project = env.FCM_PROJECT_ID || sa.project_id;
  const access = deps.accessToken || await fcmAccessToken(sa, fetchImpl);
  let sent = 0;
  for (const t of targets) {
    const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: t.token, notification: { title: alert.title, body: alert.body }, data: { kind, link: alert.link }, apns: { payload: { aps: { sound: 'default' } } } } }),
    });
    if (r.ok) sent++;
    else if (r.status === 404 || r.status === 400) await supabase.from('push_tokens').update({ disabled_at: new Date().toISOString() }).eq('id', t.id);
  }
  return { sent };
}

module.exports = { buildAlert, pushEnabled, sendPushAlert, ALERTS };
