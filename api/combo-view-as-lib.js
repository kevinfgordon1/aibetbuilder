// Owner-only "View as" for Combo Locks: Kevin reads a tester's page exactly as
// they see it, strictly read-only.
//
// Safety rules (all enforced here, not in the UI):
//  * Only the Combo Locks owner (lib.isComboOwner) may ask for another user.
//  * The target must be a Combo Locks account or a combo_live_users row.
//  * Only SELECTs on a fixed table allowlist. combo_exchange_keys and anything
//    holding secrets is NOT on the list; key status comes from the masked
//    combo-keys loadStatus (key hints only, never key ids or secrets).
//  * Every query is forced to the target: user_id = target, or parlay_id in the
//    target's parlay ids for tables without user_id.
//  * Write endpoints call rejectViewAs(req): any request carrying the view-as
//    header / view_as param is refused with 403.
'use strict';

const lib = require('./combo-probe-lib');

const VIEW_AS_HEADER = 'x-view-as';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COL_RE = /^[a-z_][a-z0-9_]*$/;
const SELECT_RE = /^[a-z0-9_,* ]+$/;
const OR_RE = /^[a-z0-9_.,()\-:]+$/;
const MAX_QUERIES = 500;
const MAX_LIMIT = 10000;

// table -> how it is scoped to the viewed user
const TABLES = Object.freeze({
  combo_parlays: 'user',
  combo_settings: 'user',
  combo_submissions: 'user',
  combo_fills: 'user',
  combo_parlay_bets: 'user',
  combo_balances: 'user',
  combo_fund_moves: 'user',
  combo_credit_balances: 'user',
  combo_credit_ledger: 'user',
  combo_fee_charges: 'user',
  combo_single_orders: 'user',
  combo_user_alerts: 'user',
  combo_live_users: 'user',
  combo_match_counts: 'parlay',
  combo_matches: 'parlay',
  quote_outcomes: 'parlay',
});
const FILTER_OPS = new Set(['eq', 'neq', 'is', 'in', 'not', 'or', 'gt', 'gte', 'lt', 'lte']);

function headerOf(req, name) {
  const h = (req && req.headers) || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || '';
}

/** The view_as value on a request (header, query or JSON body), or ''. */
function readViewAs(req) {
  const fromHeader = headerOf(req, VIEW_AS_HEADER);
  if (fromHeader) return String(fromHeader).trim().toLowerCase();
  const q = (req && req.query) || {};
  if (q.view_as) return String(q.view_as).trim().toLowerCase();
  let body = req && req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (body && typeof body === 'object' && body.view_as) return String(body.view_as).trim().toLowerCase();
  return '';
}

/** For write endpoints: { status, error } when the request is in view-as mode, else null. */
function rejectViewAs(req) {
  if (!readViewAs(req)) return null;
  return { status: 403, error: 'Read-only: you are viewing as another user. Switch back to yourself to make changes.' };
}

/** Respond 403 and return true when a write request is in view-as mode. */
function blockViewAsWrite(req, res) {
  const r = rejectViewAs(req);
  if (!r) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.status).json({ ok: false, code: 'view_as_read_only', error: r.error });
  return true;
}

/** Combo Locks accounts that can be viewed (hardcoded list + combo_live_users ids). */
function viewableIds(liveUserIds = []) {
  const ids = new Set(lib.COMBO_LOCKS_ACCOUNTS.map((a) => a.id));
  for (const id of liveUserIds) if (UUID_RE.test(String(id || '').toLowerCase())) ids.add(String(id).toLowerCase());
  return ids;
}

