import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hedgeCap } from "./comboLockProfile.js";
import {
  mergeEconomics,
  encodeMergedParlay,
  workerCashPosition,
  bindingCap,
  legSignature,
  findMergeTarget,
  findDuplicateGroups,
  duplicateWarning,
  gameHasStarted,
  buildMergePlan,
  buildUndoPlan,
  undoStatus,
  UNDO_FILL_REASON,
  originalBetResult,
  isAbsorbedParlay,
  formatAmerican,
} from "./comboMerge.js";

const NOW = Date.parse("2026-09-28T16:00:00Z");
const FILL = 1200;

function leg(ticker, side, label) {
  return { ticker, side, label: label || ticker.split("-").pop() };
}

const cle = leg("KXNFLGAME-26OCT011300CLEVLV-CLE", "yes", "CLE");
const lv = leg("KXNFLGAME-26OCT011300LVDAL-LV", "yes", "LV");
const pit = leg("KXNFLGAME-26OCT011300PITBAL-PIT", "yes", "PIT");
const pitLine = (n) => leg(`KXNFLSPREAD-26OCT011300PITBAL-PIT${n}`, "yes", `PIT −${n}`);

function parlay(id, legs, extra = {}) {
  return {
    id,
    user_id: "user-1",
    label: "CLE + LV + PIT",
    legs,
    leg_keys: legs.map((l) => `${l.ticker}:${l.side}`),
    active: true,
    archived_at: null,
    created_at: extra.created_at || "2026-09-26T18:00:00Z",
    parlay_stake: extra.parlay_stake,
    parlay_american: extra.parlay_american,
    fill_american: extra.fill_american || FILL,
    hedge_mode: extra.hedge_mode || "1x",
    is_free_bet: extra.is_free_bet === true,
    bet_type: extra.bet_type || (extra.is_free_bet ? "free" : "cash"),
    max_contracts: extra.max_contracts,
    sportsbook: extra.sportsbook || null,
    boost_pct: extra.boost_pct != null ? extra.boost_pct : null,
    starts_at: extra.starts_at || "2026-10-01T17:00:00Z",
  };
}

function cash100() {
  const row = parlay("a", [cle, lv, pit], {
    created_at: "2026-09-26T18:00:00Z",
    parlay_stake: 100,
    parlay_american: 1979,
    sportsbook: "FanDuel",
  });
  row.max_contracts = bindingCap(row).effectiveCap;
  return row;
}

function cash250() {
  const row = parlay("b", [pit, cle, lv], {
    created_at: "2026-09-27T18:00:00Z",
    parlay_stake: 250,
    parlay_american: 2100,
    sportsbook: "DraftKings",
  });
  row.max_contracts = bindingCap(row).effectiveCap;
  return row;
}

function free100() {
  const row = parlay("f", [cle, lv, pit], {
    parlay_stake: 100,
    parlay_american: 1979,
    is_free_bet: true,
    bet_type: "free",
    sportsbook: "BetMGM",
  });
  // UI free-bet 1× cap is profit, which is what we persist as max_contracts.
  const encoded = encodeMergedParlay(mergeEconomics([{ stake: 100, american: 1979, bet_type: "free" }]), {
    fillAmerican: FILL,
    hedgeMode: "1x",
  });
  row.max_contracts = encoded.max_contracts;
  return row;
}

