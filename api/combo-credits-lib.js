// Server mirror of src/comboCredits.js presets (CommonJS). Parity is tested in
// src/comboCredits.test.js.
'use strict';

/** Minimum credits purchase (Stripe and Coinbase). Bought credits never expire. */
const MIN_PURCHASE_USD = 10;
const CREDIT_PRESETS_USD = Object.freeze([10, 25, 50, 100]);
/** Max checkouts one user may open per hour (spam guard). */
const MAX_CHECKOUTS_PER_HOUR = 6;

function isPresetAmount(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= MIN_PURCHASE_USD && CREDIT_PRESETS_USD.includes(v);
}

/** Only redirect back to our own site (prod or a Vercel preview). */
function siteOrigin(req, env) {
  const e = env || process.env;
  const headers = (req && req.headers) || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim().toLowerCase();
  if (/^([a-z0-9-]+\.)*aibetbuilder\.io$/.test(host) || /^[a-z0-9-]+\.vercel\.app$/.test(host)) return `https://${host}`;
  const configured = String(e.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  return configured || 'https://aibetbuilder.io';
}

module.exports = { MIN_PURCHASE_USD, CREDIT_PRESETS_USD, MAX_CHECKOUTS_PER_HOUR, isPresetAmount, siteOrigin };
