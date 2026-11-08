// Auditable order outcomes for read-only Supabase checks.
// Writes are service-role only. Reads are filtered by owner email.
// A missing table must not take down the desk or the sweep.
'use strict';

const TABLE = 'desk_order_tracks';

function copy(row) {
  return row ? { ...row } : null;
}

function text(v) {
  return v == null ? '' : String(v).trim();
}

function toDb(record) {
  return {
    order_id: text(record.orderId),
    owner_email: text(record.ownerEmail).toLowerCase(),
    market_slug: text(record.marketSlug),
    venue: 'polymarket-us',
    verified_state: text(record.verifiedState) || 'unknown',
    exchange_state: text(record.exchangeState),
    cum_qty: record.cumQty == null ? null : record.cumQty,
    leaves_qty: record.leavesQty == null ? null : record.leavesQty,
    order_qty: record.orderQty == null ? null : record.orderQty,
    avg_yes_price: record.avgYesPrice == null ? null : record.avgYesPrice,
    cost: record.cost == null ? null : record.cost,
    fees: record.fees == null ? null : record.fees,
    opened_at: record.openedAt || null,
    last_fill_at: record.lastFillAt || null,
    terminal_at: record.terminalAt || null,
    replaces: record.replaces || null,
    replaced_by: record.replacedBy || null,
    lineage_id: record.lineageId || null,
    unknown_reason: text(record.unknownReason),
    source: text(record.source),
    resolve_attempts: Number(record.resolveAttempts) || 0,
    total_failures: Number(record.totalFailures) || 0,
    reopen_count: Number(record.reopenCount) || 0,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function fromDb(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    ownerEmail: row.owner_email,
    marketSlug: row.market_slug,
    venue: row.venue || 'polymarket-us',
    verifiedState: row.verified_state,
    exchangeState: row.exchange_state || '',
    cumQty: row.cum_qty == null ? null : Number(row.cum_qty),
    leavesQty: row.leaves_qty == null ? null : Number(row.leaves_qty),
    orderQty: row.order_qty == null ? null : Number(row.order_qty),
    avgYesPrice: row.avg_yes_price == null ? null : Number(row.avg_yes_price),
    cost: row.cost == null ? null : Number(row.cost),
    fees: row.fees == null ? null : Number(row.fees),
    openedAt: row.opened_at || null,
    lastFillAt: row.last_fill_at || null,
    terminalAt: row.terminal_at || null,
    replaces: row.replaces || null,
    replacedBy: row.replaced_by || null,
    lineageId: row.lineage_id || null,
    unknownReason: row.unknown_reason || '',
    source: row.source || '',
    resolveAttempts: Number(row.resolve_attempts) || 0,
    totalFailures: Number(row.total_failures) || 0,
    reopenCount: Number(row.reopen_count) || 0,
    readFailed: false,
  };
}

function createMemoryOrderTrackStore(seed) {
  const rows = new Map();
  for (const row of seed || []) {
    const stored = fromDb(toDb(row.orderId ? row : fromDb(row)));
    if (stored && stored.orderId) rows.set(stored.orderId, stored);
  }
  return {
    configured: true,
    kind: 'memory',
    async get(orderId) {
      return copy(rows.get(text(orderId)));
    },
    async listByOrderIds(ids, ownerEmail) {
      const owner = text(ownerEmail).toLowerCase();
      if (!owner) return [];
      const want = new Set((ids || []).map((id) => text(id)).filter(Boolean));
      return [...rows.values()]
        .filter((row) => want.has(row.orderId) && row.ownerEmail === owner)
        .map(copy);
    },
    async upsert(record) {
      const row = fromDb(toDb(record));
      if (!row.orderId || !row.ownerEmail) throw new Error('order track missing id or owner');
      const prev = rows.get(row.orderId);
      if (prev && prev.ownerEmail !== row.ownerEmail) return copy(prev);
      rows.set(row.orderId, row);
      return copy(row);
    },
  };
}

function createSupabaseOrderTrackStore({ env = process.env, client } = {}) {
  let cached = client || null;
  function db() {
    if (cached) return cached;
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return cached;
  }
  return {
    get configured() {
      return !!db();
    },
    kind: 'supabase',
    async get(orderId) {
      const supabase = db();
      if (!supabase) return null;
      const { data, error } = await supabase.from(TABLE).select('*').eq('order_id', text(orderId)).maybeSingle();
      if (error) throw new Error(error.message || 'order track read failed');
      return fromDb(data);
    },
    async listByOrderIds(ids, ownerEmail) {
      const supabase = db();
      const owner = text(ownerEmail).toLowerCase();
      if (!supabase || !owner) return [];
      const want = [...new Set((ids || []).map((id) => text(id)).filter(Boolean))].slice(0, 50);
      if (!want.length) return [];
      const { data, error } = await supabase.from(TABLE).select('*').in('order_id', want).eq('owner_email', owner);
      if (error) throw new Error(error.message || 'order track list failed');
      return (data || []).map(fromDb);
    },
    async upsert(record) {
      const supabase = db();
      if (!supabase) throw new Error('order track store is not configured');
      const row = toDb(record);
      if (!row.order_id || !row.owner_email) throw new Error('order track missing id or owner');
      const { data: prev, error: readErr } = await supabase.from(TABLE).select('owner_email').eq('order_id', row.order_id).maybeSingle();
      if (readErr) throw new Error(readErr.message || 'order track read failed');
      if (prev && prev.owner_email && prev.owner_email !== row.owner_email) {
        return fromDb(prev);
      }
      const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: 'order_id' }).select('*').single();
      if (error) throw new Error(error.message || 'order track upsert failed');
      return fromDb(data);
    },
  };
}

module.exports = {
  TABLE,
  createMemoryOrderTrackStore,
  createSupabaseOrderTrackStore,
};