// ── merge math ──
{
  const hybrid = mergeEconomics([
    { stake: 250, american: 2100, bet_type: "cash" },
    { stake: 100, american: 1979, bet_type: "free" },
  ]);
  assert.equal(hybrid.totalAtRisk, 250);
  assert.equal(hybrid.totalProfit, 7229);
  assert.equal(hybrid.displayAmerican, 2892);
  assert.equal(formatAmerican(hybrid.trueAmericanExact), "+2892");
  assert.equal(hybrid.isFreeBet, false);

  const both = mergeEconomics([
    { stake: 250, american: 2100, kind: "cash" },
    { stake: 100, american: 1979, kind: "cash" },
  ]);
  assert.equal(both.totalAtRisk, 350);
  assert.equal(both.totalProfit, 7229);
  assert.equal(both.displayAmerican, 2065);
  assert.equal(both.isFreeBet, false);

  const boostMix = mergeEconomics([
    { stake: 100, american: 500, bet_type: "boost", boost_pct: 25, sportsbook: "FanDuel" },
    { stake: 100, american: 500, bet_type: "cash", sportsbook: "DraftKings" },
    { stake: 40, american: 300, bet_type: "free" },
  ]);
  assert.equal(boostMix.totalAtRisk, 200);
  assert.equal(boostMix.totalProfit, 500 + 500 + 120);
  assert.equal(boostMix.isFreeBet, false);
  assert.equal(boostMix.parts[0].type, "boost");

  const allFree = mergeEconomics([
    { stake: 100, american: 1979, bet_type: "free" },
    { stake: 50, american: 1000, bet_type: "free" },
  ]);
  assert.equal(allFree.totalAtRisk, 0);
  assert.equal(allFree.totalProfit, 2479);
  assert.equal(allFree.freeStake, 150);
  assert.equal(allFree.isFreeBet, true);
  assert.equal(allFree.displayAmerican, 1653);
  assert.equal(originalBetResult({ stake: 100, american: 1979, bet_type: "free" }, false), 0);
  assert.equal(originalBetResult({ stake: 100, american: 1979, bet_type: "cash" }, false), -100);
  assert.equal(originalBetResult({ stake: 250, american: 2100, bet_type: "cash" }, true), 5250);
}

// ── worker compatibility (combo-worker engine.js cash formula) ──
{
  const a = cash100();
  const b = cash250();
  assert.equal(bindingCap(a).effectiveCap, 2079);
  assert.equal(bindingCap(b).effectiveCap, 5500);

  const plan = buildMergePlan({ survivor: a, absorb: [b], fills: [], now: NOW, batchId: "batch-cash" });
  assert.equal(plan.ok, true);
  assert.equal(plan.encoded.parlay_stake, 350);
  assert.equal(plan.encoded.is_free_bet, false);
  assert.equal(plan.afterCap, 7579);
  assert.equal(plan.beforeCaps[0].cap + plan.beforeCaps[1].cap, 7579);

  const merged = workerCashPosition({
    stake: plan.encoded.parlay_stake,
    american: plan.encoded.parlay_american,
    fillAmerican: a.fill_american,
    mode: "1x",
    maxContracts: plan.encoded.max_contracts,
  });
  assert.equal(merged.effectiveCap, 7579);
  assert.equal(merged.perFillCap, 7579);
  assert.ok(Math.abs(merged.bookHit - 7229) < 0.02, `bookHit ${merged.bookHit}`);
  assert.ok(Math.abs(merged.bookMiss - (-350)) < 0.02, `bookMiss ${merged.bookMiss}`);
  assert.ok(Math.abs(merged.hit - merged.miss) < 0.05, `lock target ${merged.hit} vs ${merged.miss}`);

  // An RFQ neither original cap can take fits the merged cap.
  assert.ok(6000 > bindingCap(a).effectiveCap);
  assert.ok(6000 > bindingCap(b).effectiveCap);
  assert.ok(6000 <= merged.effectiveCap);
}

