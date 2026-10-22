// Per-user Combo Locks credits for the owner "All users" table.
// Fee = 1% of amount at risk per filled lock (lay price = 1 - yes price), drawn
// from the free monthly allowance first, then purchased credits
// (sql/20261010_combo_fees_per_user.sql). "Pending" estimates the fee if every
// open lock fills to its target (max_contracts), with the lay price implied by
// the lock's American fill price. Estimate only; real fills charge real prices.
'use strict';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function yesFromAmerican(a) {
  const x = Number(a);
  if (!Number.isFinite(x) || x === 0) return null;
  return x > 0 ? 100 / (x + 100) : -x / (100 - x);
}

function pendingByUser(parlays, fills) {
  const filled = {};
  for (const f of fills || []) if (f && f.parlay_id) filled[f.parlay_id] = (filled[f.parlay_id] || 0) + Number(f.count || 0);
  const out = {};
  for (const p of parlays || []) {
    const yes = yesFromAmerican(p.fill_american);
    const left = Math.max(Number(p.max_contracts || 0) - (filled[p.id] || 0), 0);
    if (yes == null || !left) continue;
    const o = out[p.user_id] || (out[p.user_id] = { usd: 0, contracts: 0, locks: 0 });
    o.usd += 0.01 * left * (1 - yes);
    o.contracts += left;
    o.locks += 1;
  }
  for (const k of Object.keys(out)) out[k].usd = r2(out[k].usd);
  return out;
}

// status rows from combo_fee_status_for_worker; pending from pendingByUser.
function creditsFor(st, pending) {
  if (!st) return null;
  if (!st.fees_enabled) return { feesEnabled: false };
  const used = r2(st.allowance_used_usd);
  const allowanceLeft = r2(st.allowance_left_usd);
  const purchased = r2(st.credits_usd);
  const left = r2(allowanceLeft + purchased);
  const pend = pending ? pending.usd : 0;
  return {
    feesEnabled: true, allowance: r2(st.monthly_allowance_usd), used, allowanceLeft, purchased, left,
    pending: pend, pendingContracts: pending ? pending.contracts : 0, leftAfterPending: r2(left - pend),
    canQuote: st.can_quote !== false,
  };
}

function totals(list) {
  const t = { feeUsers: 0, exempt: 0, used: 0, pending: 0, left: 0, purchased: 0, leftAfterPending: 0 };
  for (const u of list) {
    const c = u.credits;
    if (!c) continue;
    if (!c.feesEnabled) { t.exempt += 1; continue; }
    t.feeUsers += 1;
    for (const k of ['used', 'pending', 'left', 'purchased', 'leftAfterPending']) t[k] = r2(t[k] + c[k]);
  }
  return t;
}

async function attachCredits(client, list) {
  const ids = list.map((u) => u.user_id);
  if (!ids.length) return null;
  try {
    const st = await client.rpc('combo_fee_status_for_worker', { uids: ids });
    if (st.error) throw st.error;
    const byId = {};
    for (const r of st.data || []) byId[r.user_id] = r;
    const feeIds = Object.keys(byId).filter((id) => byId[id].fees_enabled);
    let pend = {};
    if (feeIds.length) {
      const pq = await client.from('combo_parlays').select('id,user_id,max_contracts,fill_american')
        .in('user_id', feeIds).eq('active', true).is('archived_at', null).is('settled_at', null).is('merged_into_id', null).limit(5000);
      if (pq.error) throw pq.error;
      const pids = (pq.data || []).map((p) => p.id);
      let fills = [];
      if (pids.length) {
        const fq = await client.from('combo_fills').select('parlay_id,count').in('parlay_id', pids).limit(20000);
        if (fq.error) throw fq.error;
        fills = fq.data || [];
      }
      pend = pendingByUser(pq.data || [], fills);
    }
    for (const u of list) u.credits = creditsFor(byId[u.user_id], pend[u.user_id]);
    return totals(list);
  } catch (_) {
    for (const u of list) u.credits = null;
    return null;
  }
}

module.exports = { yesFromAmerican, pendingByUser, creditsFor, totals, attachCredits };
