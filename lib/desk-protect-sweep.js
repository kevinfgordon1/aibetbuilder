// Idempotent Adverse Protect sweep. Safe to call every 1–2s.
// Loads armed rests, reads each market mid, cancels when the rest is more
// than X¢ through mid, then re-rests better by Y¢. Does not chase a market that ran away.
'use strict';

const crypto = require('crypto');

// liveDeskPrice.js and liveDeskProtect.js are ESM. A static require() here
// would throw ERR_REQUIRE_ESM when the desk route loads, which blanks the page.
let price = null;
let protect = null;
let track = null;
let modsPromise = null;

function loadMods() {
  if (price && protect && track) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/liveDeskPrice.js'),
      import('../src/liveDeskProtect.js'),
      import('../src/liveDeskOrderTrack.js'),
    ]).then(([priceMod, protectMod, trackMod]) => {
      price = priceMod;
      protect = protectMod;
      track = trackMod;
    }).catch((err) => {
      modsPromise = null;
      throw err;
    });
  }
  return modsPromise;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function orderIndex(payload, markets) {
  const map = new Map();
  for (const order of price.mapOpenOrders(payload, markets)) {
    map.set(order.id, order);
  }
  return map;
}

function findAdopt(orders, { slug, intent, yesPriceValue, contracts, skipIds }) {
  const qty = num(contracts);
  const wantMicro = Math.round(Number(yesPriceValue) * 1e6);
  if (!Number.isFinite(wantMicro) || qty == null) return null;
  for (const order of orders.values()) {
    if (!order || skipIds.has(order.id)) continue;
    if (order.marketSlug !== slug) continue;
    if (price.intentFor(order.outcome, order.action) !== intent) continue;
    if (order.yesMicro == null || order.yesMicro !== wantMicro) continue;
    if (num(order.quantity) !== qty) continue;
    return order;
  }
  return null;
}

async function loadBooks(client, slugs) {
  const markets = {};
  const bbos = {};
  const depths = {};
  await Promise.all(slugs.map(async (slug) => {
    try {
      const raw = await client.getMarketBySlug(slug);
      markets[slug] = price.readMarketSides(raw);
    } catch (_) {
      markets[slug] = { ok: false };
    }
    try {
      bbos[slug] = await client.getMarketBbo(slug);
    } catch (_) {
      bbos[slug] = null;
    }
    if (typeof client.getMarketBook === 'function') {
      try {
        depths[slug] = await client.getMarketBook(slug);
      } catch (_) {
        depths[slug] = null;
      }
    }
  }));
  return { markets, bbos, depths };
}

function namesFor(row, market) {
  const outcomeName = row.outcome_name
    || (market && market.ok ? (row.outcome === 'short' ? market.shortName : market.longName) : '');
  const title = row.title || (market && market.ok ? market.title : '') || row.market_slug;
  return { outcomeName, title };
}

async function stillHeld(store, orderId, token) {
  const row = await store.get(orderId);
  return !!(row && row.status === 'sweeping' && row.sweep_token === token);
}

function isOpenState(state) {
  const text = String(state || '');
  if (!text) return true;
  if (/PARTIAL/i.test(text)) return true;
  if (/FILLED|CANCEL|REJECT|EXPIRED|REPLACED/i.test(text)) return false;
  return /NEW|PENDING/i.test(text);
}

function unwrapOrder(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.order && typeof payload.order === 'object') return payload.order;
  return payload;
}

async function lookupOrder(client, orderId) {
  if (!client || typeof client.getOrder !== 'function') {
    return { error: { statusCode: 0 } };
  }
  try {
    return { order: unwrapOrder(await client.getOrder(orderId)) };
  } catch (err) {
    return { error: err || { statusCode: 0 } };
  }
}

async function rememberTrack(tracks, incoming) {
  if (!incoming) return { ok: false, persisted: false, saved: null };
  if (!tracks || typeof tracks.upsert !== 'function') {
    return { ok: true, persisted: true, saved: track.mergeVerifiedTrack(null, incoming) };
  }
  try {
    const prev = typeof tracks.get === 'function' ? await tracks.get(incoming.orderId) : null;
    const merged = track.mergeVerifiedTrack(prev, incoming);
    if (!(prev && track.sameTrack(prev, merged))) {
      const saved = await tracks.upsert(merged);
      if (!saved) return { ok: false, persisted: false, saved: null };
    }
    if (typeof tracks.get !== 'function') return { ok: false, persisted: false, saved: null };
    const back = await tracks.get(incoming.orderId);
    if (!back) return { ok: false, persisted: false, saved: null };
    return { ok: true, persisted: true, saved: back };
  } catch (_) {
    return { ok: false, persisted: false, saved: null };
  }
}

async function requiredLineageIds(store, tracks, row) {
  const ids = [];
  const seen = new Set();
  let current = row;
  while (current && current.order_id && !seen.has(current.order_id)) {
    seen.add(current.order_id);
    ids.push(current.order_id);
    if (!current.replaces) return { ok: true, ids };
    let parent = null;
    if (store && typeof store.get === 'function') parent = await store.get(current.replaces);
    if (!parent && tracks && typeof tracks.get === 'function') {
      const saved = await tracks.get(current.replaces);
      if (saved && saved.orderId) {
        parent = { order_id: saved.orderId, replaces: saved.replaces || null, lineage_id: saved.lineageId || null };
      }
    }
    if (!parent) return { ok: false, ids };
    current = parent;
  }
  return { ok: true, ids };
}

async function lineageSpendFor(store, tracks, row, { outcome, action } = {}) {
  if (!tracks || typeof tracks.listByLineage !== 'function') {
    return { known: false, dollars: null, reason: 'prior-spent-unknown' };
  }
  const required = await requiredLineageIds(store, tracks, row);
  if (!required.ok) return { known: false, dollars: null, reason: 'lineage-incomplete' };
  let chain = [];
  try {
    chain = await tracks.listByLineage(row.lineage_id || row.order_id, row.owner_email);
  } catch (_) {
    return { known: false, dollars: null, reason: 'prior-spent-unknown' };
  }
  return track.lineageSpend(chain, {
    requiredOrderIds: required.ids,
    excludeOrderId: row.order_id,
    outcome: outcome || row.outcome,
    action: action || row.action,
  });
}

function holdForLineage(reason) {
  return reason === 'track-unpersisted' || reason === 'lineage-incomplete' || reason === 'prior-spent-unknown';
}