{
  const cash = cash250();
  const free = free100();
  free.created_at = "2026-09-26T18:00:00Z";
  cash.created_at = "2026-09-27T18:00:00Z";
  const plan = buildMergePlan({
    survivor: free,
    absorb: [cash],
    now: NOW,
    batchId: "batch-hybrid",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.economics.totalAtRisk, 250);
  assert.equal(plan.economics.totalProfit, 7229);
  assert.equal(plan.economics.displayAmerican, 2892);
  assert.equal(plan.encoded.is_free_bet, false);
  assert.equal(plan.encoded.parlay_stake, 250);
  const merged = workerCashPosition({
    stake: plan.encoded.parlay_stake,
    american: plan.encoded.parlay_american,
    fillAmerican: free.fill_american,
    mode: "1x",
    maxContracts: plan.encoded.max_contracts,
  });
  assert.equal(merged.effectiveCap, 7479);
  assert.ok(Math.abs(merged.bookHit - 7229) < 0.02);
  assert.ok(Math.abs(merged.bookMiss - (-250)) < 0.02);
  assert.equal(plan.encoded.bet_type, "hybrid");
  // Binding ceilings (max_contracts) add up to the merged cap.
  assert.equal(bindingCap(cash).effectiveCap + bindingCap(free).effectiveCap, 7479);
  // The worker's own cash formula on the free bet counts the $100 face as risk (2079).
  // Summing those naive caps (5500+2079) is 100 contracts too big.
  assert.equal(bindingCap(cash).perFillCap + bindingCap(free).perFillCap, 7579);
  assert.notEqual(bindingCap(cash).perFillCap + bindingCap(free).perFillCap, merged.effectiveCap);
}

{
  const econ = mergeEconomics([
    { stake: 100, american: 1979, bet_type: "free" },
    { stake: 50, american: 1000, bet_type: "free" },
  ]);
  const encoded = encodeMergedParlay(econ, { fillAmerican: FILL, hedgeMode: "1x" });
  assert.equal(encoded.is_free_bet, true);
  assert.equal(encoded.parlay_stake, 150);
  assert.equal(encoded.max_contracts, 2479);
  const worker = workerCashPosition({
    stake: encoded.parlay_stake,
    american: encoded.parlay_american,
    fillAmerican: FILL,
    mode: "1x",
    maxContracts: encoded.max_contracts,
  });
  // Worker cash formula wants stake+profit. max_contracts (profit) is what it will sell.
  assert.equal(worker.perFillCap, 2629);
  assert.equal(worker.effectiveCap, 2479);
  assert.ok(Math.abs(worker.bookHit - 2479) < 0.02);
  assert.ok(Math.abs(worker.bookMiss - (-150)) < 0.02);
}

// ── merged order uses total risk and total profit in every hedge mode ──
{
  const econ = mergeEconomics([
    { stake: 40, american: 1500, bet_type: "cash" },
    { stake: 60, american: 2500, bet_type: "cash" },
  ]);
  assert.equal(econ.totalAtRisk, 100);
  assert.equal(econ.totalProfit, 2100);
  const fill = 1200;
  const y = 100 / (fill + 100);
  const expected = {
    riskfree: Math.ceil(econ.totalAtRisk / y),
    "1x": Math.round(econ.totalProfit + econ.totalAtRisk),
    riskfree_open: Math.floor(econ.totalProfit / (1 - y) + 1e-9),
    "2x": Math.round(2 * (econ.totalProfit + econ.totalAtRisk)),
    "3x": Math.round(3 * (econ.totalProfit + econ.totalAtRisk)),
  };
  assert.equal(expected.riskfree, 1300);
  assert.equal(expected["1x"], 2200);
  assert.equal(expected.riskfree_open, 2275);
  for (const mode of Object.keys(expected)) {
    const encoded = encodeMergedParlay(econ, { fillAmerican: fill, hedgeMode: mode });
    assert.equal(encoded.max_contracts, expected[mode], mode);
    assert.equal(encoded.hedge_mode, mode);
    assert.equal(encoded.parlay_stake, 100);
  }
  // Same totals passed straight in, not recomputed from one leg's odds.
  assert.equal(hedgeCap({
    stake: 1,
    boostAmerican: 100,
    fillAmerican: fill,
    mode: "riskfree_open",
    profit: econ.totalProfit,
    atRisk: econ.totalAtRisk,
  }), expected.riskfree_open);

  const open = encodeMergedParlay(econ, { fillAmerican: fill, hedgeMode: "riskfree_open" });
  const worker = workerCashPosition({
    stake: open.parlay_stake,
    american: open.parlay_american,
    fillAmerican: fill,
    mode: open.hedge_mode,
    maxContracts: open.max_contracts,
  });
  // Current worker does not know riskfree_open, so its per-fill cap stays 1× (2,200)
  // even though max_contracts is the larger floored size (2,275).
  assert.equal(worker.perFillCap, 2200);
  assert.equal(worker.ceiling, 2275);
  assert.equal(worker.effectiveCap, 2200);
  assert.ok(worker.effectiveCap < open.max_contracts);
}

// ── duplicate detection ──
{
  const a = cash100();
  const b = cash250();
  assert.equal(legSignature(a), legSignature({ legs: [pit, lv, cle] }));
  assert.notEqual(legSignature([cle, lv, pitLine(3)]), legSignature([cle, lv, pitLine(7)]));
  assert.notEqual(legSignature([cle, lv, { ...pit, side: "no" }]), legSignature([cle, lv, pit]));

  const target = findMergeTarget([b, a], [pit, lv, cle], NOW);
  assert.equal(target.id, "a");
  assert.equal(duplicateWarning(a), "You already have CLE/LV/PIT ($100 at +1979). Merge into one order?");

  const groups = findDuplicateGroups([b, a], NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].survivor.id, "a");
  assert.equal(groups[0].others[0].id, "b");

  const lineMismatch = parlay("c", [cle, lv, pitLine(3)], {
    parlay_stake: 100,
    parlay_american: 1979,
    max_contracts: 100,
  });
  assert.equal(findMergeTarget([lineMismatch], [cle, lv, pitLine(7)], NOW), null);
  assert.equal(findDuplicateGroups([a, lineMismatch], NOW).length, 0);

  const archived = { ...b, archived_at: "2026-09-27T20:00:00Z" };
  assert.equal(findMergeTarget([archived], a.legs, NOW), null);
  const started = { ...a, starts_at: "2026-09-27T17:00:00Z" };
  assert.equal(gameHasStarted(started, NOW), true);
  assert.equal(findMergeTarget([started], a.legs, NOW), null);
  const tickerStarted = parlay("t", [
    leg("KXNFLGAME-26SEP261300CLEVLV-CLE", "yes", "CLE"),
    leg("KXNFLGAME-26SEP261300LVDAL-LV", "yes", "LV"),
  ], { parlay_stake: 10, parlay_american: 200, max_contracts: 30, starts_at: null });
  assert.equal(gameHasStarted(tickerStarted, NOW), true);
  assert.equal(isAbsorbedParlay({ merged_into_id: "a" }), true);
  assert.equal(findMergeTarget([{ ...b, merged_into_id: "a", archived_at: "2026-09-27T20:00:00Z" }], a.legs, NOW), null);
}

