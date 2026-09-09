// Pure Combo Locks Probe helpers — quote picking + American conversion.
// Kevin sells NO as maker. Competing makers quote no_bid / yes_bid; we report
// the best (highest) NO bid and the after-maker-fee American that belongs in
// the Add Parlay fill field. Never accept / confirm.
'use strict';

const KFEE = 0.0175; // ComboLocks fill field is net of maker fee
const DEFAULT_WAIT_MS = 4000;
const MIN_WAIT_MS = 2000;
const MAX_WAIT_MS = 8000;
const PRICE_TICK = 0.01;
const OWNER_EMAIL = 'kev120909@gmail.com';
const COMBO_COLLECTION = process.env.KALSHI_COMBO_COLLECTION || 'KXMVESPORTSMULTIGAMEEXTENDED-R';
const KALSHI_API_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';

function clampWaitMs(waitMs) {
  const n = Number(waitMs);
  if (!Number.isFinite(n)) return DEFAULT_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.round(n)));
}

function parsePrice(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function impliedProb(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function americanFromProb(p) {
  const n = Number(p);
  if (!(n > 0 && n < 1)) return null;
  return n < 0.5 ? Math.round((100 * (1 - n)) / n) : -Math.round((100 * n) / (1 - n));
}

function impliedYesFromNo(noBid) {
  const n = parsePrice(noBid);
  if (n == null) return null;
  return Math.round((1 - n) * 100) / 100;
}

function americanFromNoBid(noBid) {
  return americanFromProb(impliedYesFromNo(noBid));
}

function fillProbFromNoBid(noBid) {
  const no = parsePrice(noBid);
  if (no == null) return null;
  const sNom = 1 - no;
  if (!(sNom > 0 && sNom < 1)) return null;
  return KFEE * sNom * sNom + (1 - KFEE) * sNom;
}

function fillAmericanFromNoBid(noBid) {
  return americanFromProb(fillProbFromNoBid(noBid));
}

function noBidFromFillAmerican(fillAmerican) {
  const sEff = impliedProb(fillAmerican);
  if (!(sEff > 0 && sEff < 1)) return null;
  const b = 1 - KFEE;
  const sNom = (-b + Math.sqrt(b * b + 4 * KFEE * sEff)) / (2 * KFEE);
  if (!(sNom > 0 && sNom < 1)) return null;
  return Math.floor((1 - sNom) * 100 + 1e-9) / 100;
}

function quoteNoBid(q) {
  if (!q || typeof q !== 'object') return null;
  return parsePrice(q.no_bid_dollars != null ? q.no_bid_dollars : q.no_bid);
}

function quoteYesBid(q) {
  if (!q || typeof q !== 'object') return null;
  return parsePrice(q.yes_bid_dollars != null ? q.yes_bid_dollars : q.yes_bid);
}

function isOpenishQuote(q) {
  const st = String((q && q.status) || 'open').toLowerCase();
  return st === 'open' || st === '' || st === 'quoted';
}

function tickBetterNoBid(noBid) {
  const n = parsePrice(noBid);
  if (n == null) return null;
  return Math.min(0.99, Math.round((n + PRICE_TICK) * 100) / 100);
}

/** Highest competing maker NO bid. 0 / missing = declined that side. */
function pickBestQuote(quotes) {
  const list = Array.isArray(quotes) ? quotes : [];
  let best = null;
  let bestNo = null;
  for (const q of list) {
    if (!isOpenishQuote(q)) continue;
    const no = quoteNoBid(q);
    if (!(no > 0) || no >= 1) continue;
    if (bestNo == null || no > bestNo) {
      bestNo = no;
      best = q;
    }
  }
  if (!best) {
    return {
      bestNoBid: null,
      bestYesBid: null,
      bestAmerican: null,
      suggestFillAmerican: null,
      quoteCount: list.length,
      quoteId: null,
    };
  }
  const suggestNo = tickBetterNoBid(bestNo);
  return {
    bestNoBid: bestNo,
    bestYesBid: quoteYesBid(best),
    bestAmerican: fillAmericanFromNoBid(bestNo),
    suggestFillAmerican: fillAmericanFromNoBid(suggestNo),
    quoteCount: list.length,
    quoteId: best.id || null,
  };
}

function fillBeatsMarket(fillAmerican, bestAmerican) {
  if (fillAmerican == null || bestAmerican == null) return null;
  const fill = Number(fillAmerican);
  const best = Number(bestAmerican);
  if (!Number.isFinite(fill) || !Number.isFinite(best)) return null;
  return fill > best;
}

function eventTickerFromMarket(ticker) {
  const s = String(ticker || '').trim();
  const i = s.lastIndexOf('-');
  return i > 0 ? s.slice(0, i) : s;
}

function normalizeSide(side) {
  const s = String(side || '').trim().toLowerCase();
  if (s === 'no') return 'no';
  if (s === 'yes') return 'yes';
  return null;
}

function normalizeLegs(legs) {
  if (!Array.isArray(legs)) return { ok: false, error: 'legs must be an array of { ticker, side }' };
  const out = [];
  const seen = new Set();
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') continue;
    const ticker = String(leg.ticker || leg.market_ticker || '').trim();
    const side = normalizeSide(leg.side);
    if (!ticker || !side) continue;
    const eventTicker = String(leg.event_ticker || leg.eventTicker || eventTickerFromMarket(ticker)).trim();
    const key = `${ticker.toUpperCase()}:${side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ticker, side, event_ticker: eventTicker });
  }
  if (out.length < 2) return { ok: false, error: 'Need at least 2 mapped legs (ticker + side)' };
  if (out.length > 12) return { ok: false, error: 'Too many legs (max 12)' };
  return { ok: true, legs: out };
}

function parseContracts(n) {
  const i = Math.round(Number(n));
  if (!Number.isFinite(i) || i < 1 || i > 1000000) return null;
  return i;
}

function parseAllowlist(raw) {
  if (raw == null || raw === '') return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function comboLocksAllowlist(env) {
  const items = new Set([OWNER_EMAIL.toLowerCase()]);
  const e = env || process.env;
  const raw = e.VITE_COMBO_LOCKS_ALLOWLIST || e.COMBO_LOCKS_ALLOWLIST || '';
  for (const token of parseAllowlist(raw)) items.add(token.toLowerCase());
  return items;
}

function canSeeComboLocks(user, env) {
  if (!user) return false;
  const allowed = comboLocksAllowlist(env);
  const tokens = [];
  if (user.email) tokens.push(String(user.email).trim().toLowerCase());
  if (user.id) tokens.push(String(user.id).trim().toLowerCase());
  return tokens.some((t) => allowed.has(t));
}

function selectedMarkets(legs) {
  return (legs || []).map((l) => ({
    market_ticker: l.ticker,
    event_ticker: l.event_ticker,
    side: l.side,
  }));
}

function readBearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+(\S+)/i.exec(String(raw));
  return m ? m[1] : '';
}

function parseBody(req) {
  const raw = req && req.body;
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}

function kalshiErrorText(body, fallback) {
  if (body && typeof body === 'object') {
    const msg = body.message
      || (body.error && (body.error.message || body.error.code))
      || body.code
      || body.details;
    if (msg) return String(msg);
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 400);
  return fallback || 'Kalshi request failed';
}

function marketTickerFromCreate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.market_ticker) return String(data.market_ticker);
  if (data.market && data.market.ticker) return String(data.market.ticker);
  return null;
}

function quotesFromList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.quotes)) return data.quotes;
  return [];
}

function rfqIdFromCreate(data) {
  if (!data || typeof data !== 'object') return null;
  return data.id || data.rfq_id || (data.rfq && (data.rfq.id || data.rfq.rfq_id)) || null;
}

function missingKalshiKeysError(missing) {
  const names = (missing && missing.length ? missing : ['KALSHI_KEY_ID', 'Kalshi_combo_key']).join(' and ');
  return {
    ok: false,
    error: `Kalshi API keys are not configured on this server. Add ${names} (or KALSHI_PRIVATE_KEY instead of Kalshi_combo_key) to Vercel — same names as the Railway combo-worker.`,
    missingEnv: missing && missing.length ? missing : ['KALSHI_KEY_ID', 'Kalshi_combo_key'],
  };
}

module.exports = {
  KFEE,
  DEFAULT_WAIT_MS,
  MIN_WAIT_MS,
  MAX_WAIT_MS,
  PRICE_TICK,
  OWNER_EMAIL,
  COMBO_COLLECTION,
  KALSHI_API_BASE,
  clampWaitMs,
  parsePrice,
  impliedProb,
  americanFromProb,
  impliedYesFromNo,
  americanFromNoBid,
  fillProbFromNoBid,
  fillAmericanFromNoBid,
  noBidFromFillAmerican,
  quoteNoBid,
  quoteYesBid,
  tickBetterNoBid,
  pickBestQuote,
  fillBeatsMarket,
  eventTickerFromMarket,
  normalizeLegs,
  parseContracts,
  comboLocksAllowlist,
  canSeeComboLocks,
  selectedMarkets,
  readBearer,
  parseBody,
  kalshiErrorText,
  marketTickerFromCreate,
  quotesFromList,
  rfqIdFromCreate,
  missingKalshiKeysError,
};