// The order is not on the open list, or a cancel came back 404/409.
// One getOrder classifies it. Absence alone is unknown, never filled.
async function settleAbsent(client, tracks, store, row, { token, clock, reason }) {
  const looked = await lookupOrder(client, row.order_id);
  const classified = track.classifyLookup({
    order: looked.order,
    error: looked.error,
    disappeared: !looked.order && !looked.error,
  });
  const remembered = await rememberTrack(tracks, {
    ...classified,
    orderId: row.order_id,
    ownerEmail: row.owner_email,
    marketSlug: row.market_slug,
    outcome: row.outcome,
    action: row.action,
    replaces: row.replaces || null,
    replacedBy: row.replaced_by || null,
    lineageId: row.lineage_id || null,
  });
  const patchOpts = token ? { token } : {};
  if (tracks && !remembered.persisted) {
    await store.update(row.order_id, {
      status: 'armed',
      sweep_token: null,
      hold_from: null,
      cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
    }, patchOpts);
    return {
      parked: true,
      action: { orderId: row.order_id, marketSlug: row.market_slug, reason: 'track-unpersisted', result: 'unknown' },
    };
  }
  const saved = remembered.saved || {};
  const state = saved.verifiedState;
  const action = {
    orderId: row.order_id,
    marketSlug: row.market_slug,
    reason,
    verifiedState: state,
    cumQty: saved.cumQty,
  };
  if (state === 'open' || state === 'partial') {
    await store.update(row.order_id, {
      status: 'armed',
      sweep_token: null,
      hold_from: null,
      cooldown_until: iso(clock + 15_000),
    }, patchOpts);
    return { parked: true, action: { ...action, result: state } };
  }
  if (track.TERMINAL_TRACK_STATES.indexOf(state) !== -1) {
    await store.update(row.order_id, { status: state, sweep_token: null }, patchOpts);
    return { parked: false, action: { ...action, result: state } };
  }
  const attempts = saved.resolveAttempts || 1;
  if (saved.stopped || attempts >= track.RESOLVE_ATTEMPT_LIMIT || (saved.totalFailures || 0) >= track.FAILURE_STOP) {
    await store.update(row.order_id, { status: 'unresolved', sweep_token: null }, patchOpts);
    return { parked: false, action: { ...action, result: 'unresolved' } };
  }
  await store.update(row.order_id, {
    status: 'armed',
    sweep_token: null,
    hold_from: null,
    cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
  }, patchOpts);
  return { parked: true, action: { ...action, result: 'unknown' } };
}

async function linkReplacement(tracks, row, newOrderId) {
  if (!tracks || !newOrderId || typeof tracks.get !== 'function') return true;
  try {
    const prev = await tracks.get(row.order_id);
    if (prev) {
      if (prev.replacedBy === newOrderId) return true;
      await tracks.upsert({ ...prev, replacedBy: newOrderId, orderId: row.order_id, ownerEmail: prev.ownerEmail || row.owner_email });
      return true;
    }
    const remembered = await rememberTrack(tracks, track.protectCancelRecord(row, { replacedBy: newOrderId }));
    return !!(remembered && remembered.persisted);
  } catch (_) {
    return false;
  }
}

async function noteProtectCancel(client, tracks, row, { replacedBy, clock }) {
  const looked = await lookupOrder(client, row.order_id);
  const official = looked.order ? track.classifyOfficialOrder(looked.order) : null;
  const record = track.protectCancelRecord(row, { replacedBy, at: iso(clock), official });
  const remembered = await rememberTrack(tracks, {
    ...record,
    orderId: row.order_id,
    ownerEmail: row.owner_email,
    marketSlug: row.market_slug,
    outcome: row.outcome,
    action: row.action,
  });
  return { official, saved: remembered.saved, persisted: remembered.persisted };
}

