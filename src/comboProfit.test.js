import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFIT_IMAGE_FILENAME,
  cumulativeRealizedProfit,
  profitChartLayout,
  profitImageCanCopy,
  profitImageCanShareFiles,
  profitImageModel,
  profitShareDelivery,
  sampleProfitPoints,
} from "./comboProfit.js";
import { buildComboStatement, filterStatementLines } from "./comboStatement.js";
import { historyTotals } from "./comboLockView.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function line({ id, pnl, settled = true, at }) {
  return {
    id,
    settled,
    pnl,
    settledAt: settled ? at : null,
    sortAt: at,
    createdAt: at,
    at,
  };
}

{
  const curve = cumulativeRealizedProfit([
    line({ id: "b", pnl: -40, at: "2026-09-06T00:00:00Z" }),
    line({ id: "a", pnl: 100, at: "2026-09-05T00:00:00Z" }),
    line({ id: "open", pnl: 999, settled: false, at: "2026-09-07T00:00:00Z" }),
    line({ id: "bad", pnl: "nope", at: "2026-09-08T00:00:00Z" }),
  ]);
  assert.deepEqual(curve.points.map((p) => p.id), ["a", "b"]);
  assert.deepEqual(curve.points.map((p) => p.cumulative), [100, 60]);
  assert.equal(curve.points[0].pnl, 100);
  assert.equal(curve.points[1].pnl, -40);
  assert.equal(curve.total, 60);
  assert.equal(curve.count, 2);
  assert.equal(curve.range, "all");
}

{
  const empty = cumulativeRealizedProfit([]);
  assert.deepEqual(empty.points, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.count, 0);
  assert.deepEqual(cumulativeRealizedProfit(null).points, []);
  assert.equal(cumulativeRealizedProfit([line({ id: "x", pnl: null, settled: false, at: "2026-09-01T00:00:00Z" })]).count, 0);
}

{
  const curve = cumulativeRealizedProfit([
    line({ id: "a", pnl: 0.1, at: "2026-09-01T00:00:00Z" }),
    line({ id: "b", pnl: 0.2, at: "2026-09-02T00:00:00Z" }),
  ]);
  assert.equal(curve.total, 0.3);
  assert.equal(curve.points[1].cumulative, 0.3);
}

{
  const curve = cumulativeRealizedProfit([
    line({ id: "b", pnl: 2, at: "2026-09-02T00:00:00Z" }),
    line({ id: "a", pnl: 1, at: "2026-09-02T00:00:00Z" }),
  ]);
  assert.deepEqual(curve.points.map((p) => p.id), ["a", "b"]);
  assert.equal(curve.points[1].cumulative, 3);
}

{
  const now = new Date("2026-09-12T16:00:00Z");
  const lines = [
    line({ id: "old", pnl: 50, at: "2026-08-01T00:00:00Z" }),
    line({ id: "week", pnl: 10, at: "2026-09-08T15:00:00Z" }),
    line({ id: "today", pnl: 25, at: "2026-09-12T15:00:00Z" }),
    line({ id: "yesterday", pnl: 7, at: "2026-09-11T15:00:00Z" }),
  ];
  const week = cumulativeRealizedProfit(lines, { dateRange: "7d", now });
  assert.deepEqual(week.points.map((p) => p.id), ["week", "yesterday", "today"]);
  assert.equal(week.total, 42);
  const today = cumulativeRealizedProfit(lines, { dateRange: "today", now });
  assert.deepEqual(today.points.map((p) => p.id), ["today"]);
  assert.equal(today.total, 25);
  assert.equal(cumulativeRealizedProfit(lines, { dateRange: "nope", now }).range, "all");
  assert.equal(cumulativeRealizedProfit(lines, { dateRange: "nope", now }).total, 92);
}

{
  const now = new Date("2026-09-12T16:00:00Z");
  const stmt = buildComboStatement({
    parlays: [
      { id: "won", label: "Won", parlay_stake: 100, parlay_american: 650, fill_american: 610, max_contracts: 750, kalshi_result: "no", created_at: "2026-09-04T00:00:00Z", settled_at: "2026-09-05T00:00:00Z", archived_at: "2026-09-05T00:00:00Z" },
      { id: "lost", label: "Lost", parlay_stake: 100, parlay_american: 650, fill_american: 610, max_contracts: 750, kalshi_result: "yes", created_at: "2026-09-10T00:00:00Z", settled_at: "2026-09-11T00:00:00Z", archived_at: "2026-09-11T00:00:00Z" },
      { id: "open", label: "Open", parlay_stake: 100, parlay_american: 650, fill_american: 610, legs: [{}, {}], created_at: "2026-09-12T00:00:00Z" },
    ],
  });
  const all = cumulativeRealizedProfit(stmt.lines, { now });
  assert.equal(all.total, historyTotals(stmt.lines).net);
  assert.equal(all.count, 2);
  assert.equal(all.points[0].id, "won");
  assert.equal(all.points[1].cumulative, all.total);
  const ranged = cumulativeRealizedProfit(stmt.lines, { dateRange: "7d", now });
  const filtered = filterStatementLines(stmt.lines, { dateRange: "7d", now });
  assert.equal(ranged.total, historyTotals(filtered).net);
  assert.ok(ranged.points.every((p) => p.id !== "open"));
}

