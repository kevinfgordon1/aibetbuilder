import assert from "node:assert/strict";
import { lockStatementLine, buildComboStatement, formatStatementPnl } from "./comboStatement.js";

const ariJax = {
  id: "ari-jax",
  label: "Ari + Jax",
  parlay_stake: 100,
  parlay_american: 650,
  fill_american: 610,
  fair_american: 600,
  max_contracts: 750,
  hedge_mode: "1x",
  created_at: "2026-09-04T00:00:00Z",
};

{
  const unfilledLost = lockStatementLine({
    parlay: { ...ariJax, kalshi_result: "yes" },
    filled: 0,
  });
  assert.equal(unfilledLost.settled, true);
  assert.equal(unfilledLost.bucket, "unfilled");
  assert.equal(unfilledLost.pnl, 650);
  assert.match(unfilledLost.resultLabel, /parlay won/);
}

{
  const unfilledWon = lockStatementLine({
    parlay: { ...ariJax, kalshi_result: "no" },
    filled: 0,
  });
  assert.equal(unfilledWon.bucket, "unfilled");
  assert.equal(unfilledWon.pnl, -100);
}

{
  const underlyingLost = lockStatementLine({
    parlay: { ...ariJax, underlying_result: "lost", underlying_source: "espn" },
    filled: 0,
  });
  assert.equal(underlyingLost.bucket, "unfilled");
  assert.equal(underlyingLost.pnl, -100);
  assert.equal(underlyingLost.resultLabel, "would-have-lost");
  assert.equal(underlyingLost.source, "espn");
}

{
  const locked = lockStatementLine({
    parlay: { ...ariJax, kalshi_result: "no" },
    filled: 750,
  });
  assert.equal(locked.bucket, "locked_fill");
  assert.ok(Math.abs(locked.pnl - 5.63) < 0.02, `locked pnl ${locked.pnl}`);
}

{
  const pending = lockStatementLine({
    parlay: { ...ariJax, legs: [{}, {}] },
    filled: 0,
  });
  assert.equal(pending.settled, false);
  assert.equal(pending.bucket, "pending");
  assert.equal(pending.pnl, null);
}

{
  const stmt = buildComboStatement({
    parlays: [
      { ...ariJax, id: "a", kalshi_result: "no", archived_at: "2026-09-05T00:00:00Z" },
      { ...ariJax, id: "b", label: "Filled", kalshi_result: "no", archived_at: "2026-09-06T00:00:00Z" },
      { ...ariJax, id: "c", label: "Open", legs: [{}, {}] },
    ],
    fillsById: { b: 750 },
  });
  assert.equal(stmt.unfilledSettled, 1);
  assert.equal(stmt.lockedFills, 1);
  assert.equal(stmt.pending, 1);
  assert.ok(Math.abs(stmt.unfilledPnl - (-100)) < 0.02);
  assert.ok(Math.abs(stmt.lockedFillPnl - 5.63) < 0.02);
  assert.ok(Math.abs(stmt.realized - (-94.37)) < 0.05);
  assert.equal(stmt.lines[0].id, "b");
}

assert.equal(formatStatementPnl(5.63), "+$5.63");
assert.equal(formatStatementPnl(-100), "-$100.00");
assert.equal(formatStatementPnl(null), "—");

console.log("comboStatement.test.js ok");