async function ping(notify, text) {
  if (typeof notify !== 'function') return { ok: false, skipped: true };
  try {
    const result = await notify(text);
    return result || { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

function checkSample(row, order, book, extra) {
  return {
    orderId: row.order_id,
    ownerEmail: row.owner_email,
    marketSlug: row.market_slug,
    feedAt: book && book.feedAt,
    feedAgeMs: book && book.feedAgeMs,
    orderCents: order && order.outcomeMicro != null ? order.outcomeMicro / 10000 : null,
    midCents: book && book.midMicro != null ? book.midMicro / 10000 : null,
    ...extra,
  };
}

async function noteCheck(audits, sample) {
  if (!audits || typeof audits.record !== 'function' || !sample) return;
  try { await audits.record(sample); } catch (_) { /* audit must not block a cancel */ }
}

function amountOf(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return amountOf(value.value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readProtectBook(payload, clock, nowIso) {
  const data = payload && (payload.marketData || payload);
  const rawFeedAt = data && (data.transactTime || data.timestamp);
  const feedAtMs = rawFeedAt ? Date.parse(rawFeedAt) : NaN;
  const stats = data && data.stats;
  const lastTradeYes = amountOf(stats && stats.lastTradePx);
  const lastTradeAtMs = stats && stats.lastTradeSetTime ? Date.parse(stats.lastTradeSetTime) : NaN;
  const hasLevels = !!(data && ((data.bids && data.bids.length) || (data.offers && data.offers.length)));
  return {
    ok: hasLevels,
    reason: data ? (hasLevels ? 'ok' : 'no-book') : 'no-book',
    bids: data && data.bids,
    offers: data && data.offers,
    feedAt: Number.isFinite(feedAtMs) ? new Date(feedAtMs).toISOString() : null,
    feedAgeMs: Number.isFinite(feedAtMs) ? clock - feedAtMs : null,
    receivedAt: data ? nowIso : null,
    receivedAgeMs: data ? 0 : null,
    lastTradeYes,
    lastTradeAtMs: Number.isFinite(lastTradeAtMs) ? lastTradeAtMs : null,
    midMicro: null,
  };
}

async function cancelUntilFresh(client, store, tracks, audits, row, order, book, { clock, nowIso, reason }) {
  if (row.status === 'pending_book') {
    await noteCheck(audits, checkSample(row, order, book, { trigger: reason, action: 'none', checkedAt: nowIso }));
    return { parked: true };
  }
  const token = crypto.randomUUID();
  const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'armed' });
  if (!claimed) return { parked: true };
  let cancelResult = 'ok';
  try {
    await client.cancelOrder(order.id, order.marketSlug);
  } catch (err) {
    const code = Number(err && err.statusCode);
    if (code !== 404 && code !== 409) {
      await store.update(row.order_id, { status: 'armed', sweep_token: null, hold_from: null }, { token });
      await noteCheck(audits, checkSample(row, order, book, { trigger: reason, action: 'cancel-failed', cancelResult: 'http-' + code, checkedAt: nowIso }));
      return { parked: true, action: { result: 'error', reason: 'cancel-failed', orderId: row.order_id, marketSlug: row.market_slug } };
    }
    cancelResult = 'http-' + code;
  }
  await noteProtectCancel(client, tracks, claimed, { clock });
  await store.update(row.order_id, { status: 'pending_book', sweep_token: null }, { token });
  await noteCheck(audits, checkSample(row, order, book, { trigger: reason, action: 'cancelled', cancelResult, checkedAt: nowIso }));
  return {
    fired: true,
    action: { result: 'cancelled', reason, orderId: row.order_id, marketSlug: row.market_slug },
  };
}

async function resumeAfterUnreadable({ client, store, notify, row, live, markets, depths, tracked, clock, nowIso, tracks, audits }) {
  const book = readProtectBook(depths && depths[row.market_slug], clock, nowIso);
  if (!book.ok || book.receivedAgeMs == null) {
    await noteCheck(audits, checkSample(row, null, book, { trigger: 'book-unread', action: 'none', checkedAt: nowIso }));
    return { parked: true };
  }
  await store.update(row.order_id, { status: 'pending_lineage' });
  return resumeLineageReplace({
    client, store, notify, row: { ...row, status: 'pending_lineage' }, live, markets, depths, tracked, clock, nowIso, tracks,
  });
}

async function runProtectSweep({ client, store, notify, now = Date.now, tracks, audits } = {}) {
  await loadMods();
  if (!store || !store.configured) {
    return { ok: false, status: 503, error: 'Bet Protect registry is not configured. Apply sql/desk_protect_rests.sql and set SUPABASE_SERVICE_KEY.' };
  }
  const clock = typeof now === 'function' ? now() : Number(now);
  const nowIso = iso(clock);
  await store.releaseStale(iso(clock - protect.PROTECT_STALE_SWEEP_MS));
  const allArmed = await store.listArmed();
  // Novig rests use market_slug novig:<uuid>; this Polymarket sweep skips them.
  const rows = (allArmed || []).filter((row) => !String(row.market_slug || '').startsWith('novig:'));
  const actions = [];
  let parked = 0;
  let fired = 0;
  if (!rows.length) {
    return { ok: true, checked: 0, fired: 0, parked: 0, actions };
  }

  const openPayload = await client.listOpenOrders();
  const slugs = [...new Set(rows.map((row) => String(row.market_slug || '').trim()).filter(Boolean))];
  const { markets, bbos, depths } = await loadBooks(client, slugs);
  let live = orderIndex(openPayload, markets);

  for (const row of rows) {
    if (!row || row.status === 'sweeping') continue;
    const cooling = row.cooldown_until && Date.parse(row.cooldown_until) > clock;
    if ((row.status === 'armed' || row.status === 'pending_lineage') && cooling) {
      parked += 1;
      continue;
    }
    const tracked = new Set(rows.map((item) => item.order_id).filter(Boolean));
    if (row.replaced_by) tracked.add(row.replaced_by);

    if (row.status === 'pending_lineage') {
      const outcome = await resumeLineageReplace({
        client, store, notify, row, live, markets, depths, tracked, clock, nowIso, tracks,
      });
      if (outcome.fired) fired += 1;
      else parked += 1;
      if (outcome.action) actions.push(outcome.action);
      if (outcome.live) live = outcome.live;
      continue;
    }

    if (row.status === 'pending_rereset') {
      const outcome = await finishRereset({
        client, store, notify, row, live, markets, tracked, clock, nowIso, tracks,
      });
      if (outcome.fired) fired += 1;
      else parked += 1;
      if (outcome.action) actions.push(outcome.action);
      if (outcome.live) live = outcome.live;
      continue;
    }

    if (row.status === 'pending_book') {
      const outcome = await resumeAfterUnreadable({
        client, store, notify, row, live, markets, depths, tracked, clock, nowIso, tracks, audits,
      });
      if (outcome.fired) fired += 1;
      else parked += 1;
      if (outcome.action) actions.push(outcome.action);
      if (outcome.live) live = outcome.live;
      continue;
    }

    const order = live.get(row.order_id);
    if (!order) {
      const settled = await settleAbsent(client, tracks, store, row, { clock, reason: 'not-in-open' });
      if (settled.parked) parked += 1;
      if (settled.action) actions.push(settled.action);
      continue;
    }
    const market = markets[row.market_slug];
    if (market && market.ok && market.tradable === false) {
      parked += 1;
      continue;
    }
    const depthPayload = depths[row.market_slug];
    const book = readProtectBook(depthPayload, clock, nowIso);
    if (!book.ok || order.outcomeMicro == null || order.yesMicro == null) {
      const unread = await cancelUntilFresh(client, store, tracks, audits, row, order, book, {
        clock, nowIso, reason: book.ok ? 'unpriced' : 'book-unread', live, markets, depths, tracked, notify,
      });
      if (unread.parked) parked += 1;
      if (unread.fired) fired += 1;
      if (unread.action) actions.push(unread.action);
      continue;
    }
    const ownBids = [];
    const ownOffers = [];
    for (const liveOrder of live.values()) {
      if (!liveOrder || liveOrder.marketSlug !== row.market_slug || liveOrder.yesMicro == null) continue;
      const bookSide = price.yesBookSide(liveOrder.outcome, liveOrder.action);
      const entry = { yesPrice: liveOrder.yesMicro / 1e6, leaves: protect.ownLeaves(liveOrder) };
      if (bookSide === 'sell') ownOffers.push(entry);
      else if (bookSide === 'buy') ownBids.push(entry);
    }
    let decision = protect.evaluateBookProtect({
      outcome: order.outcome,
      action: order.action,
      yesPrice: order.yesMicro / 1e6,
      bids: book.bids,
      offers: book.offers,
      ownBids,
      ownOffers,
      xCents: num(row.x_cents),
      feedAgeMs: book.feedAgeMs,
      receivedAgeMs: book.receivedAgeMs,
    });
    const trade = protect.evaluateTradeProtect({
      outcome: order.outcome,
      action: order.action,
      yesPrice: order.yesMicro / 1e6,
      tradeYes: book.lastTradeYes,
      tradeAtMs: book.lastTradeAtMs,
      nowMs: clock,
      xCents: num(row.x_cents),
      ownYesPrices: ownBids.concat(ownOffers).map((entry) => entry.yesPrice),
    });
    if (!decision.fire && trade.fire) decision = trade;
    book.midMicro = decision.referenceMicro;
    if (decision.reason === 'stale-receipt') {
      const unread = await cancelUntilFresh(client, store, tracks, audits, row, order, book, {
        clock, nowIso, reason: 'stale-cancel', live, markets, depths, tracked, notify,
      });
      if (unread.parked) parked += 1;
      if (unread.fired) fired += 1;
      if (unread.action) actions.push(unread.action);
      continue;
    }
    if (!decision.fire) {
      parked += 1;
      await noteCheck(audits, checkSample(row, order, book, {
        trigger: decision.reason,
        action: 'none',
        gapCents: decision.gapMicro == null ? null : decision.gapMicro / 10000,
        referenceCents: decision.referenceMicro == null ? null : decision.referenceMicro / 10000,
        checkedAt: nowIso,
      }));
      continue;
    }

    const token = crypto.randomUUID();
    const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'armed' });
    if (!claimed) continue;

    const named = namesFor(row, market);
    const tick = (market && market.ok && market.tick) || num(row.tick) || price.normalizeTick(null);
    const minQty = (market && market.ok && market.minQty) || num(row.min_qty) || 1;
    const atCap = (num(claimed.protect_count) || 0) >= protect.MAX_PROTECTS_PER_LINEAGE;
    const improve = atCap ? null : protect.improveFromMid({
      outcome: order.outcome,
      action: order.action,
      midOutcomeMicro: decision.referenceMicro,
      bidMicro: order.action === 'buy' ? decision.referenceMicro : null,
      askMicro: order.action === 'sell' ? decision.referenceMicro : null,
      yCents: num(row.y_cents),
      tick,
      restingOutcomeMicro: order.outcomeMicro,
      xCents: num(row.x_cents),
    });

    try {
      await client.cancelOrder(order.id, order.marketSlug);
    } catch (err) {
      const code = Number(err && err.statusCode);
      if (code === 404 || code === 409) {
        const settled = await settleAbsent(client, tracks, store, claimed, { token, clock, reason: 'cancel-' + code });
        if (settled.action) actions.push(settled.action);
        await noteCheck(audits, checkSample(row, order, book, { trigger: decision.reason || 'through', action: settled.action && settled.action.result, cancelResult: 'http-' + code, checkedAt: nowIso }));
        continue;
      }
      await store.update(row.order_id, { status: 'armed', sweep_token: null, hold_from: null }, { token });
      actions.push({
        result: 'error',
        reason: 'cancel-failed',
        orderId: row.order_id,
        marketSlug: row.market_slug,
        error: (err && err.publicMessage) || 'cancel failed',
      });
      await noteCheck(audits, checkSample(row, order, book, { trigger: decision.reason || 'through', action: 'cancel-failed', cancelResult: 'http-' + code, checkedAt: nowIso }));
      continue;
    }

    const reconciled = await noteProtectCancel(client, tracks, claimed, { clock });
    let priorSpentDollars = 0;
    let priorKnown = true;
    let blockReason = null;
    if (tracks) {
      if (!reconciled.persisted) {
        priorKnown = false;
        blockReason = 'track-unpersisted';
      } else {
        const lineage = await lineageSpendFor(store, tracks, claimed, { outcome: order.outcome, action: order.action });
        priorKnown = lineage.known;
        priorSpentDollars = lineage.dollars || 0;
        if (!lineage.known) blockReason = lineage.reason;
      }
    }
    const gate = track.replacementGate({
      official: reconciled.official,
      observedLeaves: order.quantity,
      priorSpentDollars,
      priorKnown,
      capDollars: protect.MAX_SIZE_DOLLARS,
      outcomeShort: order.outcome === 'short',
      action: order.action,
    });
    live.delete(order.id);
    if (!(await stillHeld(store, row.order_id, token))) continue;
    const oldAmerican = order.americanLabel;
    const oldCents = order.centsLabel;
    const confirmedLeaves = gate.replace ? gate.leaves : 0;
    const outstanding = gate.replace ? await lineageOutstanding(store, live, claimed) : { known: true, dollars: 0 };
    const roomAfterOpen = gate.replace && outstanding.known ? gate.roomDollars - outstanding.dollars : null;
    const sized = improve && improve.ok && gate.replace && outstanding.known
      ? protect.protectContracts({
        leaves: confirmedLeaves,
        outcomeMicro: improve.outcomeMicro,
        action: order.action,
        minQty,
        capDollars: roomAfterOpen,
      })
      : null;
    if (gate.replace && !outstanding.known) {
      await store.update(row.order_id, {
        status: 'pending_lineage',
        sweep_token: null,
        cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
      }, { token });
      actions.push({
        result: 'cancelled',
        reason: 'outstanding-unknown',
        orderId: row.order_id,
        marketSlug: row.market_slug,
      });
      continue;
    }

    if (holdForLineage(blockReason)) {
      await store.update(row.order_id, {
        status: 'pending_lineage',
        sweep_token: null,
        cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
      }, { token });
      fired += 1;
      actions.push({
        result: 'cancelled',
        reason: blockReason,
        orderId: row.order_id,
        marketSlug: row.market_slug,
        title: named.title,
        action: order.action,
        outcomeName: named.outcomeName,
        oldAmerican,
        oldCents,
        contracts: order.quantity,
      });
      continue;
    }

    if (atCap || !gate.replace || !improve || !improve.ok || !sized || !sized.ok) {
      const reason = atCap ? 'capped' : (!gate.replace ? gate.reason : 'no-improve');
      const officialState = reconciled.official && reconciled.official.verifiedState;
      const terminal = officialState === 'filled' || officialState === 'canceled' || officialState === 'partial_canceled' || officialState === 'expired' || officialState === 'partial_expired';
      const status = atCap ? 'capped' : (terminal ? officialState : 'armed');
      const patch = { status, sweep_token: null };
      if (!terminal) patch.cooldown_until = iso(clock + track.RESOLVE_COOLDOWN_MS);
      await store.update(row.order_id, patch, { token });
      const text = protect.formatProtectTelegram({
        title: named.title,
        action: order.action,
        outcomeName: named.outcomeName,
        oldAmerican,
        oldCents,
        contracts: order.quantity,
        cancelledOnly: true,
        reason,
      });
      const sent = await ping(notify, text);
      fired += 1;
      actions.push({
        result: 'cancelled',
        reason,
        orderId: row.order_id,
        marketSlug: row.market_slug,
        title: named.title,
        action: order.action,
        outcomeName: named.outcomeName,
        oldAmerican,
        oldCents,
        contracts: order.quantity,
        telegram: !!sent.ok,
      });
      await noteCheck(audits, checkSample(row, order, book, { trigger: decision.reason || 'through', action: 'cancelled', cancelResult: 'ok', checkedAt: nowIso }));
      continue;
    }

    const marked = await store.update(row.order_id, {
      pending_yes_price: improve.yesPriceValue,
      pending_contracts: sized.contracts,
      pending_intent: improve.intent,
      replaced_by: CREATE_UNKNOWN,
    }, { token });
    if (!marked) {
      await store.update(row.order_id, { status: 'armed', sweep_token: null, hold_from: null }, { token });
      continue;
    }
    const placed = await placeOrAdopt({
      client,
      live,
      tracked,
      slug: order.marketSlug,
      improve,
      contracts: sized.contracts,
      allowAdopt: false,
    });
    if (placed.ok && !(await stillHeld(store, row.order_id, token))) {
      try { await client.cancelOrder(placed.orderId, order.marketSlug); } catch (_) { /* user already disarmed */ }
      continue;
    }
    if (!placed.ok) {
      await store.update(row.order_id, {
        status: 'pending_rereset',
        sweep_token: null,
        pending_yes_price: improve.yesPriceValue,
        pending_contracts: sized.contracts,
        pending_intent: improve.intent,
        outcome_micro: order.outcomeMicro,
        replaced_by: placed.ambiguous ? CREATE_UNKNOWN : null,
      }, { token });
      const text = protect.formatProtectTelegram({
        title: named.title,
        action: order.action,
        outcomeName: named.outcomeName,
        oldAmerican,
        oldCents,
        contracts: sized.contracts,
        cancelledOnly: true,
        reason: 'retry',
      });
      const sent = await ping(notify, text);
      await store.update(row.order_id, { notified_at: nowIso });
      fired += 1;
      actions.push({
        result: 'pending',
        reason: 'rereset-failed',
        orderId: row.order_id,
        marketSlug: row.market_slug,
        title: named.title,
        oldAmerican,
        oldCents,
        contracts: sized.contracts,
        telegram: !!sent.ok,
      });
      continue;
    }

    await store.update(row.order_id, { replaced_by: placed.orderId }, { token });
    const newRow = replacementRow(row, placed.orderId, improve, sized.contracts, clock);
    let recorded = false;
    try {
      await store.insert(newRow);
      recorded = true;
    } catch (_) {
      const existing = await store.get(placed.orderId);
      recorded = !!(existing && existing.order_id);
    }
    if (!recorded) {
      await store.update(row.order_id, {
        status: 'pending_rereset',
        replaced_by: placed.orderId,
        sweep_token: null,
        pending_yes_price: improve.yesPriceValue,
        pending_contracts: sized.contracts,
        pending_intent: improve.intent,
        notified_at: nowIso,
      }, { token });
      const retryText = protect.formatProtectTelegram({
        title: named.title,
        action: order.action,
        outcomeName: named.outcomeName,
        oldAmerican,
        oldCents,
        contracts: sized.contracts,
        cancelledOnly: true,
        reason: 'retry',
      });
      const retrySent = await ping(notify, retryText);
      fired += 1;
      actions.push({
        result: 'pending',
        reason: 'registry',
        orderId: row.order_id,
        newOrderId: placed.orderId,
        marketSlug: row.market_slug,
        oldAmerican,
        oldCents,
        contracts: sized.contracts,
        telegram: !!retrySent.ok,
      });
      continue;
    }
    await linkReplacement(tracks, row, placed.orderId);
    await store.update(row.order_id, {
      status: 'replaced',
      replaced_by: placed.orderId,
      sweep_token: null,
      pending_yes_price: null,
      pending_contracts: null,
      pending_intent: null,
      notified_at: nowIso,
    }, { token });
    const text = protect.formatProtectTelegram({
      title: named.title,
      action: order.action,
      outcomeName: named.outcomeName,
      oldAmerican,
      newAmerican: improve.snappedAmericanLabel,
      oldCents,
      newCents: improve.centsLabel,
      contracts: sized.contracts,
    });
    const sent = await ping(notify, text);
    fired += 1;
    actions.push({
      result: 'rereset',
      orderId: row.order_id,
      newOrderId: placed.orderId,
      marketSlug: row.market_slug,
      title: named.title,
      action: order.action,
      outcomeName: named.outcomeName,
      oldAmerican,
      newAmerican: improve.snappedAmericanLabel,
      oldCents,
      newCents: improve.centsLabel,
      contracts: sized.contracts,
      yesPriceValue: improve.yesPriceValue,
      intent: improve.intent,
      telegram: !!sent.ok,
      adopted: !!placed.adopted,
    });
    await noteCheck(audits, checkSample(row, order, book, {
      trigger: decision.reason || 'through',
      action: 'rereset',
      cancelResult: 'ok',
      replacementId: placed.orderId,
      checkedAt: nowIso,
    }));
  }

  return { ok: true, checked: rows.length, fired, parked, actions };
}

async function recordReplacementRow(store, tracks, row, orderId, improve, contracts, clock, token) {
  const existing = await store.get(orderId);
  if (!existing) await store.insert(replacementRow(row, orderId, improve, contracts, clock));
  const linked = await linkReplacement(tracks, row, orderId);
  if (linked === false) throw new Error('replacement link was not saved');
  const updated = await store.update(row.order_id, {
    status: 'replaced',
    replaced_by: orderId,
    sweep_token: null,
    pending_yes_price: null,
    pending_contracts: null,
    pending_intent: null,
  }, { token });
  if (!updated) throw new Error('replacement status was not saved');
}

function pendingPatch(status, extra, clock) {
  return {
    status,
    sweep_token: null,
    cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
    ...extra,
  };
}

async function resolveExistingReplacement({ client, store, tracks, row, live, markets, tracked, token, clock, pendingStatus }) {
  const marker = row.replaced_by;
  if (!marker) return { handled: false };
  const park = async (reason, extra) => {
    await store.update(row.order_id, pendingPatch(pendingStatus, {
      replaced_by: marker,
      ...extra,
    }, clock), { token });
    return {
      handled: true,
      result: { fired: false, action: { result: 'pending', reason, orderId: row.order_id, marketSlug: row.market_slug, newOrderId: marker === CREATE_UNKNOWN ? null : marker } },
    };
  };
  if (marker === CREATE_UNKNOWN) {
    const open = (await refreshOpen(client, live)) || live;
    const adopted = findAdopt(open, {
      slug: row.market_slug,
      intent: row.pending_intent || price.intentFor(row.outcome, row.action),
      yesPriceValue: row.pending_yes_price,
      contracts: num(row.pending_contracts),
      skipIds: tracked,
    });
    if (!adopted) return park('create-unknown');
    try {
      await store.update(row.order_id, { replaced_by: adopted.id }, { token });
      await recordReplacementRow(store, tracks, row, adopted.id, {
        outcome: adopted.outcome || row.outcome,
        action: adopted.action || row.action,
        yesPriceValue: row.pending_yes_price,
        outcomeMicro: adopted.outcomeMicro != null ? adopted.outcomeMicro : row.outcome_micro,
      }, num(adopted.quantity != null ? adopted.quantity : row.pending_contracts), clock, token);
    } catch (_) {
      return park('registry', { replaced_by: adopted.id });
    }
    return {
      handled: true,
      result: { fired: true, live: open, action: { result: 'rereset', reason: 'adopted', orderId: row.order_id, newOrderId: adopted.id, marketSlug: row.market_slug, adopted: true } },
    };
  }
  let mapped = live && live.get ? live.get(marker) : null;
  try {
    if (!mapped && client && typeof client.getOrder === 'function') {
      const raw = await client.getOrder(marker);
      const order = unwrapOrder(raw);
      if (!order || !order.state) return park('replacement-unknown');
      if (isOpenState(order.state)) {
        mapped = price.mapOpenOrders({ orders: [order] }, markets)[0] || null;
        if (mapped && live && live.set) live.set(mapped.id, mapped);
      } else {
        const official = track.classifyOfficialOrder(order);
        await rememberTrack(tracks, {
          ...official,
          orderId: marker,
          ownerEmail: row.owner_email,
          marketSlug: row.market_slug,
          outcome: row.outcome,
          action: row.action,
          lineageId: row.lineage_id || row.order_id,
          replaces: row.order_id,
        });
        await store.update(row.order_id, {
          status: 'replaced',
          replaced_by: marker,
          sweep_token: null,
        }, { token });
        return {
          handled: true,
          result: { fired: false, action: { result: 'replaced', reason: official.verifiedState, orderId: row.order_id, newOrderId: marker, marketSlug: row.market_slug } },
        };
      }
    }
  } catch (_) {
    return park('replacement-unknown');
  }
  if (!mapped) return park('replacement-unknown');
  try {
    await recordReplacementRow(store, tracks, row, mapped.id, {
      outcome: mapped.outcome || row.outcome,
      action: mapped.action || row.action,
      yesPriceValue: mapped.yesMicro != null ? (mapped.yesMicro / 1e6).toFixed(3) : row.pending_yes_price,
      outcomeMicro: mapped.outcomeMicro != null ? mapped.outcomeMicro : row.outcome_micro,
    }, num(mapped.quantity != null ? mapped.quantity : row.pending_contracts), clock, token);
  } catch (_) {
    return park('registry');
  }
  return {
    handled: true,
    result: { fired: true, action: { result: 'rereset', reason: 'adopted', orderId: row.order_id, newOrderId: mapped.id, marketSlug: row.market_slug, adopted: true } },
  };
}

async function resumeLineageReplace({ client, store, notify, row, live, markets, depths, tracked, clock, nowIso, tracks }) {
  const token = crypto.randomUUID();
  const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'pending_lineage' });
  if (!claimed) return { fired: false };
  const existing = await resolveExistingReplacement({
    client, store, tracks, row: claimed, live, markets, tracked, token, clock, pendingStatus: 'pending_lineage',
  });
  if (existing.handled) return existing.result;
  const looked = await lookupOrder(client, row.order_id);
  const official = looked.order ? track.classifyOfficialOrder(looked.order) : null;
  const remembered = await rememberTrack(tracks, {
    ...track.protectCancelRecord(row, { at: iso(clock), official: official || undefined }),
    orderId: row.order_id,
    ownerEmail: row.owner_email,
    marketSlug: row.market_slug,
    outcome: row.outcome,
    action: row.action,
  });
  const again = {
    status: 'pending_lineage',
    sweep_token: null,
    cooldown_until: iso(clock + track.RESOLVE_COOLDOWN_MS),
  };
  if (!remembered.persisted) {
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: 'track-unpersisted', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const lineage = await lineageSpendFor(store, tracks, claimed, { outcome: row.outcome, action: row.action });
  if (!lineage.known) {
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: lineage.reason, orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const market = markets[row.market_slug];
  const named = namesFor(row, market);
  const resting = num(row.outcome_micro);
  const depthPayload = depths && depths[row.market_slug];
  const depthData = depthPayload && (depthPayload.marketData || depthPayload);
  const rawFeedAt = depthData && (depthData.transactTime || depthData.timestamp);
  const feedAtMs = rawFeedAt ? Date.parse(rawFeedAt) : NaN;
  const feedAgeMs = Number.isFinite(feedAtMs) ? clock - feedAtMs : null;
  const receiptFresh = !!depthData;
  const bidRows = protect.normalizeBookLevels(depthData && depthData.bids, { better: 'higher' });
  const askRows = protect.normalizeBookLevels(depthData && depthData.offers, { better: 'lower' });
  const bestBid = bidRows.length ? bidRows[0].price : null;
  const bestAsk = askRows.length ? askRows[0].price : null;
  const crossed = bestBid != null && bestAsk != null && bestBid + 1e-9 >= bestAsk;
  const bookSide = row.outcome === 'short' ? (row.action === 'buy' ? 'sell' : 'buy') : row.action;
  const outsideYes = bookSide === 'sell' ? bestAsk : bestBid;
  const reference = outsideYes == null ? null : (row.outcome === 'short' ? 1 - outsideYes : outsideYes);
  const referenceMicro = reference == null ? null : Math.round(reference * 1e6);
  const yes = num(row.yes_price);
  let decision = { fire: false, reason: 'no-book' };
  if (!receiptFresh) decision = { fire: false, reason: 'book-unread' };
  else if (crossed || outsideYes == null || yes == null || resting == null || referenceMicro == null) decision = { fire: false, reason: crossed ? 'crossed' : 'no-book' };
  else {
    const gapMicro = row.action === 'buy' ? resting - referenceMicro : referenceMicro - resting;
    const xMicro = Math.round(num(row.x_cents) * 10000);
    decision = { fire: gapMicro > xMicro, reason: gapMicro > xMicro ? 'through' : 'inside', referenceMicro };
  }
  if (decision.reason === 'age-unknown' || decision.reason === 'stale-feed' || decision.reason === 'crossed') {
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: decision.reason, orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const tick = (market && market.ok && market.tick) || num(row.tick) || price.normalizeTick(null);
  const minQty = (market && market.ok && market.minQty) || num(row.min_qty) || 1;
  const atCap = (num(claimed.protect_count) || 0) >= protect.MAX_PROTECTS_PER_LINEAGE;
  const improve = !decision.fire || atCap ? null : protect.improveFromMid({
    outcome: row.outcome,
    action: row.action,
    midOutcomeMicro: decision.referenceMicro,
    bidMicro: row.action === 'buy' ? decision.referenceMicro : null,
    askMicro: row.action === 'sell' ? decision.referenceMicro : null,
    yCents: num(row.y_cents),
    tick,
    restingOutcomeMicro: resting,
    xCents: num(row.x_cents),
  });
  const gate = track.replacementGate({
    official,
    observedLeaves: null,
    priorSpentDollars: lineage.dollars || 0,
    priorKnown: true,
    capDollars: protect.MAX_SIZE_DOLLARS,
    outcomeShort: row.outcome === 'short',
    action: row.action,
  });
  const outstanding = gate.replace ? await lineageOutstanding(store, live, claimed) : { known: true, dollars: 0 };
  const roomAfterOpen = gate.replace && outstanding.known ? gate.roomDollars - outstanding.dollars : null;
  const sized = improve && improve.ok && gate.replace && outstanding.known
    ? protect.protectContracts({
      leaves: gate.leaves,
      outcomeMicro: improve.outcomeMicro,
      action: row.action,
      minQty,
      capDollars: roomAfterOpen,
    })
    : null;
  if (gate.replace && !outstanding.known) {
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: 'outstanding-unknown', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  if (atCap || !decision.fire || !gate.replace || !improve || !improve.ok || !sized || !sized.ok) {
    const officialState = official && official.verifiedState;
    const terminal = !!(officialState && track.TERMINAL_TRACK_STATES.indexOf(officialState) !== -1);
    if (terminal && (!decision.fire || !gate.replace || atCap)) {
      await store.update(row.order_id, { status: atCap ? 'capped' : officialState, sweep_token: null }, { token });
      return { fired: false, action: { result: 'cancelled', reason: atCap ? 'capped' : (gate.reason || 'signal-gone'), orderId: row.order_id, marketSlug: row.market_slug } };
    }
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: (gate && gate.reason) || 'no-improve', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const marked = await store.update(row.order_id, {
    pending_yes_price: improve.yesPriceValue,
    pending_contracts: sized.contracts,
    pending_intent: improve.intent,
    replaced_by: CREATE_UNKNOWN,
  }, { token });
  if (!marked) {
    await store.update(row.order_id, again, { token });
    return { fired: false, action: { result: 'pending', reason: 'registry', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const placed = await placeOrAdopt({
    client,
    live,
    tracked,
    slug: row.market_slug,
    improve,
    contracts: sized.contracts,
    allowAdopt: false,
  });
  if (!placed.ok) {
    await store.update(row.order_id, pendingPatch('pending_lineage', {
      pending_yes_price: improve.yesPriceValue,
      pending_contracts: sized.contracts,
      pending_intent: improve.intent,
      replaced_by: placed.ambiguous ? CREATE_UNKNOWN : null,
    }, clock), { token });
    return { fired: false, action: { result: 'pending', reason: placed.ambiguous ? 'create-unknown' : 'rereset-failed', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  await store.update(row.order_id, { replaced_by: placed.orderId }, { token });
  try {
    await recordReplacementRow(store, tracks, row, placed.orderId, improve, sized.contracts, clock, token);
  } catch (_) {
    await store.update(row.order_id, pendingPatch('pending_lineage', {
      replaced_by: placed.orderId,
      pending_yes_price: improve.yesPriceValue,
      pending_contracts: sized.contracts,
      pending_intent: improve.intent,
    }, clock), { token });
    return { fired: true, live: placed.live, action: { result: 'pending', reason: 'registry', orderId: row.order_id, newOrderId: placed.orderId, marketSlug: row.market_slug, title: named.title } };
  }
  return {
    fired: true,
    live: placed.live,
    action: {
      result: 'rereset',
      orderId: row.order_id,
      newOrderId: placed.orderId,
      marketSlug: row.market_slug,
      title: named.title,
      contracts: sized.contracts,
      yesPriceValue: improve.yesPriceValue,
    },
  };
}

function replacementRow(row, newOrderId, improve, contracts, clock) {
  return {
    order_id: newOrderId,
    owner_email: row.owner_email,
    market_slug: row.market_slug,
    outcome: improve.outcome,
    action: improve.action,
    yes_price: improve.yesPriceValue,
    outcome_micro: improve.outcomeMicro,
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

const CREATE_UNKNOWN = 'create-unknown';

function restingDollars({ outcome, action, yesPrice, leaves }) {
  const yes = Number(yesPrice);
  const qty = Number(leaves);
  if (!(qty > 0)) return { known: true, dollars: 0 };
  if (!(yes > 0 && yes < 1)) return { known: false, dollars: null };
  const outcomePx = outcome === 'short' ? 1 - yes : yes;
  const riskPx = action === 'sell' ? 1 - outcomePx : outcomePx;
  if (!(riskPx > 0 && riskPx < 1)) return { known: false, dollars: null };
  return { known: true, dollars: qty * riskPx };
}

async function lineageOutstanding(store, live, row) {
  let dollars = 0;
  const lineage = row.lineage_id || row.order_id;
  const armed = store && typeof store.listArmed === 'function' ? await store.listArmed() : [];
  for (const other of armed || []) {
    if (!other || other.order_id === row.order_id) continue;
    if ((other.lineage_id || other.order_id) !== lineage) continue;
    if (other.status !== 'armed') continue;
    const liveOrder = live && typeof live.get === 'function' ? live.get(other.order_id) : null;
    const leaves = liveOrder ? protect.ownLeaves(liveOrder) : num(other.contracts);
    const yes = liveOrder && liveOrder.yesMicro != null ? liveOrder.yesMicro / 1e6 : num(other.yes_price);
    const part = restingDollars({
      outcome: liveOrder ? liveOrder.outcome : other.outcome,
      action: liveOrder ? liveOrder.action : other.action,
      yesPrice: yes,
      leaves,
    });
    if (!part.known) return { known: false, dollars: null };
    dollars += part.dollars;
  }
  return { known: true, dollars };
}

async function placeOrAdopt({ client, live, tracked, slug, improve, contracts, allowAdopt }) {
  const refreshed = await refreshOpen(client, live);
  const open = refreshed || live;
  if (allowAdopt) {
    const adopted = findAdopt(open, {
      slug,
      intent: improve.intent,
      yesPriceValue: improve.yesPriceValue,
      contracts,
      skipIds: tracked,
    });
    if (adopted) return { ok: true, orderId: adopted.id, adopted: true, live: open };
  }
  try {
    const quote = { ...improve, contracts };
    const body = price.buildLimitOrder({ slug, quote });
    const created = await client.createOrder(body);
    const orderId = created && (created.id || (created.order && created.order.id));
    if (!orderId) return { ok: false, ambiguous: true, live: open };
    return { ok: true, orderId: String(orderId), adopted: false, live: open };
  } catch (err) {
    const code = Number(err && err.statusCode);
    return { ok: false, ambiguous: !(code >= 400 && code < 500), statusCode: code, live: open };
  }
}

async function refreshOpen(client, fallback) {
  try {
    const payload = await client.listOpenOrders();
    return orderIndex(payload, {});
  } catch (_) {
    return fallback;
  }
}

async function finishRereset({ client, store, notify, row, live, markets, tracked, clock, nowIso, tracks }) {
  const token = crypto.randomUUID();
  const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'pending_rereset' });
  if (!claimed) return { fired: false };
  const market = markets[row.market_slug];
  const named = namesFor(row, market);
  const existing = await resolveExistingReplacement({
    client, store, tracks, row: claimed, live, markets, tracked, token, clock, pendingStatus: 'pending_rereset',
  });
  if (existing.handled) return existing.result;

  const tick = (market && market.ok && market.tick) || num(row.tick) || 0.001;
  const improve = {
    ok: true,
    outcome: row.outcome,
    action: row.action,
    intent: row.pending_intent || price.intentFor(row.outcome, row.action),
    yesPriceValue: row.pending_yes_price,
    outcomeMicro: null,
    snappedAmericanLabel: '',
    centsLabel: '',
  };
  // Rebuild labels from the stored YES price when the first create failed.
  const yes = num(row.pending_yes_price);
  if (yes != null) {
    const yesMicro = Math.round(yes * 1e6);
    const outcomeMicro = row.outcome === 'short' ? (1_000_000 - yesMicro) : yesMicro;
    improve.outcomeMicro = outcomeMicro;
    improve.snappedAmericanLabel = protect.americanLabelFromMicro(outcomeMicro);
    improve.centsLabel = protect.centsLabelFromMicro(outcomeMicro);
    improve.yesMicro = yesMicro;
    const tickMicro = Math.round(price.normalizeTick(tick) * 1e6);
    improve.yesPriceValue = price.formatYesPrice(yesMicro, tickMicro);
  }
  const marked = await store.update(row.order_id, {
    replaced_by: CREATE_UNKNOWN,
    pending_yes_price: improve.yesPriceValue,
    pending_contracts: num(row.pending_contracts),
    pending_intent: improve.intent,
  }, { token });
  if (!marked) {
    await store.update(row.order_id, pendingPatch('pending_rereset', {}, clock), { token });
    return { fired: false, action: { result: 'pending', reason: 'registry', orderId: row.order_id, marketSlug: row.market_slug } };
  }
  const placed = await placeOrAdopt({
    client,
    live,
    tracked,
    slug: row.market_slug,
    improve,
    contracts: num(row.pending_contracts),
    allowAdopt: true,
  });
  if (!placed.ok) {
    await store.update(row.order_id, pendingPatch('pending_rereset', {
      replaced_by: placed.ambiguous ? CREATE_UNKNOWN : null,
      pending_yes_price: improve.yesPriceValue,
      pending_contracts: num(row.pending_contracts),
      pending_intent: improve.intent,
    }, clock), { token });
    return { fired: false, action: { result: 'pending', reason: placed.ambiguous ? 'create-unknown' : 'rereset-failed', orderId: row.order_id, marketSlug: row.market_slug, telegram: false } };
  }
  await store.update(row.order_id, { replaced_by: placed.orderId }, { token });
  const snap = {
    ...improve,
    outcomeMicro: improve.outcomeMicro,
    yesPriceValue: improve.yesPriceValue,
  };
  try {
    await store.insert(replacementRow(row, placed.orderId, snap, num(row.pending_contracts), clock));
    await linkReplacement(tracks, row, placed.orderId);
    await store.update(row.order_id, { status: 'replaced', replaced_by: placed.orderId, sweep_token: null }, { token });
  } catch (_) {
    await store.update(row.order_id, {
      status: 'pending_rereset',
      replaced_by: placed.orderId,
      sweep_token: null,
    }, { token });
    return { fired: false };
  }
  const text = protect.formatProtectTelegram({
    title: named.title,
    action: row.action,
    outcomeName: named.outcomeName,
    oldAmerican: protect.americanLabelFromMicro(row.outcome_micro),
    newAmerican: improve.snappedAmericanLabel,
    oldCents: protect.centsLabelFromMicro(row.outcome_micro),
    newCents: improve.centsLabel,
    contracts: num(row.pending_contracts),
  });
  const sent = await ping(notify, text);
  return {
    fired: true,
    action: {
      result: 'rereset',
      orderId: row.order_id,
      newOrderId: placed.orderId,
      marketSlug: row.market_slug,
      title: named.title,
      action: row.action,
      outcomeName: named.outcomeName,
      oldAmerican: protect.americanLabelFromMicro(row.outcome_micro),
      newAmerican: improve.snappedAmericanLabel,
      oldCents: protect.centsLabelFromMicro(row.outcome_micro),
      newCents: improve.centsLabel,
      contracts: num(row.pending_contracts),
      yesPriceValue: improve.yesPriceValue,
      telegram: !!sent.ok,
    },
  };
}

function replacementFromPending(row, existing, clock) {
  return replacementRow(row, existing.id, {
    outcome: existing.outcome || row.outcome,
    action: existing.action || row.action,
    yesPriceValue: row.pending_yes_price,
    outcomeMicro: existing.outcomeMicro != null ? existing.outcomeMicro : row.outcome_micro,
  }, num(existing.quantity != null ? existing.quantity : row.pending_contracts), clock);
}

module.exports = {
  runProtectSweep,
  findAdopt,
};
