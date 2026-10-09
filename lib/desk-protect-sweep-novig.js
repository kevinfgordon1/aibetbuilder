// Bet Protect sweep for Novig desk rests (market_slug novig:<marketId>).
// Mirrors the Polymarket US sweep: when a rest is more than X¢ through the
// mid (a stale price someone can pick off), cancel it, then re-rest Y¢ better
// than the new mid, post-only. Does not chase a market that ran away.
//
// Novig specifics:
// - Novig only has bids. Every rest is a bid on one outcome at `price`, so the
//   check runs on that outcome: mid = (best other bid on it + 1 − best bid on
//   the opposite outcome) / 2. Our own tracked orders are left out of the book
//   so a stale rest cannot hold the mid next to itself.
// - The move to OPEN_INGAME (GOLIVE) voids every resting order. A rest that
//   disappears while its event is live is marked `voided` (inactive), never
//   re-rested.
// - Trading key only. This file never sees the management key.
'use strict';

const crypto = require('crypto');
const { openOrdersFrom } = require('../api/novig-client');

let novig = null;
let protect = null;
let modsPromise = null;

function loadMods() {
  if (novig && protect) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/liveDeskNovig.js'),
      import('../src/liveDeskProtect.js'),
    ]).then(([n, p]) => {
      novig = n;
      protect = p;
    }).catch((err) => {
      modsPromise = null;
      throw err;
    });
  }
  return modsPromise;
}

const MICRO = 1_000_000;
const CONTRACT_DOLLARS = 0.01;
const FRESH_ORDER_GRACE_MS = 15000;
// Novig answers 400 BOOK_DEPTH_OUT_OF_RANGE above 20 price levels.
const BOOK_DEPTH = 20;
const LIVE_EVENT = new Set(['OPEN_INGAME']);
const DONE_EVENT = new Set(['FINAL', 'SETTLED', 'CANCELED']);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function isNovigRow(row) {
  return /^novig:/i.test(String(row && row.market_slug || ''));
}

/** Best bid on one outcome, skipping the given order ids. */
function bestBid(book, outcomeId, skipIds) {
  const list = (book && book.orders && book.orders[outcomeId]) || [];
  let best = null;
  for (const o of list) {
    if (!o) continue;
    if (skipIds && o.orderId && skipIds.has(String(o.orderId))) continue;
    const p = Number(o.price);
    if (!(p > 0 && p < 1)) continue;
    if (!(Number(o.qty) > 0)) continue;
    if (best == null || p > best) best = p;
  }
  return best;
}

/**
 * Mid of one outcome from a Novig book, in probability.
 * bid = best bid on the outcome, ask = 1 − best bid on the opposite outcome.
 */
function novigOutcomeMid(book, outcomeId, otherOutcomeId, skipIds) {
  const bid = bestBid(book, outcomeId, skipIds);
  const otherBid = bestBid(book, otherOutcomeId, skipIds);
  if (bid == null || otherBid == null) return null;
  const ask = 1 - otherBid;
  if (ask + 1e-9 < bid) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 && mid < 1 ? mid : null;
}

/** Snap a probability onto Novig's three-band grid, rounding down (a bid never pays more). */
function snapDown(prob) {
  return novig.snapNovigBuyPrice(prob);
}

/** Contracts for a re-rest: keep the rest's size, inside the desk's $ cap. */
function reRestQty(remaining, price, capDollars) {
  const n = Math.floor(Number(remaining));
  const p = Number(price);
  if (!(n > 0) || !(p > 0 && p < 1)) return 0;
  const cap = Math.floor(capDollars / (p * CONTRACT_DOLLARS) + 1e-9);
  return Math.max(0, Math.min(n, cap));
}

/**
 * Decide on one live rest. Pure: no I/O.
 * Returns { fire, reason, midProb, restProb, improve? }.
 */
function decideNovig({ restPrice, midProb, xCents, yCents, atCap }) {
  const rest = Number(restPrice);
  if (!(rest > 0 && rest < 1) || midProb == null) return { fire: false, reason: 'no-mid' };
  const decision = protect.evaluateProtect({
    action: 'buy',
    restingOutcomeMicro: Math.round(rest * MICRO),
    midOutcomeMicro: Math.round(midProb * MICRO),
    xCents,
  });
  if (!decision.fire) return { fire: false, reason: decision.reason, gapMicro: decision.gapMicro };
  if (atCap) return { fire: true, reason: 'capped', improve: null };
  const y = num(yCents) || 0;
  const target = midProb - y / 100;
  const snapped = snapDown(target);
  if (snapped == null || !(snapped < rest - 1e-9)) {
    return { fire: true, reason: 'no-improve', improve: null };
  }
  const still = protect.evaluateProtect({
    action: 'buy',
    restingOutcomeMicro: Math.round(snapped * MICRO),
    midOutcomeMicro: Math.round(midProb * MICRO),
    xCents,
  });
  if (still.fire) return { fire: true, reason: 'no-improve', improve: null };
  return { fire: true, reason: 'through', improve: { price: snapped } };
}