{
  const many = [];
  for (let i = 0; i < 1000; i++) {
    many.push({ id: "p" + i, at: "2026-01-01T00:00:00Z", pnl: 1, cumulative: i + 1 });
  }
  const sampled = sampleProfitPoints(many, 360);
  assert.ok(sampled.length <= 360);
  assert.equal(sampled[0].id, "p0");
  assert.equal(sampled[sampled.length - 1].id, "p999");
  assert.equal(sampled[sampled.length - 1].cumulative, 1000);
  assert.equal(sampleProfitPoints(many.slice(0, 10), 360).length, 10);
  const spiked = [];
  for (let i = 0; i < 500; i++) spiked.push({ id: String(i), cumulative: i === 250 ? -500 : i });
  const thin = sampleProfitPoints(spiked, 40);
  assert.ok(thin.length <= 40);
  assert.equal(thin[0].id, "0");
  assert.equal(thin[thin.length - 1].id, "499");
  assert.ok(thin.some((p) => p.cumulative === -500));
}

{
  const layout = profitChartLayout([
    { cumulative: 10, at: "2026-09-01T00:00:00Z" },
    { cumulative: 30, at: "2026-09-02T00:00:00Z" },
  ]);
  assert.ok(layout.line.length >= 3);
  assert.ok(layout.end.y < layout.line[1].y, "a higher profit sits higher on the chart");
  assert.equal(profitChartLayout([]), null);
}

{
  const model = profitImageModel({
    total: 35,
    count: 4,
    range: "all",
    points: [
      { id: "lock-secret", cumulative: 40, at: "2026-10-01T16:00:00Z" },
      { id: "lock-other", cumulative: 35, at: "2026-11-09T16:00:00Z" },
    ],
  });
  assert.deepEqual(Object.keys(model).sort(), [
    "brand", "countText", "emptyText", "kicker", "points", "rangeLabel", "spanText", "title", "tone", "totalText",
  ]);
  assert.equal(model.totalText, "+$35.00");
  assert.equal(model.tone, "pos");
  assert.equal(model.rangeLabel, "All time");
  assert.equal(model.brand, "aibetbuilder.io");
  assert.equal(model.countText, "4 settled locks");
  assert.equal(model.spanText, "Oct 1 – Nov 9");
  assert.equal(model.emptyText, "");
  const dumped = JSON.stringify(model);
  assert.doesNotMatch(dumped, /@/);
  assert.equal(profitImageModel({ total: -12.5, count: 1, range: "7d", points: [{ cumulative: -12.5, at: "2026-11-09T16:00:00Z" }] }).tone, "neg");
  assert.equal(profitImageModel({ total: -12.5, count: 1, range: "7d", points: [{ at: "2026-11-09T16:00:00Z" }] }).rangeLabel, "Last 7 days");
  const empty = profitImageModel({ count: 0, range: "today", emptyText: "No settled locks in this range." });
  assert.equal(empty.totalText, "—");
  assert.equal(empty.emptyText, "No settled locks in this range.");
  assert.deepEqual(empty.points, []);
}

{
  assert.equal(profitShareDelivery(true), "share");
  assert.equal(profitShareDelivery(false), "download");
  assert.equal(PROFIT_IMAGE_FILENAME, "combo-locks-running-profit.png");
  assert.doesNotMatch(PROFIT_IMAGE_FILENAME, /@/);
  const file = { name: PROFIT_IMAGE_FILENAME };
  assert.equal(profitImageCanShareFiles(null, { canShare() { return true; } }), false);
  assert.equal(profitImageCanShareFiles(file, { canShare(data) { return data.files.length === 1; } }), true);
  assert.equal(profitImageCanShareFiles(file, { canShare() { throw new Error("unsupported"); } }), false);
  assert.equal(profitImageCanShareFiles(file, {}), false);
  assert.equal(profitImageCanCopy({ clipboard: { write() {} } }, function ClipboardItem() {}), true);
  assert.equal(profitImageCanCopy({ clipboard: {} }, function ClipboardItem() {}), false);
  assert.equal(profitImageCanCopy(null, function ClipboardItem() {}), false);
}

{
  const profitSrc = fs.readFileSync(path.join(dir, "comboProfit.js"), "utf8");
  const imageSrc = fs.readFileSync(path.join(dir, "comboProfitImage.js"), "utf8");
  const locksSrc = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  const viewSrc = fs.readFileSync(path.join(dir, "ComboLocksView.jsx"), "utf8");
  assert.doesNotMatch(profitSrc, /supabase|fetch\(/);
  assert.doesNotMatch(imageSrc, /supabase|user_id|displayName|email/);
  assert.match(imageSrc, /Combo Locks running profit/);
  assert.match(imageSrc, /aibetbuilder\.io/);
  assert.match(viewSrc, /export function ComboProfitChart/);
  assert.match(viewSrc, />Share image</);
  assert.match(viewSrc, />Copy image</);
  assert.match(viewSrc, /import\("\.\/comboProfitImage\.js"\)/);
  assert.doesNotMatch(viewSrc, /import\s*\{[^}]*\}\s*from\s*"\.\/comboProfitImage\.js"/);
  assert.match(viewSrc, /new Clip\(\{ "image\/png": blobPromise \}\)/);
  assert.match(locksSrc, /<ComboProfitChart lines=\{historyStatement\.lines\} \/>/);
  const chartAt = locksSrc.indexOf("<ComboProfitChart");
  const histAt = locksSrc.indexOf("<ComboHistory");
  assert.ok(chartAt > 0 && histAt > chartAt, "chart sits above History");
}

console.log("comboProfit.test.js ok");
