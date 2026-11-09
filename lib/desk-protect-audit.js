// Bounded Protect decision log. Same trigger and action within 30s is one row.
'use strict';

const TABLE = 'desk_protect_audits';
const HEARTBEAT_MS = 30000;

function text(v) {
  return v == null ? '' : String(v).trim();
}

function gate(last, sample) {
  const at = Date.parse(sample.checkedAt) || Date.now();
  const prev = last.get(sample.orderId);
  const changed = !prev || prev.trigger !== sample.trigger || prev.action !== sample.action || prev.replacementId !== (sample.replacementId || '');
  if (!changed && prev && at - prev.at < HEARTBEAT_MS) return null;
  last.set(sample.orderId, { trigger: sample.trigger, action: sample.action, replacementId: sample.replacementId || '', at });
  return at;
}

function createMemoryProtectAudit() {
  const rows = [];
  const last = new Map();
  return {
    configured: true,
    kind: 'memory',
    rows,
    async record(sample) {
      if (!sample || !sample.orderId) return null;
      if (!gate(last, sample)) return null;
      rows.push({ ...sample });
      return sample;
    },
    async latestByOrder(ownerEmail, orderIds) {
      const owner = text(ownerEmail).toLowerCase();
      const want = new Set((orderIds || []).map((id) => text(id)).filter(Boolean));
      const out = {};
      for (const row of rows) {
        if (!row || text(row.ownerEmail).toLowerCase() !== owner || !want.has(text(row.orderId))) continue;
        const prev = out[row.orderId];
        if (!prev || Date.parse(row.checkedAt) >= Date.parse(prev.checkedAt)) out[row.orderId] = row;
      }
      return out;
    },
  };
}

function createSupabaseProtectAudit({ env = process.env, client } = {}) {
  let cached = client || null;
  const last = new Map();
  let latencyColumn = true;
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
    get configured() { return !!db(); },
    kind: 'supabase',
    async record(sample) {
      const supabase = db();
      if (!supabase || !sample || !sample.orderId || !sample.ownerEmail) return null;
      if (!gate(last, sample)) return null;
      const row = {
        order_id: text(sample.orderId),
        owner_email: text(sample.ownerEmail).toLowerCase(),
        market_slug: text(sample.marketSlug),
        checked_at: sample.checkedAt || new Date().toISOString(),
        feed_at: sample.feedAt || null,
        feed_age_ms: Number.isFinite(sample.feedAgeMs) ? Math.round(sample.feedAgeMs) : null,
        order_cents: sample.orderCents == null ? null : sample.orderCents,
        reference_cents: sample.referenceCents == null ? null : sample.referenceCents,
        mid_cents: sample.midCents == null ? null : sample.midCents,
        gap_cents: sample.gapCents == null ? null : sample.gapCents,
        trigger: text(sample.trigger) || 'unpriced',
        action: text(sample.action) || 'none',
        cancel_result: sample.cancelResult || null,
        replacement_id: sample.replacementId || null,
      };
      if (latencyColumn && Number.isFinite(sample.latencyMs)) row.latency_ms = Math.round(sample.latencyMs);
      let { error } = await supabase.from(TABLE).insert(row);
      if (error && row.latency_ms != null && /latency_ms/i.test(error.message || '')) {
        latencyColumn = false;
        delete row.latency_ms;
        ({ error } = await supabase.from(TABLE).insert(row));
      }
      if (error) throw new Error(error.message || 'protect audit insert failed');
      return sample;
    },
    async latestByOrder(ownerEmail, orderIds) {
      const supabase = db();
      const owner = text(ownerEmail).toLowerCase();
      const want = [...new Set((orderIds || []).map((id) => text(id)).filter(Boolean))].slice(0, 40);
      if (!supabase || !owner || !want.length) return {};
      const { data, error } = await supabase.from(TABLE).select('order_id,trigger,gap_cents,checked_at').eq('owner_email', owner).in('order_id', want).order('checked_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message || 'protect audit list failed');
      const out = {};
      for (const row of data || []) {
        if (row && row.order_id && !out[row.order_id]) out[row.order_id] = { orderId: row.order_id, trigger: row.trigger, gapCents: row.gap_cents, checkedAt: row.checked_at };
      }
      return out;
    },
  };
}

module.exports = {
  HEARTBEAT_MS,
  createMemoryProtectAudit,
  createSupabaseProtectAudit,
};