/** Owner check + target check. Returns { ok, status?, error?, targetId }. */
function authorizeViewAs(actor, target, liveUserIds = []) {
  if (!lib.isComboOwner(actor)) return { ok: false, status: 403, error: 'Only the owner can view as another user' };
  const id = String(target || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) return { ok: false, status: 400, error: 'view_as must be a user id' };
  if (!viewableIds(liveUserIds).has(id)) return { ok: false, status: 404, error: 'Not a Combo Locks user' };
  return { ok: true, targetId: id };
}

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Validate one recorded query from the client. Returns { ok, plan } or { ok:false, error }. */
function sanitizeQuery(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'bad query' };
  const table = String(spec.table || '');
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) return { ok: false, error: `table not viewable: ${table}` };
  const select = spec.select == null ? '*' : String(spec.select);
  if (!SELECT_RE.test(select)) return { ok: false, error: 'bad select' };
  const opts = spec.selectOpts && typeof spec.selectOpts === 'object' ? spec.selectOpts : {};
  const selectOpts = {};
  if (opts.count === 'exact') selectOpts.count = 'exact';
  if (opts.head === true) selectOpts.head = true;
  const filters = [];
  for (const f of Array.isArray(spec.filters) ? spec.filters : []) {
    const op = f && f.op;
    if (!FILTER_OPS.has(op)) return { ok: false, error: `filter not allowed: ${op}` };
    const args = Array.isArray(f.args) ? f.args : [];
    if (op === 'or') {
      if (args.length !== 1 || typeof args[0] !== 'string' || !OR_RE.test(args[0])) return { ok: false, error: 'bad or filter' };
      filters.push({ op, args: [args[0]] });
      continue;
    }
    if (!COL_RE.test(String(args[0] || ''))) return { ok: false, error: 'bad column' };
    if (op === 'not') {
      if (args.length !== 3 || !/^[a-z]+$/.test(String(args[1])) || !isScalar(args[2])) return { ok: false, error: 'bad not filter' };
    } else if (op === 'in') {
      if (args.length !== 2 || !Array.isArray(args[1]) || args[1].length > 1000 || !args[1].every(isScalar)) return { ok: false, error: 'bad in filter' };
    } else if (args.length !== 2 || !isScalar(args[1])) return { ok: false, error: 'bad filter' };
    filters.push({ op, args });
  }
  const order = [];
  for (const o of Array.isArray(spec.order) ? spec.order : []) {
    if (!o || !COL_RE.test(String(o.column || ''))) return { ok: false, error: 'bad order' };
    order.push({ column: o.column, ascending: o.ascending !== false });
  }
  let limit = null;
  if (spec.limit != null) {
    const n = Math.floor(Number(spec.limit));
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'bad limit' };
    limit = Math.min(n, MAX_LIMIT);
  }
  let range = null;
  if (spec.range != null) {
    const from = Math.floor(Number(spec.range && spec.range.from));
    const to = Math.floor(Number(spec.range && spec.range.to));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || to - from + 1 > MAX_LIMIT) return { ok: false, error: 'bad range' };
    range = { from, to };
  }
  const single = spec.single === 'maybe' || spec.single === 'one' ? spec.single : null;
  return { ok: true, plan: { table, scope: TABLES[table], select, selectOpts, filters, order, limit, range, single } };
}

/** Run a sanitized plan with the service client, forced to the viewed user. */
async function runPlan(client, plan, targetId, parlayIds) {
  let q = client.from(plan.table).select(plan.select, plan.selectOpts);
  for (const f of plan.filters) {
    // The client's own user_id filters are dropped; the server pins the target.
    if (f.op === 'eq' && f.args[0] === 'user_id') continue;
    q = q[f.op](...f.args);
  }
  if (plan.scope === 'user') q = q.eq('user_id', targetId);
  else q = q.in('parlay_id', parlayIds.length ? parlayIds : ['00000000-0000-0000-0000-000000000000']);
  for (const o of plan.order) q = q.order(o.column, { ascending: o.ascending });
  if (plan.limit != null) q = q.limit(plan.limit);
  if (plan.range) q = q.range(plan.range.from, plan.range.to);
  if (plan.single === 'maybe') q = q.maybeSingle();
  else if (plan.single === 'one') q = q.single();
  const r = await q;
  return { data: r.data === undefined ? null : r.data, error: r.error ? { message: String(r.error.message || r.error) } : null, count: r.count == null ? null : r.count };
}

module.exports = {
  VIEW_AS_HEADER, TABLES, MAX_QUERIES, UUID_RE,
  readViewAs, rejectViewAs, blockViewAsWrite, viewableIds, authorizeViewAs, sanitizeQuery, runPlan,
};