// ── hedge re-point + undo ──
{
  const a = cash100();
  const b = cash250();
  const fills = [
    { id: "fill-b", fill_id: "kalshi-1", parlay_id: "b", count: 400, order_id: "ord-1", raw: { trade_id: "t1" } },
    { id: "stub-b", fill_id: "ord-2", parlay_id: "b", count: 50, order_id: "ord-2", raw: { source: "live-runner" } },
  ];
  const matches = [
    { id: "m-a", rfq_id: "rfq-same", parlay_id: "a" },
    { id: "m-b-dup", rfq_id: "rfq-same", parlay_id: "b" },
    { id: "m-b", rfq_id: "rfq-only-b", parlay_id: "b" },
  ];
  const submissions = [{ id: "sub-b", parlay_id: "b", quote_id: "q1" }];
  const outcomes = [{ id: "out-b", parlay_id: "b", quote_id: "q1" }];
  const plan = buildMergePlan({
    survivor: a,
    absorb: [b],
    fills,
    matches,
    submissions,
    outcomes,
    now: NOW,
    batchId: "batch-1",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.archive[0].patch.merged_into_id, "a");
  assert.equal(plan.archive[0].patch.active, false);
  assert.deepEqual(plan.dropMatchIds, ["m-b-dup"]);
  const moved = plan.repoints.map((row) => `${row.table}:${row.id}`).sort();
  assert.deepEqual(moved, [
    "combo_fills:fill-b",
    "combo_fills:stub-b",
    "combo_matches:m-b",
    "combo_submissions:sub-b",
    "quote_outcomes:out-b",
  ]);
  assert.deepEqual(plan.batch.fill_ids, ["kalshi-1"]);
  assert.equal(plan.insertBets.length, 2);
  assert.ok(plan.insertBets.every((row) => row.created_in_batch));

  const fillsAfter = [
    { ...fills[0], parlay_id: "a" },
    { ...fills[1], parlay_id: "a" },
  ];
  assert.equal(undoStatus({ mergedAt: plan.batch.merged_at, fillIdsAtMerge: plan.batch.fill_ids, fills: fillsAfter }).ok, true);
  const later = fillsAfter.concat([{ id: "fill-new", fill_id: "kalshi-2", parlay_id: "a", count: 10, order_id: "ord-9", raw: { trade_id: "t2" } }]);
  const blocked = undoStatus({ mergedAt: plan.batch.merged_at, fillIdsAtMerge: plan.batch.fill_ids, fills: later });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, UNDO_FILL_REASON);

  const bets = plan.insertBets.map((row, i) => ({ ...row, id: `bet-${i}` }));
  const undo = buildUndoPlan({
    batch: plan.batch,
    survivor: { ...a, ...plan.survivorPatch },
    bets,
    moves: plan.moves,
    fills: fillsAfter,
    now: NOW,
  });
  assert.equal(undo.ok, true);
  assert.equal(undo.restore.find((row) => row.id === "a").patch.parlay_stake, 100);
  assert.equal(undo.restore.find((row) => row.id === "a").patch.parlay_american, 1979);
  assert.equal(undo.restore.find((row) => row.id === "b").patch.active, true);
  assert.equal(undo.restore.find((row) => row.id === "b").patch.merged_into_id, null);
  assert.equal(undo.restore.find((row) => row.id === "b").patch.archived_at, null);
  assert.ok(undo.repoints.some((row) => row.table === "combo_fills" && row.parlay_id === "b"));
  assert.deepEqual(undo.deleteBetIds, ["bet-0", "bet-1"]);

  const blockedPlan = buildUndoPlan({
    batch: plan.batch,
    survivor: { ...a, ...plan.survivorPatch },
    bets,
    moves: plan.moves,
    fills: later,
  });
  assert.equal(blockedPlan.ok, false);
  assert.match(blockedPlan.error, /fill landed after this merge/);
}

