import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyStatementFilters,
  buildComboStatement,
  formatStatementPnl,
} from "./comboStatement.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const board = fs.readFileSync(path.join(dir, "StatementBoard.jsx"), "utf8");
const locks = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
const locksView = fs.readFileSync(path.join(dir, "ComboLocksView.jsx"), "utf8");
const profile = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");

assert.match(board, /export function useStatementView/);
assert.match(board, /export function StatementFilters/);
assert.match(board, /export function StatementSummary/);
assert.match(board, /export function StatementLines/);
assert.match(board, /export function downloadStatementCsv/);
assert.match(board, /STATEMENT_DATE_FILTERS/);
assert.match(board, /STATEMENT_KIND_FILTERS/);
assert.match(board, /STATEMENT_RESULT_FILTERS/);
assert.match(board, /Search locks or teams/);
assert.match(board, /Realized/);
assert.match(board, /Locked fills/);
assert.match(board, /Unfilled \(risk profile\)/);
assert.match(board, /Open lock/);
assert.match(board, /Hide lock/);
assert.match(board, /stmt-row/);
assert.match(board, /stmt-sub/);
assert.match(board, /stmt-cards/);
assert.match(board, /@media \(max-width:720px\)\{\.sb \.stmt-cards\{grid-template-columns:1fr\}\}/);
assert.match(board, /id=\{\"lock-\" \+ line\.id\}/);
assert.match(board, /setSearchQuery\(searchInput\), 150/);

assert.match(profile, /<StatementBoard/);
assert.match(profile, /useStatementView\(statement\)/);
assert.match(profile, /P\/L statement/);
assert.doesNotMatch(profile, /STATEMENT_DATE_FILTERS\.map/);

// Combo Locks History uses its own plain table (ComboHistory) over the same
// statement lines + useStatementView filters; Profile keeps StatementBoard.
assert.match(locks, /<ComboHistory/);
assert.doesNotMatch(locks, /<StatementBoard/);
assert.match(locks, /buildComboStatement/);
assert.match(locks, /parlays: archived/);
assert.match(locks, /useStatementView\(historyStatement\)/);
assert.match(locks, /title="History"/);
assert.match(locksView, /aria-label="History filters"/);
assert.match(locksView, /Date \(ET\)/);
assert.match(locksView, /Net profit \/ loss/);
assert.match(locksView, /id=\{"lock-" \+ line\.id\}/);
assert.match(locks, /<QuoteHistory history=\{quoteHistory\(attemptsByParlay\[a\.id\], \{ parlay: a \}\)\}/);
assert.match(locksView, /<th>Fair odds<\/th>/);
assert.match(locksView, /<td colSpan=\{8\}>/);
assert.match(locksView, /<LockCard|export function LockCard/);
assert.match(locksView, /betSummary\(parlay\)/);
assert.doesNotMatch(locks, /archived \{a\.archived_at/);
assert.doesNotMatch(locks, /History — every attempt[\s\S]*archived\.map/);

{
  const stmt = buildComboStatement({
    parlays: [
      {
        id: "won",
        label: "Royals ML + Twins ML",
        parlay_stake: 100,
        parlay_american: 650,
        fill_american: 610,
        max_contracts: 750,
        kalshi_result: "no",
        created_at: "2026-09-12T16:00:00Z",
        settled_at: "2026-09-12T20:00:00Z",
        archived_at: "2026-09-12T21:00:00Z",
        legs: [{ ticker: "KXMLBGAME-26SEP12KCMIN-KC", label: "Royals ML" }],
      },
      {
        id: "lost",
        label: "Giants ML + Orioles ML",
        parlay_stake: 100,
        parlay_american: 400,
        fill_american: 380,
        max_contracts: 500,
        kalshi_result: "yes",
        created_at: "2026-09-12T16:00:00Z",
        settled_at: "2026-09-12T20:00:00Z",
        archived_at: "2026-09-12T21:00:00Z",
      },
    ],
  });
  assert.equal(stmt.lines.length, 2);
  assert.equal(stmt.lines.find((l) => l.id === "won").resultFilter, "won");
  assert.equal(stmt.lines.find((l) => l.id === "lost").resultFilter, "lost");
  assert.equal(formatStatementPnl(stmt.lines.find((l) => l.id === "won").pnl), "-$100.00");
  const won = applyStatementFilters(stmt, { result: "won" });
  assert.deepEqual(won.lines.map((l) => l.id), ["won"]);
  const lost = applyStatementFilters(stmt, { result: "lost" });
  assert.deepEqual(lost.lines.map((l) => l.id), ["lost"]);
  assert.match(stmt.lines[0].dateCopy, /settled/);
}

console.log("statementBoard.test.js ok");
