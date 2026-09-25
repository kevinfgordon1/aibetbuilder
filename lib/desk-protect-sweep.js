// Idempotent Adverse Protect sweep. Safe to call every 1–2s.
// Loads armed rests, reads each market mid, cancels when the rest is more
// than X¢ through mid, then re-rests better by Y¢. Does not chase a market that ran away.
'use strict';

const crypto = require('crypto');

// liveDeskPrice.js and liveDeskProtect.js are ESM. A static require() here
// would throw ERR_REQUIRE_ESM when the desk route loads, which blanks the page.
let price = null;
let protect = null;
let modsPromise = null;

function loadMods() {
  if (price && protect) return Promise.resolve();
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../src/liveDeskPrice.js'),
      import('../src/liveDeskProtect.js'),
    ]).then(([priceMod, protectMod]) => {
      price = priceMod;
      protect = protectMod;
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
  }));
  return { markets, bbos };
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

async function ping(notify, text) {
  if (typeof notify !== 'function') return { ok: false, skipped: true };
  try {
    const result = await notify(text);
    return result || { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

async function runProtectSweep({ client, store, notify, now = Date.now } = {}) {
  await loadMods();
  if (!store || !store.configured) {
    return { ok: false, status: 503, error: 'Protect registry is not configured. Apply sql/desk_protect_rests.sql and set SUPABASE_SERVICE_KEY.' };
  }
  const clock = typeof now === 'function' ? now() : Number(now);
  const nowIso = iso(clock);
  await store.releaseStale(iso(clock - protect.PROTECT_STALE_SWEEP_MS));
  const rows = await store.listArmed();
  const actions = [];
  let parked = 0;
  let fired = 0;
  if (!rows.length) {
    return { ok: true, checked: 0, fired: 0, parked: 0, actions };
  }

  const openPayload = await client.listOpenOrders();
  const slugs = [...new Set(rows.map((row) => String(row.market_slug || '').trim()).filter(Boolean))];
  const { markets, bbos } = await loadBooks(client, slugs);
  let live = orderIndex(openPayload, markets);

  for (const row of rows) {
    if (!row || row.status === 'sweeping') continue;
    const cooling = row.cooldown_until && Date.parse(row.cooldown_until) > clock;
    if (row.status === 'armed' && cooling) {
      parked += 1;
      continue;
    }
    const tracked = new Set(rows.map((item) => item.order_id).filter(Boolean));
    if (row.replaced_by) tracked.add(row.replaced_by);

    if (row.status === 'pending_rereset') {
      const outcome = await finishRereset({
        client, store, notify, row, live, markets, tracked, clock, nowIso,
      });
      if (outcome.fired) fired += 1;
      else parked += 1;
      if (outcome.action) actions.push(outcome.action);
      if (outcome.live) live = outcome.live;
      continue;
    }

    const order = live.get(row.order_id);
    if (!order) {
      await store.update(row.order_id, { status: 'gone', sweep_token: null });
      actions.push({ result: 'gone', orderId: row.order_id, marketSlug: row.market_slug });
      continue;
    }
    const market = markets[row.market_slug];
    if (market && market.ok && market.tradable === false) {
      parked += 1;
      continue;
    }
    const yesMid = protect.yesMidFromBbo(bbos[row.market_slug]);
    const midMicro = yesMid == null ? null : protect.outcomeMidMicro(yesMid, order.outcome);
    if (midMicro == null || order.outcomeMicro == null) {
      parked += 1;
      actions.push({ result: 'parked', reason: 'no-mid', orderId: row.order_id, marketSlug: row.market_slug });
      continue;
    }
    const decision = protect.evaluateProtect({
      action: order.action,
      restingOutcomeMicro: order.outcomeMicro,
      midOutcomeMicro: midMicro,
      xCents: num(row.x_cents),
    });
    if (!decision.fire) {
      parked += 1;
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
      midOutcomeMicro: midMicro,
      yCents: num(row.y_cents),
      tick,
      restingOutcomeMicro: order.outcomeMicro,
      xCents: num(row.x_cents),
    });
    const sized = improve && improve.ok
      ? protect.protectContracts({
        leaves: order.quantity,
        outcomeMicro: improve.outcomeMicro,
        action: order.action,
        minQty,
      })
      : null;

    try {
      await client.cancelOrder(order.id, order.marketSlug);
    } catch (err) {
      const code = Number(err && err.statusCode);
      if (code === 404 || code === 409) {
        await store.update(row.order_id, { status: 'gone', sweep_token: null }, { token });
        actions.push({ result: 'gone', orderId: row.order_id, marketSlug: row.market_slug });
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
      continue;
    }

    live.delete(order.id);
    if (!(await stillHeld(store, row.order_id, token))) continue;
    const oldAmerican = order.americanLabel;
    const oldCents = order.centsLabel;

    if (atCap || !improve || !improve.ok || !sized || !sized.ok) {
      const reason = atCap ? 'capped' : 'no-improve';
      await store.update(row.order_id, { status: atCap ? 'capped' : 'disarmed', sweep_token: null }, { token });
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
  }

  return { ok: true, checked: rows.length, fired, parked, actions };
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
    if (!orderId) return { ok: false };
    return { ok: true, orderId: String(orderId), adopted: false };
  } catch (_) {
    return { ok: false };
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

async function finishRereset({ client, store, notify, row, live, markets, tracked, clock, nowIso }) {
  const token = crypto.randomUUID();
  const claimed = await store.claim(row.order_id, token, { nowIso, fromStatus: 'pending_rereset' });
  if (!claimed) return { fired: false };
  const market = markets[row.market_slug];
  const named = namesFor(row, market);
  if (row.replaced_by && !live.get(row.replaced_by) && typeof client.getOrder === 'function') {
    try {
      const raw = await client.getOrder(row.replaced_by);
      const order = (raw && raw.order) || raw;
      if (order && isOpenState(order.state)) {
        const mapped = price.mapOpenOrders({ orders: [order] }, markets)[0];
        if (mapped) live.set(mapped.id, mapped);
      } else if (order && order.state) {
        row.replaced_by = null;
      }
    } catch (err) {
      if (!(err && err.statusCode === 404)) {
        await store.update(row.order_id, { status: 'pending_rereset', sweep_token: null }, { token });
        return { fired: false, action: { result: 'pending', reason: 'lookup', orderId: row.order_id, marketSlug: row.market_slug } };
      }
      row.replaced_by = null;
    }
  }
  if (row.replaced_by && live.get(row.replaced_by)) {
    const existing = live.get(row.replaced_by);
    try {
      await store.insert(replacementFromPending(row, existing, clock));
      await store.update(row.order_id, { status: 'replaced', sweep_token: null }, { token });
    } catch (_) {
      await store.update(row.order_id, { status: 'pending_rereset', sweep_token: null }, { token });
      return { fired: false };
    }
    const text = protect.formatProtectTelegram({
      title: named.title,
      action: row.action,
      outcomeName: named.outcomeName,
      oldAmerican: protect.americanLabelFromMicro(row.outcome_micro),
      newAmerican: existing.americanLabel,
      oldCents: protect.centsLabelFromMicro(row.outcome_micro),
      newCents: existing.centsLabel,
      contracts: existing.quantity,
    });
    const sent = await ping(notify, text);
    return {
      fired: true,
      action: {
        result: 'rereset',
        orderId: row.order_id,
        newOrderId: existing.id,
        marketSlug: row.market_slug,
        oldAmerican: protect.americanLabelFromMicro(row.outcome_micro),
        newAmerican: existing.americanLabel,
        contracts: existing.quantity,
        telegram: !!sent.ok,
        adopted: true,
      },
    };
  }

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
    await store.update(row.order_id, { status: 'pending_rereset', sweep_token: null }, { token });
    return { fired: false, action: { result: 'pending', reason: 'rereset-failed', orderId: row.order_id, marketSlug: row.market_slug, telegram: false } };
  }
  const snap = {
    ...improve,
    outcomeMicro: improve.outcomeMicro,
    yesPriceValue: improve.yesPriceValue,
  };
  try {
    await store.insert(replacementRow(row, placed.orderId, snap, num(row.pending_contracts), clock));
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