/** Team-side (row.outcome) probability from an order bid price. */
function teamProbFromOrderPrice(row, price) {
  const p = Number(price);
  return String(row.action || 'buy').toLowerCase() === 'sell' ? 1 - p : p;
}

function labels(row, orderPrice) {
  const teamMicro = Math.round(teamProbFromOrderPrice(row, orderPrice) * MICRO);
  return {
    american: protect.americanLabelFromMicro(teamMicro),
    cents: protect.centsLabelFromMicro(teamMicro),
    teamMicro,
  };
}

async function ping(notify, text) {
  if (typeof notify !== 'function') return { ok: false, skipped: true };
  try {
    return (await notify(text)) || { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

function pingText(row, { oldOrderPrice, newOrderPrice, contracts, cancelledOnly, reason, eventTitle }) {
  const was = labels(row, oldOrderPrice);
  const now = newOrderPrice != null ? labels(row, newOrderPrice) : null;
  return protect.formatProtectTelegram({
    title: 'Novig · ' + (eventTitle || row.title || row.market_slug),
    action: row.action,
    outcomeName: row.outcome_name || '',
    oldAmerican: was.american,
    oldCents: was.cents,
    newAmerican: now ? now.american : undefined,
    newCents: now ? now.cents : undefined,
    contracts,
    cancelledOnly,
    reason,
  });
}

function replacementRow(row, newOrderId, orderPrice, contracts, clock) {
  const teamMicro = Math.round(teamProbFromOrderPrice(row, orderPrice) * MICRO);
  return {
    order_id: String(newOrderId),
    owner_email: row.owner_email,
    market_slug: row.market_slug,
    outcome: row.outcome,
    action: row.action,
    yes_price: Number(orderPrice).toFixed(3),
    outcome_micro: teamMicro,
    contracts,
    x_cents: num(row.x_cents),
    y_cents: num(row.y_cents),
    lineage_id: row.lineage_id || row.order_id,
    protect_count: (num(row.protect_count) || 0) + 1,
    status: 'armed',
    replaces: row.order_id,
    cooldown_until: iso(clock + protect.PROTECT_COOLDOWN_MS),
    title: row.title || null,
    outcome_name: row.outcome_name || null,
    tick: num(row.tick),
    min_qty: num(row.min_qty),
    submitted_outcome_micro: protect.originalSubmittedMicro(row),
  };
}

function createCaches(client) {
  const markets = new Map();
  const books = new Map();
  const events = new Map();
  return {
    async market(id) {
      if (!markets.has(id)) {
        markets.set(id, client.getMarket(id).then((raw) => ({ raw, read: novig.readNovigMarket(raw) })).catch(() => null));
      }
      return markets.get(id);
    },
    async book(id) {
      if (!books.has(id)) {
        books.set(id, client.getBook(id, { depth: BOOK_DEPTH })
          .catch(() => (client.publicGetBook ? client.publicGetBook(id, { depth: BOOK_DEPTH }) : null))
          .catch(() => null));
      }
      return books.get(id);
    },
    async eventInfo(eventId) {
      if (!eventId || typeof client.getEvent !== 'function') return { status: '', description: '' };
      if (!events.has(eventId)) {
        events.set(eventId, client.getEvent(eventId)
          .then((ev) => {
            const e = (ev && ev.event) || ev || {};
            return { status: String(e.status || '').toUpperCase(), description: String(e.description || '') };
          })
          .catch(() => ({ status: '', description: '' })));
      }
      return events.get(eventId);
    },
    async eventStatus(eventId) {
      return (await this.eventInfo(eventId)).status;
    },
  };
}

/** The rest is not in the open list: work out why. */
async function classifyMissing({ client, caches, row, marketId, clock }) {
  let order = null;
  let notFound = false;
  try {
    order = await client.getOrder(row.order_id);
  } catch (err) {
    if (Number(err && err.statusCode) === 404) notFound = true;
    else return { kind: 'unknown' };
  }
  if (order && /^(OPEN|PENDING)$/i.test(String(order.status || '')) && Number(order.remaining) > 0) {
    return { kind: 'live', order };
  }
  if (notFound) {
    const age = clock - (Date.parse(row.created_at) || 0);
    if (row.created_at && age < FRESH_ORDER_GRACE_MS) return { kind: 'fresh' };
  }
  const status = String((order && order.status) || '').toUpperCase();
  if (status === 'FILLED') return { kind: 'filled' };
  const m = await caches.market(marketId);
  const eventStatus = await caches.eventStatus(m && m.read && m.read.ok ? m.read.eventId : '');
  if (LIVE_EVENT.has(eventStatus)) return { kind: 'voided', eventStatus };
  return { kind: 'gone', status: status || (notFound ? 'NOT_FOUND' : ''), eventStatus };
}

async function placeRest(client, { outcomeId, price, qty }) {
  try {
    const created = await client.placeOrder({
      outcomeId,
      price: Number(price).toFixed(3),
      qty,
      tif: 'PO',
    });
    const id = created && (created.orderId || created.id || (created.order && created.order.orderId));
    return id ? { ok: true, orderId: String(id) } : { ok: false, error: 'no order id' };
  } catch (err) {
    return { ok: false, error: (err && (err.code || err.publicMessage)) || 'place failed', statusCode: err && err.statusCode };
  }
}

async function runNovigProtectSweep({ client, store, notify, now = Date.now, capDollars, dryRun = false } = {}) {
  await loadMods();
  if (!store || !store.configured) {
    return { ok: false, status: 503, error: 'Bet Protect registry is not configured.' };
  }
  const cap = Number(capDollars) > 0 ? Number(capDollars) : novig.MAX_SIZE_DOLLARS;
  const clock = typeof now === 'function' ? now() : Number(now);
  const nowIso = iso(clock);
  if (!dryRun && store.releaseStale) await store.releaseStale(iso(clock - protect.PROTECT_STALE_SWEEP_MS));
  const rows = ((await store.listArmed()) || []).filter(isNovigRow);
  const actions = [];
  let parked = 0;
  let fired = 0;
  if (!rows.length) return { ok: true, venue: 'novig', checked: 0, fired, parked, actions };

  const open = openOrdersFrom(await client.listOpenOrders());
  const live = new Map(open.map((o) => [String(o.orderId || o.id), o]));
  const tracked = new Set(rows.map((r) => String(r.order_id)));
  const caches = createCaches(client);

  for (const row of rows) {
    if (!row || row.status === 'sweeping') continue;
    const marketId = novig.marketIdFromProtectSlug(row.market_slug);
    const base = { venue: 'novig', orderId: row.order_id, marketSlug: row.market_slug };
    if (!marketId) {
      parked += 1;
      actions.push({ ...base, result: 'parked', reason: 'bad-slug' });
      continue;
    }
    if (row.status === 'armed' && row.cooldown_until && Date.parse(row.cooldown_until) > clock) {
      parked += 1;
      continue;
    }

    if (row.status === 'pending_rereset') {
      const out = await retryRereset({ client, store, notify, caches, row, marketId, tracked, cap, clock, nowIso, dryRun });
      if (out.fired) fired += 1; else parked += 1;
      if (out.action) actions.push({ ...base, ...out.action });
      continue;
    }

    let order = live.get(String(row.order_id));
    if (!order) {
      const why = await classifyMissing({ client, caches, row, marketId, clock });
      if (why.kind === 'live') {
        order = why.order;
      } else if (why.kind === 'fresh' || why.kind === 'unknown') {
        parked += 1;
        actions.push({ ...base, result: 'parked', reason: why.kind === 'fresh' ? 'just-placed' : 'lookup' });
        continue;
      } else {
        const status = why.kind === 'voided' ? 'voided' : 'gone';
        if (!dryRun) await store.update(row.order_id, { status, sweep_token: null });
        actions.push({ ...base, result: status, reason: why.kind === 'voided' ? 'golive' : (why.kind === 'filled' ? 'filled' : 'closed') });
        continue;
      }
    }

    const m = await caches.market(marketId);
    const market = m && m.read;
    if (!market || !market.ok) {
      parked += 1;
      actions.push({ ...base, result: 'parked', reason: 'no-market' });
      continue;
    }
    if (!market.tradable) {
      parked += 1;
      actions.push({ ...base, result: 'parked', reason: 'market-' + String(market.status || 'closed').toLowerCase() });
      continue;
    }
    const eventTitle = (await caches.eventInfo(market.eventId)).description;
    const outcomeId = String(order.outcomeId || '');
    const otherId = outcomeId === market.longOutcomeId ? market.shortOutcomeId
      : (outcomeId === market.shortOutcomeId ? market.longOutcomeId : '');
    if (!otherId) {
      parked += 1;
      actions.push({ ...base, result: 'parked', reason: 'outcome' });
      continue;
    }
    const book = await caches.book(marketId);
    const midProb = novigOutcomeMid(book, outcomeId, otherId, tracked);
    const restPrice = Number(order.price);
    const remaining = Number(order.remaining != null ? order.remaining : order.qty) || 0;
    const atCap = (num(row.protect_count) || 0) >= protect.MAX_PROTECTS_PER_LINEAGE;
    const decision = decideNovig({ restPrice, midProb, xCents: num(row.x_cents), yCents: num(row.y_cents), atCap });
    if (!decision.fire) {
      parked += 1;
      if (decision.reason === 'no-mid') actions.push({ ...base, result: 'parked', reason: 'no-mid' });
      else actions.push({ ...base, result: 'watch', reason: decision.reason, restPrice, midProb, gapCents: decision.gapMicro != null ? decision.gapMicro / 10000 : null });
      continue;
    }
    const qty = decision.improve ? reRestQty(remaining, decision.improve.price, cap) : 0;
    const plan = {
      ...base,
      restPrice,
      midProb,
      reason: decision.reason,
      newPrice: decision.improve ? decision.improve.price : null,
      contracts: qty || remaining,
    };
    if (dryRun) {
      fired += 1;
      actions.push({ ...plan, result: 'would-fire', willRerest: !!(decision.improve && qty > 0) });
      continue;
    }

    const token = crypto.randomUUID();
    const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'armed' });
    if (!claimed) continue;
    try {
      await client.cancelOrder(row.order_id);
    } catch (err) {
      const code = Number(err && err.statusCode);
      if (code === 404 || code === 409) {
        await store.update(row.order_id, { status: 'gone', sweep_token: null }, { token });
        actions.push({ ...base, result: 'gone', reason: 'cancel-' + code });
        continue;
      }
      await store.update(row.order_id, { status: 'armed', sweep_token: null, hold_from: null }, { token });
      actions.push({ ...base, result: 'error', reason: 'cancel-failed', error: (err && err.publicMessage) || 'cancel failed' });
      continue;
    }
    live.delete(String(row.order_id));
    const was = labels(row, restPrice);

    if (!decision.improve || !(qty > 0)) {
      const reason = decision.reason === 'capped' ? 'capped' : 'no-improve';
      await store.update(row.order_id, { status: reason === 'capped' ? 'capped' : 'disarmed', sweep_token: null }, { token });
      const sent = await ping(notify, pingText(row, { eventTitle, oldOrderPrice: restPrice, contracts: remaining, cancelledOnly: true, reason }));
      fired += 1;
      actions.push({ ...base, result: 'cancelled', reason, title: row.title, action: row.action, outcomeName: row.outcome_name, oldAmerican: was.american, oldCents: was.cents, contracts: remaining, telegram: !!sent.ok });
      continue;
    }

    const newPrice = decision.improve.price;
    const placed = await placeRest(client, { outcomeId, price: newPrice, qty });
    if (!placed.ok) {
      await store.update(row.order_id, {
        status: 'pending_rereset',
        sweep_token: null,
        pending_yes_price: newPrice.toFixed(3),
        pending_contracts: qty,
        pending_intent: outcomeId,
        outcome_micro: was.teamMicro,
        notified_at: nowIso,
      }, { token });
      const sent = await ping(notify, pingText(row, { eventTitle, oldOrderPrice: restPrice, contracts: qty, cancelledOnly: true, reason: 'retry' }));
      fired += 1;
      actions.push({ ...base, result: 'pending', reason: 'rereset-failed', error: placed.error, oldAmerican: was.american, oldCents: was.cents, contracts: qty, telegram: !!sent.ok });
      continue;
    }
    tracked.add(placed.orderId);
    let recorded = false;
    try {
      await store.insert(replacementRow(row, placed.orderId, newPrice, qty, clock));
      recorded = true;
    } catch (_) {
      const existing = await store.get(placed.orderId).catch(() => null);
      recorded = !!(existing && existing.order_id);
    }
    if (!recorded) {
      // Never leave an untracked rest on the book.
      try { await client.cancelOrder(placed.orderId); } catch (_) { /* best effort */ }
      await store.update(row.order_id, { status: 'disarmed', sweep_token: null }, { token });
      const sent = await ping(notify, pingText(row, { eventTitle, oldOrderPrice: restPrice, contracts: qty, cancelledOnly: true, reason: 'no-improve' }));
      fired += 1;
      actions.push({ ...base, result: 'cancelled', reason: 'registry', oldAmerican: was.american, oldCents: was.cents, contracts: qty, telegram: !!sent.ok });
      continue;
    }
    await store.update(row.order_id, {
      status: 'replaced',
      replaced_by: placed.orderId,
      sweep_token: null,
      pending_yes_price: null,
      pending_contracts: null,
      pending_intent: null,
      notified_at: nowIso,
    }, { token });
    const now2 = labels(row, newPrice);
    const sent = await ping(notify, pingText(row, { eventTitle, oldOrderPrice: restPrice, newOrderPrice: newPrice, contracts: qty }));
    fired += 1;
    actions.push({
      ...base,
      result: 'rereset',
      newOrderId: placed.orderId,
      title: row.title,
      action: row.action,
      outcomeName: row.outcome_name,
      oldAmerican: was.american,
      newAmerican: now2.american,
      oldCents: was.cents,
      newCents: now2.cents,
      contracts: qty,
      telegram: !!sent.ok,
    });
  }
  return { ok: true, venue: 'novig', checked: rows.length, fired, parked, actions };
}

async function retryRereset({ client, store, notify, caches, row, marketId, tracked, cap, clock, nowIso, dryRun }) {
  const m = await caches.market(marketId);
  const market = m && m.read;
  const info = await caches.eventInfo(market && market.ok ? market.eventId : '');
  const eventStatus = info.status;
  const outcomeId = String(row.pending_intent || '');
  const price = num(row.pending_yes_price);
  const qty = Math.floor(num(row.pending_contracts) || 0);
  if (LIVE_EVENT.has(eventStatus) || DONE_EVENT.has(eventStatus) || (market && market.ok && !market.tradable)) {
    if (!dryRun) await store.update(row.order_id, { status: LIVE_EVENT.has(eventStatus) ? 'voided' : 'gone', sweep_token: null });
    return { fired: false, action: { result: LIVE_EVENT.has(eventStatus) ? 'voided' : 'gone', reason: 'rereset-' + (eventStatus || 'closed').toLowerCase() } };
  }
  if (!market || !market.ok || !outcomeId || !(price > 0 && price < 1) || !(qty > 0)) {
    return { fired: false, action: { result: 'pending', reason: 'rereset-unpriced' } };
  }
  const otherId = outcomeId === market.longOutcomeId ? market.shortOutcomeId : market.longOutcomeId;
  const midProb = novigOutcomeMid(await caches.book(marketId), outcomeId, otherId, tracked);
  if (midProb != null) {
    const through = protect.evaluateProtect({
      action: 'buy',
      restingOutcomeMicro: Math.round(price * MICRO),
      midOutcomeMicro: Math.round(midProb * MICRO),
      xCents: num(row.x_cents),
    });
    if (through.fire) {
      // The market moved again; give up rather than rest a stale price.
      if (!dryRun) await store.update(row.order_id, { status: 'disarmed', sweep_token: null });
      return { fired: false, action: { result: 'cancelled', reason: 'rereset-stale' } };
    }
  }
  if (dryRun) return { fired: false, action: { result: 'would-rerest', newPrice: price, contracts: qty } };
  const token = crypto.randomUUID();
  const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'pending_rereset' });
  if (!claimed) return { fired: false };
  const sized = reRestQty(qty, price, cap);
  const placed = await placeRest(client, { outcomeId, price, qty: sized });
  if (!placed.ok) {
    await store.update(row.order_id, { status: 'pending_rereset', sweep_token: null }, { token });
    return { fired: false, action: { result: 'pending', reason: 'rereset-failed', error: placed.error } };
  }
  tracked.add(placed.orderId);
  try {
    await store.insert(replacementRow(row, placed.orderId, price, sized, clock));
  } catch (_) {
    try { await client.cancelOrder(placed.orderId); } catch (__) { /* best effort */ }
    await store.update(row.order_id, { status: 'pending_rereset', sweep_token: null }, { token });
    return { fired: false, action: { result: 'pending', reason: 'registry' } };
  }
  await store.update(row.order_id, { status: 'replaced', replaced_by: placed.orderId, sweep_token: null }, { token });
  const was = labels(row, num(row.yes_price) || price);
  const now2 = labels(row, price);
  const sent = await ping(notify, pingText(row, { eventTitle: info.description, oldOrderPrice: num(row.yes_price) || price, newOrderPrice: price, contracts: sized }));
  return {
    fired: true,
    action: { result: 'rereset', newOrderId: placed.orderId, oldAmerican: was.american, newAmerican: now2.american, oldCents: was.cents, newCents: now2.cents, contracts: sized, telegram: !!sent.ok },
  };
}

module.exports = {
  runNovigProtectSweep,
  novigOutcomeMid,
  decideNovig,
  reRestQty,
  isNovigRow,
  loadMods,
};
