import assert from "node:assert/strict";
import {
  STATEMENT_DATE_FILTERS,
  STATEMENT_DEFAULT_DATE_RANGE,
  STATEMENT_KIND_FILTERS,
  STATEMENT_RESULT_FILTERS,
  applyStatementFilters,
  buildComboStatement,
  etYmd,
  filterStatementLines,
  formatStatementDate,
  formatStatementPnl,
  lockStatementLine,
  normalizeStatementDateRange,
  sportsFromParlay,
  statementCsv,
  statementCsvFilename,
  statementDateCopy,
  statementSportsPresent,
} from "./comboStatement.js";

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

assert.equal(STATEMENT_DEFAULT_DATE_RANGE, "all");
assert.deepEqual(STATEMENT_DATE_FILTERS.map((c) => c.key), ["today", "7d", "30d", "all"]);
assert.deepEqual(STATEMENT_KIND_FILTERS.map((c) => c.key), ["all", "locked_fill", "unfilled", "open"]);
assert.deepEqual(STATEMENT_RESULT_FILTERS.map((c) => c.key), ["all", "won", "lost", "pending", "would_have"]);
assert.equal(normalizeStatementDateRange("30d"), "30d");
assert.equal(normalizeStatementDateRange("month"), "30d");
assert.equal(normalizeStatementDateRange("nope"), "all");

{
  const olderSettled = lockStatementLine({
    parlay: {
      ...ariJax,
      id: "old",
      kalshi_result: "no",
      created_at: "2026-08-01T16:00:00Z",
      settled_at: "2026-09-05T16:00:00Z",
    },
    filled: 0,
  });
  const newerOpen = lockStatementLine({
    parlay: {
      ...ariJax,
      id: "open-new",
      label: "Open new",
      legs: [{}, {}],
      created_at: "2026-09-04T16:00:00Z",
    },
    filled: 0,
  });
  assert.equal(olderSettled.createdAt, "2026-08-01T16:00:00Z");
  assert.equal(olderSettled.settledAt, "2026-09-05T16:00:00Z");
  assert.equal(olderSettled.sortAt, "2026-09-05T16:00:00Z");
  assert.equal(olderSettled.kind, "unfilled");
  assert.equal(olderSettled.resultFilter, "won");
  assert.match(olderSettled.dateCopy, /settled/);
  assert.equal(newerOpen.kind, "open");
  assert.equal(newerOpen.resultFilter, "pending");
  assert.equal(newerOpen.settledAt, null);
  assert.equal(newerOpen.sortAt, "2026-09-04T16:00:00Z");
  assert.match(newerOpen.dateCopy, /still open/);
  const stmt = buildComboStatement({
    parlays: [
      { ...ariJax, id: "open-new", label: "Open new", legs: [{}, {}], created_at: "2026-09-04T16:00:00Z" },
      { ...ariJax, id: "old", kalshi_result: "no", created_at: "2026-08-01T16:00:00Z", settled_at: "2026-09-05T16:00:00Z" },
    ],
  });
  assert.equal(stmt.lines[0].id, "old");
  assert.equal(stmt.lines[1].id, "open-new");
}

{
  const won = lockStatementLine({ parlay: { ...ariJax, kalshi_result: "no" }, filled: 0 });
  const lost = lockStatementLine({ parlay: { ...ariJax, id: "lost", kalshi_result: "yes" }, filled: 0 });
  const would = lockStatementLine({
    parlay: { ...ariJax, id: "would", underlying_result: "lost", underlying_source: "espn" },
    filled: 0,
  });
  assert.equal(won.resultFilter, "won");
  assert.equal(lost.resultFilter, "lost");
  assert.equal(would.resultFilter, "would_have");
}

{
  const mixed = lockStatementLine({
    parlay: {
      ...ariJax,
      label: "Hawaii Rainbow Warriors ML + Texas Rangers ML",
      legs: [
        { ticker: "KXNCAAFGAME-26SEP05HAW-HAW", label: "Hawaii Rainbow Warriors ML", game: "Hawaii @ Wyoming" },
        { ticker: "KXMLBGAME-26SEP051900TEXLAA-TEX", label: "Texas Rangers ML", game: "Rangers @ Angels" },
      ],
    },
    filled: 0,
  });
  assert.deepEqual(mixed.sports, ["mlb", "ncaaf"]);
  assert.deepEqual(mixed.sportLabels, ["MLB", "NCAAF"]);
  assert.match(mixed.searchText, /hawaii/);
  assert.match(mixed.searchText, /rangers/);
  assert.deepEqual(sportsFromParlay({ legs: [{ sport: "americanfootball_nfl" }] }), ["nfl"]);
}

