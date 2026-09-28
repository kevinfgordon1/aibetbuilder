'use strict';

const assert = require('node:assert/strict');
const handler = require('./combo-merge.js');

function memoryDb(seed) {
  const tables = {
    combo_parlays: [],
    combo_parlay_bets: [],
    combo_parlay_merge_batches: [],
    combo_parlay_hedge_moves: [],
    combo_fills: [],
    combo_submissions: [],
    combo_matches: [],
    quote_outcomes: [],
    ...seed,
  };
  const fail = { survivor: 0 };
  function from(name) {
    const state = { op: 'select', patch: null, filters: [], fail: false };
    const run = () => {
      if (state.fail) return { data: null, error: { message: 'forced survivor failure' } };
      let rows = tables[name] || [];
      const match = (row) => state.filters.every((fn) => fn(row));
      if (state.op === 'select') return { data: rows.filter(match).map((row) => ({ ...row })), error: null };
      if (state.op === 'insert') {
        const incoming = Array.isArray(state.patch) ? state.patch : [state.patch];
        let n = 0;
        incoming.forEach((row) => {
          const copy = { ...row };
          if (!copy.id) copy.id = `${name}-${Date.now().toString(36)}-${n++}`;
          rows.push(copy);
        });
        tables[name] = rows;
        return { data: incoming, error: null };
      }
      if (state.op === 'update') {
        rows.forEach((row) => { if (match(row)) Object.assign(row, state.patch); });
        return { data: null, error: null };
      }
      if (state.op === 'delete') {
        tables[name] = rows.filter((row) => !match(row));
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'bad op' } };
    };
    const api = {
      select() { state.op = 'select'; return api; },
      insert(row) { state.op = 'insert'; state.patch = row; return api; },
      update(patch) {
        state.op = 'update';
        state.patch = patch;
        if (name === 'combo_parlays' && patch && patch.merged_at && patch.parlay_stake != null && fail.survivor > 0) {
          fail.survivor -= 1;
          state.fail = true;
        }
        return api;
      },
      delete() { state.op = 'delete'; return api; },
      eq(col, val) { state.filters.push((row) => row[col] === val); return api; },
      in(col, vals) {
        const set = new Set(vals);
        state.filters.push((row) => set.has(row[col]));
        return api;
      },
      is(col, val) {
        state.filters.push((row) => (val == null ? row[col] == null : row[col] === val));
        return api;
      },
      order() { return api; },
      limit() { return api; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }
  return { from, tables, fail };
}

const legs = [
  { ticker: 'KXNFLGAME-26OCT051300CLEVLV-CLE', side: 'yes', label: 'CLE' },
  { ticker: 'KXNFLGAME-26OCT051300LVDAL-LV', side: 'yes', label: 'LV' },
  { ticker: 'KXNFLGAME-26OCT051300PITBAL-PIT', side: 'yes', label: 'PIT' },
];

function ticket(id, stake, american, created) {
  return {
    id,
    user_id: 'user-1',
    label: 'CLE + LV + PIT',
    legs,
    leg_keys: legs.map((leg) => `${leg.ticker}:${leg.side}`),
    active: true,
    archived_at: null,
    created_at: created,
    parlay_stake: stake,
    parlay_american: american,
    fill_american: 1200,
    hedge_mode: '1x',
    is_free_bet: false,
    bet_type: 'cash',
    max_contracts: Math.round(stake * (1 + american / 100)),
    starts_at: '2026-10-05T17:00:00Z',
  };
}

{
  const db = memoryDb({
    combo_parlays: [
      ticket('a', 100, 1979, '2026-09-26T18:00:00Z'),
      ticket('b', 250, 2100, '2026-09-27T18:00:00Z'),
    ],
    combo_fills: [
      { id: 'fill-b', fill_id: 'kalshi-1', parlay_id: 'b', count: 400, order_id: 'ord-1', raw: { trade_id: 't1' } },
    ],
    combo_submissions: [{ id: 'sub-b', parlay_id: 'b', quote_id: 'q1' }],
    quote_outcomes: [{ id: 'out-b', parlay_id: 'b', quote_id: 'q1' }],
  });
  handler._executeMerge(db, { id: 'user-1', email: 'kev120909@gmail.com' }, {
    action: 'merge',
    survivorId: 'a',
    absorbIds: ['b'],
  }).then((result) => {
    assert.equal(result.ok, true);
    assert.equal(result.totalAtRisk, 350);
    assert.equal(result.totalProfit, 7229);
    assert.equal(result.trueOdds, 2065);
    assert.equal(result.cap, 7579);
    const a = db.tables.combo_parlays.find((row) => row.id === 'a');
    const b = db.tables.combo_parlays.find((row) => row.id === 'b');
    assert.equal(a.parlay_stake, 350);
    assert.equal(a.is_free_bet, false);
    assert.equal(a.active, true);
    assert.equal(b.active, false);
    assert.equal(b.merged_into_id, 'a');
    assert.ok(b.archived_at);
    assert.equal(db.tables.combo_fills[0].parlay_id, 'a');
    assert.equal(db.tables.combo_submissions[0].parlay_id, 'a');
    assert.equal(db.tables.quote_outcomes[0].parlay_id, 'a');
    assert.equal(db.tables.combo_parlay_bets.length, 2);
    return handler._executeMerge(db, { id: 'user-1' }, { action: 'undo', survivorId: 'a' });
  }).then((undone) => {
    assert.equal(undone.ok, true);
    const a = db.tables.combo_parlays.find((row) => row.id === 'a');
    const b = db.tables.combo_parlays.find((row) => row.id === 'b');
    assert.equal(Number(a.parlay_stake), 100);
    assert.equal(Number(a.parlay_american), 1979);
    assert.equal(a.merged_at, null);
    assert.equal(b.active, true);
    assert.equal(b.merged_into_id, null);
    assert.equal(b.archived_at, null);
    assert.equal(db.tables.combo_fills[0].parlay_id, 'b');
    assert.equal(db.tables.combo_parlay_bets.length, 0);
    const later = memoryDb({
      combo_parlays: [
        ticket('a', 100, 1979, '2026-09-26T18:00:00Z'),
        ticket('b', 250, 2100, '2026-09-27T18:00:00Z'),
      ],
      combo_fills: [
        { id: 'fill-b', fill_id: 'kalshi-1', parlay_id: 'b', count: 10, order_id: 'ord-1', raw: { trade_id: 't1' } },
      ],
    });
    return handler._executeMerge(later, { id: 'user-1' }, {
      action: 'merge',
      survivorId: 'a',
      absorbIds: ['b'],
    }).then(() => {
      later.tables.combo_fills.push({
        id: 'fill-new', fill_id: 'kalshi-2', parlay_id: 'a', count: 5, order_id: 'ord-9', raw: { trade_id: 't2' },
      });
      return handler._executeMerge(later, { id: 'user-1' }, { action: 'undo', survivorId: 'a' });
    });
  }).then((blocked) => {
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /fill landed after this merge/);
    const db = memoryDb({
      combo_parlays: [
        ticket('a', 100, 1979, '2026-09-26T18:00:00Z'),
        ticket('b', 250, 2100, '2026-09-27T18:00:00Z'),
      ],
      combo_fills: [
        { id: 'fill-b', fill_id: 'kalshi-1', parlay_id: 'b', count: 10, order_id: 'ord-1', raw: { trade_id: 't1' } },
      ],
    });
    db.fail.survivor = 1;
    return handler._executeMerge(db, { id: 'user-1' }, {
      action: 'merge',
      survivorId: 'a',
      absorbIds: ['b'],
    }).then(() => {
      throw new Error('expected the forced failure');
    }, (err) => {
      assert.match(String(err.message), /forced survivor failure/);
      const a = db.tables.combo_parlays.find((row) => row.id === 'a');
      const b = db.tables.combo_parlays.find((row) => row.id === 'b');
      assert.equal(Number(a.parlay_stake), 100);
      assert.equal(b.active, true);
      assert.equal(b.merged_into_id, null);
      assert.equal(b.archived_at, null);
      assert.equal(db.tables.combo_fills[0].parlay_id, 'b');
      assert.equal(db.tables.combo_parlay_bets.length, 0);
      assert.equal(db.tables.combo_parlay_merge_batches.length, 0);
    });
  }).then(() => {
    console.log('combo-merge.test.js ok');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