{
  const a = cash100();
  const plan = buildMergePlan({
    survivor: a,
    newBet: {
      stake: 250,
      american: 2100,
      kind: "cash",
      sportsbook: "DraftKings",
      fill: FILL,
      legs: [lv, pit, cle],
    },
    now: NOW,
    batchId: "batch-new",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.economics.totalAtRisk, 350);
  assert.equal(plan.insertBets.filter((row) => row.role === "new_bet").length, 1);
  const bets = plan.insertBets.map((row, i) => ({ ...row, id: `n-${i}` }));
  const undo = buildUndoPlan({
    batch: plan.batch,
    survivor: { ...a, ...plan.survivorPatch },
    bets,
    moves: [],
    fills: [],
    now: NOW,
  });
  assert.equal(undo.ok, true);
  assert.equal(undo.insertParlays.length, 1);
  assert.equal(undo.insertParlays[0].parlay_stake, 250);
  assert.equal(undo.insertParlays[0].parlay_american, 2100);
  assert.equal(undo.insertParlays[0].active, true);
  assert.equal(undo.insertParlays[0].legs.length, 3);
}

{
  const locks = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  assert.match(locks, /Keep separate/);
  assert.match(locks, /Merged from /);
  assert.match(locks, /Undo merge/);
  assert.match(locks, /sportsbook/);
  assert.match(locks, /boostPct/);
  assert.match(locks, /findMergeTarget/);
  assert.match(locks, /confirmMerge/);
}

console.log("comboMerge.test.js ok");