{
  const now = new Date("2026-09-05T20:00:00Z");
  const today = lockStatementLine({
    parlay: { ...ariJax, id: "today", kalshi_result: "no", created_at: "2026-09-01T16:00:00Z", settled_at: "2026-09-05T16:00:00Z" },
    filled: 0,
  });
  const lastWeek = lockStatementLine({
    parlay: { ...ariJax, id: "week", kalshi_result: "yes", created_at: "2026-08-30T16:00:00Z", settled_at: "2026-08-31T16:00:00Z" },
    filled: 0,
  });
  const lastMonth = lockStatementLine({
    parlay: { ...ariJax, id: "old", kalshi_result: "no", created_at: "2026-07-01T16:00:00Z", settled_at: "2026-07-02T16:00:00Z" },
    filled: 0,
  });
  const lines = [today, lastWeek, lastMonth];
  assert.deepEqual(filterStatementLines(lines, { dateRange: "today", now }).map((l) => l.id), ["today"]);
  assert.deepEqual(filterStatementLines(lines, { dateRange: "7d", now }).map((l) => l.id).sort(), ["today", "week"]);
  assert.equal(filterStatementLines(lines, { dateRange: "all", now }).length, 3);
}

{
  const stmt = buildComboStatement({
    parlays: [
      { ...ariJax, id: "a", kalshi_result: "no", created_at: "2026-09-04T16:00:00Z" },
      { ...ariJax, id: "b", label: "Filled", kalshi_result: "no", created_at: "2026-09-04T16:00:00Z" },
      { ...ariJax, id: "c", label: "Open", legs: [{ ticker: "KXNFLGAME-26SEP13ARILAC-ARI", label: "Cards ML" }, { ticker: "KXNFLGAME-26SEP13ARILAC-LAC", label: "Chargers ML" }], created_at: "2026-09-04T16:00:00Z" },
      { ...ariJax, id: "d", label: "Would", underlying_result: "won", underlying_source: "espn", created_at: "2026-09-04T16:00:00Z" },
    ],
    fillsById: { b: 750 },
  });
  const lockedOnly = applyStatementFilters(stmt, { kind: "locked_fill" });
  assert.equal(lockedOnly.lines.length, 1);
  assert.equal(lockedOnly.lines[0].id, "b");
  assert.equal(lockedOnly.lockedFills, 1);
  assert.equal(lockedOnly.unfilledSettled, 0);
  assert.ok(Math.abs(lockedOnly.realized - lockedOnly.lockedFillPnl) < 0.02);

  const openOnly = applyStatementFilters(stmt, { kind: "open" });
  assert.deepEqual(openOnly.lines.map((l) => l.id), ["c"]);
  assert.equal(openOnly.pending, 1);
  assert.equal(openOnly.realized, 0);

  const wouldOnly = applyStatementFilters(stmt, { result: "would_have" });
  assert.equal(wouldOnly.lines.length, 1);
  assert.equal(wouldOnly.lines[0].id, "d");

  const nfl = applyStatementFilters(stmt, { sport: "nfl" });
  assert.deepEqual(nfl.lines.map((l) => l.id), ["c"]);
  assert.deepEqual(statementSportsPresent(stmt.lines), ["nfl"]);

  const search = applyStatementFilters(stmt, { query: "cards" });
  assert.deepEqual(search.lines.map((l) => l.id), ["c"]);

  const csv = statementCsv(stmt.lines);
  assert.match(csv, /^title,kind,result,P\/L,created,settled,sport\n/);
  assert.match(csv, /Filled,locked fill,/);
  assert.match(csv, /Open,open,pending,,2026-09-04T16:00:00Z,,NFL/);
  assert.equal(statementCsvFilename(new Date("2026-09-05T20:00:00Z")), `combo-pl-statement-${etYmd("2026-09-05T20:00:00Z")}.csv`);
}

{
  const quoted = statementCsv([{
    label: "A, B",
    kindLabel: "open",
    resultLabel: "pending",
    pnl: null,
    createdAt: "2026-09-04T00:00:00Z",
    settledAt: "",
    sportLabels: ["MLB", "NFL"],
  }]);
  assert.match(quoted, /"A, B",open,pending,,2026-09-04T00:00:00Z,,MLB\+NFL/);
}

assert.equal(formatStatementDate("2026-09-04T16:00:00Z"), "Sep 4");
assert.match(statementDateCopy({ createdAt: "2026-09-04T16:00:00Z", settled: false }), /Sep 4 · still open/);
assert.match(statementDateCopy({
  createdAt: "2026-09-04T16:00:00Z",
  settledAt: "2026-09-05T16:00:00Z",
  settled: true,
}), /Sep 4 · settled Sep 5/);

console.log("comboStatement.test.js ok");
