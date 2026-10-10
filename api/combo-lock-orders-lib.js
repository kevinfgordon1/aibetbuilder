// Pure helpers for /api/combo-lock-orders (CJS so the Vercel handler can require it).
'use strict';

const COMBO_FEE_RATE = 0.01;

function decOf(am) {
  const a = Number(am);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}
function amOfProfit(r) {
  return r >= 1 ? r * 100 : -100 / r;
}

function validateFillAmerican(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) {
    return { ok: false, error: 'Enter fill odds as American odds (for example +1200 or -150).' };
  }
  if (n > -100 && n < 100) {
    return { ok: false, error: 'American odds must be ≤ -100 or ≥ +100.' };
  }
  return { ok: true, american: n };
}

function exchangeFromAllIn(allInAmerican, rate = COMBO_FEE_RATE) {
  const d = decOf(allInAmerican);
  if (!d) return null;
  const r = (d - 1) / (1 + rate);
  let a = amOfProfit(r);
  if (a > -100 && a < 100) a = a >= 0 ? 100 : -100;
  return a >= 0 ? Math.floor(a + 1e-9) : -Math.ceil(-a - 1e-9);
}

function resolveExchangeFill(typedAmerican, { feesEnabled = false, feeRate = COMBO_FEE_RATE } = {}) {
  const v = validateFillAmerican(typedAmerican);
  if (!v.ok) return v;
  if (!feesEnabled) return { ok: true, fillAmerican: v.american, typedAmerican: v.american, feesEnabled: false };
  const ex = exchangeFromAllIn(v.american, feeRate);
  if (ex == null) return { ok: false, error: 'Could not convert that all-in price to an exchange price.' };
  return { ok: true, fillAmerican: ex, typedAmerican: v.american, feesEnabled: true, allInAmerican: v.american };
}

function impliedProb(a) {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}

function aToDec(a) {
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

function lockKind(parlayOrKind) {
  const k = typeof parlayOrKind === 'string'
    ? parlayOrKind
    : (parlayOrKind && (parlayOrKind.is_free_bet ? 'freebet' : parlayOrKind.bet_type || parlayOrKind.kind));
  if (k === 'freebet' || k === 'free') return 'freebet';
  if (k === 'boost') return 'boost';
  return 'cash';
}

// Matches src/comboLockProfile.js hedgeCap / bookPnL for persisted max_contracts.
function hedgeCap({ stake, boostAmerican, fillAmerican, mode, kind }) {
  if (!(stake > 0) || !boostAmerican || !fillAmerican) return 0;
  const A = Number(boostAmerican);
  const dec = aToDec(A);
  const free = lockKind(kind) === 'freebet';
  const bookHit = free ? stake * (dec - 1) : stake * dec - stake;
  const equalizeN = free ? bookHit : stake * dec; // 1x contracts = W+S
  const y = impliedProb(Number(fillAmerican));
  if (!(y > 0 && y < 1)) return 0;
  const W = bookHit;
  const S = free ? 0 : stake;
  switch (String(mode || '1x')) {
    case 'riskfree': {
      if (free) {
        return Math.min(Math.ceil(stake / y - 1e-9), Math.floor(W / (1 - y) + 1e-9));
      }
      if (!(S > 0)) return 0;
      return Math.ceil(S / y - 1e-9);
    }
    case 'riskfree_open':
      return Math.floor(W / (1 - y) + 1e-9);
    case '2x': return Math.round(2 * equalizeN);
    case '3x': return Math.round(3 * equalizeN);
    case '1x':
    default: return Math.round(equalizeN);
  }
}

function fillEditParlayPatch(parlay, fillAmerican, { filled = 0, now = new Date() } = {}) {
  const kind = lockKind(parlay);
  let cap = hedgeCap({
    stake: Number(parlay.parlay_stake) || 0,
    boostAmerican: Number(parlay.parlay_american) || 0,
    fillAmerican,
    mode: parlay.hedge_mode || '1x',
    kind,
  });
  const prev = Number(parlay.max_contracts) || 0;
  if (!(cap > 0)) cap = prev;
  const floor = Math.max(0, Math.ceil(Number(filled) || 0));
  if (cap < floor) cap = floor;
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    fill_american: fillAmerican,
    max_contracts: cap,
    fill_edited_at: iso,
    cancel_open_at: iso,
  };
}

function canManageLock(actor, parlay, { isOwner = false } = {}) {
  if (!actor || !parlay) return false;
  if (isOwner) return true;
  return String(actor.id || '') === String(parlay.user_id || '');
}

function isOpenSubmission(row) {
  if (!row) return false;
  if (!(row.quote_id || row.order_id)) return false;
  if (row.is_live === true) return true;
  const st = String(row.status || '').toLowerCase();
  return st === 'quoted';
}

module.exports = {
  COMBO_FEE_RATE,
  validateFillAmerican,
  exchangeFromAllIn,
  resolveExchangeFill,
  fillEditParlayPatch,
  canManageLock,
  isOpenSubmission,
  hedgeCap,
};
