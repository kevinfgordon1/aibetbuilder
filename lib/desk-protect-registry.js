// Server-side Adverse Protect registry, keyed by Polymarket US order id.
// Production uses Supabase (service role, same as other Vercel jobs).
// Tests inject createMemoryProtectStore. RLS: no anon policies.
'use strict';

const TABLE = 'desk_protect_rests';

function copyRow(row) {
  return row ? { ...row } : null;
}

function createMemoryProtectStore(seed) {
  const rows = new Map();
  for (const row of seed || []) {
    rows.set(row.order_id, { status: 'armed', protect_count: 0, hold_from: null, ...row });
  }
  return {
    configured: true,
    kind: 'memory',
    async insert(row) {
      if (!row || !row.order_id) throw new Error('protect registry missing order id');
      if (rows.has(row.order_id)) throw new Error('protect registry duplicate order');
      const stored = {
        status: 'armed',
        protect_count: 0,
        hold_from: null,
        sweep_token: null,
        ...row,
        updated_at: row.updated_at || new Date().toISOString(),
      };
      rows.set(row.order_id, stored);
      return copyRow(stored);
    },
    async get(orderId) {
      return copyRow(rows.get(orderId));
    },
    async listArmed() {
      return [...rows.values()]
        .filter((row) => row.status === 'armed' || row.status === 'pending_rereset' || row.status === 'sweeping')
        .map(copyRow);
    },
    async listImproved(slugs) {
      const want = new Set((slugs || []).map((slug) => String(slug || '').trim()).filter(Boolean));
      if (!want.size) return [];
      return [...rows.values()]
        .filter((row) => want.has(row.market_slug) && (Number(row.protect_count) || 0) > 0)
        .map(copyRow);
    },
    async claim(orderId, token, { nowIso, fromStatus } = {}) {
      const row = rows.get(orderId);
      if (!row || row.status !== fromStatus) return null;
      row.status = 'sweeping';
      row.hold_from = fromStatus;
      row.sweep_token = token;
      row.updated_at = nowIso || new Date().toISOString();
      return copyRow(row);
    },
    async update(orderId, patch, { token } = {}) {
      const row = rows.get(orderId);
      if (!row) return null;
      if (token && row.sweep_token !== token) return null;
      Object.assign(row, patch, { updated_at: (patch && patch.updated_at) || new Date().toISOString() });
      return copyRow(row);
    },
    async disarm(orderId) {
      const row = rows.get(orderId);
      if (!row) return null;
      if (row.status === 'replaced' || row.status === 'gone') return copyRow(row);
      row.status = 'disarmed';
      row.sweep_token = null;
      row.updated_at = new Date().toISOString();
      return copyRow(row);
    },
    async releaseStale(cutoffIso) {
      const released = [];
      for (const row of rows.values()) {
        if (row.status !== 'sweeping') continue;
        if (row.updated_at && cutoffIso && row.updated_at >= cutoffIso) continue;
        row.status = row.hold_from || 'armed';
        row.sweep_token = null;
        row.updated_at = new Date().toISOString();
        released.push(copyRow(row));
      }
      return released;
    },
  };
}

function createSupabaseProtectStore({ env = process.env, client } = {}) {
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
    async insert(row) {
      const supabase = db();
      if (!supabase) throw new Error('Protect registry is not configured');
      const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
      if (error) throw new Error(error.message || 'protect insert failed');
      return data;
    },
    async get(orderId) {
      const supabase = db();
      if (!supabase) return null;
      const { data, error } = await supabase.from(TABLE).select('*').eq('order_id', orderId).maybeSingle();
      if (error) throw new Error(error.message || 'protect read failed');
      return data;
    },
    async listArmed() {
      const supabase = db();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .in('status', ['armed', 'pending_rereset', 'sweeping']);
      if (error) throw new Error(error.message || 'protect list failed');
      return data || [];
    },
    async listImproved(slugs) {
      const supabase = db();
      if (!supabase) return [];
      const want = [...new Set((slugs || []).map((slug) => String(slug || '').trim()).filter(Boolean))].slice(0, 40);
      if (!want.length) return [];
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .in('market_slug', want)
        .gt('protect_count', 0);
      if (error) throw new Error(error.message || 'protect improved list failed');
      return data || [];
    },
    async claim(orderId, token, { nowIso, fromStatus } = {}) {
      const supabase = db();
      if (!supabase) throw new Error('Protect registry is not configured');
      const { data, error } = await supabase
        .from(TABLE)
        .update({
          status: 'sweeping',
          hold_from: fromStatus,
          sweep_token: token,
          updated_at: nowIso || new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('status', fromStatus)
        .select('*');
      if (error) throw new Error(error.message || 'protect claim failed');
      return (data && data[0]) || null;
    },
    async update(orderId, patch, { token } = {}) {
      const supabase = db();
      if (!supabase) throw new Error('Protect registry is not configured');
      let q = supabase.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('order_id', orderId);
      if (token) q = q.eq('sweep_token', token);
      const { data, error } = await q.select('*');
      if (error) throw new Error(error.message || 'protect update failed');
      return (data && data[0]) || null;
    },
    async disarm(orderId) {
      const supabase = db();
      if (!supabase) return null;
      const { data, error } = await supabase
        .from(TABLE)
        .update({ status: 'disarmed', sweep_token: null, updated_at: new Date().toISOString() })
        .eq('order_id', orderId)
        .in('status', ['armed', 'pending_rereset', 'sweeping'])
        .select('*');
      if (error) throw new Error(error.message || 'protect disarm failed');
      return (data && data[0]) || null;
    },
    async releaseStale(cutoffIso) {
      const supabase = db();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('status', 'sweeping')
        .lt('updated_at', cutoffIso);
      if (error) throw new Error(error.message || 'protect stale read failed');
      const released = [];
      for (const row of data || []) {
        const next = row.hold_from || 'armed';
        const { data: updated, error: updErr } = await supabase
          .from(TABLE)
          .update({ status: next, sweep_token: null, updated_at: new Date().toISOString() })
          .eq('order_id', row.order_id)
          .eq('status', 'sweeping')
          .eq('sweep_token', row.sweep_token)
          .select('*');
        if (updErr) throw new Error(updErr.message || 'protect stale release failed');
        if (updated && updated[0]) released.push(updated[0]);
      }
      return released;
    },
  };
}

module.exports = {
  TABLE,
  createMemoryProtectStore,
  createSupabaseProtectStore,
};
