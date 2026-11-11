import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EV_DASH_PX,
  EV_STROKE_PX,
  PROFIT_DOT_PX,
  PROFIT_IMAGE_FILENAME,
  PROFIT_STROKE_PX,
  axisDollars,
  cumulativeRealizedProfit,
  etWallToUtc,
  nearestProfitIndex,
  profitChartLayout,
  profitChartTimeDomain,
  profitChartXTicks,
  profitChartYTicks,
  profitImageCanCopy,
  profitImageCanShareFiles,
  profitImageModel,
  profitShareDelivery,
  profitTipBox,
  profitTipDollars,
  sampleProfitPoints,
  stepLine,
} from "./comboProfit.js";
import { buildComboStatement, filterStatementLines } from "./comboStatement.js";
import { etStamp, historyTotals } from "./comboLockView.js";

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
    "brand", "countText", "emptyText", "evLegend", "evNote", "evTotalText", "hasEv", "kicker", "points", "rangeLabel", "spanText", "title", "tone", "totalText",
  ]);
  assert.equal(model.hasEv, false);
  assert.equal(model.evTotalText, "");
  assert.equal(model.evLegend, "");
  assert.equal(model.evNote, "");
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
  const now = new Date("2026-09-12T16:00:00Z");
  const stmt = buildComboStatement({
    parlays: [
      { id: "won", label: "Won", parlay_stake: 100, parlay_american: 650, fill_american: 610, fair_american: 400, max_contracts: 750, kalshi_result: "no", created_at: "2026-09-04T00:00:00Z", settled_at: "2026-09-05T00:00:00Z", archived_at: "2026-09-05T00:00:00Z" },
      { id: "lost", label: "Lost", parlay_stake: 100, parlay_american: 650, fill_american: 610, fair_american: 400, max_contracts: 750, kalshi_result: "yes", created_at: "2026-09-10T00:00:00Z", settled_at: "2026-09-11T00:00:00Z", archived_at: "2026-09-11T00:00:00Z" },
    ],
  });
  // Unhedged $100 at +650, fair +400: P(hit)=0.2, EV = 0.2*650 + 0.8*(-100) = $50 each.
  assert.equal(stmt.lines[0].expectedPnl, 50);
  assert.equal(stmt.lines[1].expectedPnl, 50);
  const curve = cumulativeRealizedProfit(stmt.lines, { now });
  assert.equal(curve.hasEv, true);
  assert.equal(curve.evKnown, 2);
  assert.equal(curve.evLegend, "EV");
  assert.equal(curve.evNote, "");
  assert.equal(curve.evTotal, 100);
  assert.deepEqual(curve.points.map((p) => p.cumulativeEv), [50, 100]);
  const partial = cumulativeRealizedProfit(stmt.lines.map((l) => ({ ...l, expectedPnl: l.id === "lost" ? null : l.expectedPnl })), { now });
  assert.equal(partial.hasEv, true);
  assert.equal(partial.evKnown, 1);
  assert.equal(partial.evLegend, "EV (1 of 2 locks)");
  assert.match(partial.evNote, /realized/);
  const lost = partial.points.find((p) => p.id === "lost");
  const won = partial.points.find((p) => p.id === "won");
  assert.equal(won.ev, 50);
  assert.equal(lost.ev, null);
  assert.equal(lost.evFromRealized, true);
  assert.equal(lost.cumulativeEv, Math.round((won.ev + lost.pnl) * 100) / 100);
}

{
  const emptyFair = buildComboStatement({
    parlays: [
      { id: "won", label: "Won", parlay_stake: 100, parlay_american: 650, fill_american: 610, max_contracts: 750, kalshi_result: "no", created_at: "2026-09-04T00:00:00Z", settled_at: "2026-09-05T00:00:00Z", archived_at: "2026-09-05T00:00:00Z" },
    ],
  });
  assert.equal(emptyFair.lines[0].expectedPnl, null);
  assert.equal(cumulativeRealizedProfit(emptyFair.lines).hasEv, false);
}

{
  assert.equal(axisDollars(0), "$0");
  assert.equal(axisDollars(10000), "$10k");
  assert.equal(axisDollars(20000), "$20k");
  assert.equal(axisDollars(-10000), "-$10k");
  assert.equal(axisDollars(2500), "$2.5k");
  assert.equal(axisDollars(62_000), "$62k");
  const y = profitChartYTicks(0, 62000);
  assert.ok(y.ticks.includes(0));
  assert.ok(y.ticks.length >= 5 && y.ticks.length <= 8, "y ticks " + y.ticks);
  assert.ok(y.ticks.every((t, i) => i === 0 || t > y.ticks[i - 1]));
  const neg = profitChartYTicks(-25000, 10000);
  assert.ok(neg.ticks.includes(0));
  assert.ok(neg.ticks[0] < 0);
  assert.ok(neg.ticks[neg.ticks.length - 1] > 0);
}

{
  // 12:00 PM EDT on Sep 12, 2026 = 16:00Z; midnight ET is 04:00Z.
  assert.equal(etWallToUtc(2026, 9, 12, 0, 0), Date.parse("2026-09-12T04:00:00Z"));
  assert.equal(etWallToUtc(2026, 11, 11, 0, 0), Date.parse("2026-11-11T05:00:00Z"));
  const now = new Date("2026-09-12T16:00:00Z");
  const today = profitChartTimeDomain(
    [{ at: "2026-09-12T15:00:00Z", cumulative: 25 }],
    { range: "today", now },
  );
  assert.equal(today.t0, Date.parse("2026-09-12T04:00:00Z"));
  assert.equal(today.t1, now.getTime());
  const hours = profitChartXTicks(today.t0, today.t1, "today");
  assert.ok(hours.length >= 5 && hours.length <= 8, "today ticks " + hours.map((t) => t.text).join(","));
  assert.ok(hours.every((t) => /AM|PM/.test(t.text)));
  const week = profitChartTimeDomain(
    [{ at: "2026-09-08T15:00:00Z", cumulative: 10 }, { at: "2026-09-12T15:00:00Z", cumulative: 42 }],
    { range: "7d", now },
  );
  const days = profitChartXTicks(week.t0, week.t1, "7d");
  assert.ok(days.length >= 5 && days.length <= 8, "7d ticks " + days.map((t) => t.text).join(","));
  assert.ok(days.every((t) => !/AM|PM/.test(t.text)));
  const month = profitChartXTicks(
    Date.parse("2026-08-13T16:00:00Z"),
    Date.parse("2026-09-12T16:00:00Z"),
    "30d",
  );
  assert.ok(month.length >= 5 && month.length <= 8, "30d ticks " + month.map((t) => t.text).join(","));
}

{
  const now = new Date("2026-11-10T17:00:00Z");
  const points = [];
  for (let d = 1; d <= 20; d++) {
    const day = String(d).padStart(2, "0");
    points.push({
      at: `2026-10-${day}T16:00:00Z`,
      cumulative: d * 3000,
      ev: 2000,
      cumulativeEv: d * 2000,
    });
  }
  const layout = profitChartLayout(points, { range: "all", now, height: 128 });
  assert.ok(layout.yTicks.length >= 5, "y tick count " + layout.yTicks.length);
  assert.ok(layout.yTicks.some((t) => t.zero && t.text === "$0"));
  assert.ok(layout.yTicks.some((t) => /k/.test(t.text)));
  assert.ok(layout.xTicks.length >= 5 && layout.xTicks.length <= 8, "x ticks " + layout.xTicks.map((t) => t.text).join(","));
  assert.equal(layout.hasEv, true);
  assert.ok(layout.evLine.length >= 2);
  assert.equal(layout.height, 128);
  assert.ok(!JSON.stringify(layout.labels).includes("+62") && !layout.yTicks.some((t) => t.text.startsWith("+$")), "no +$ overlay on the plot");
  const evOff = profitChartLayout(points.map((p) => ({ ...p, cumulativeEv: null })), { range: "all" });
  assert.equal(evOff.hasEv, false);
  assert.deepEqual(evOff.evLine, []);
}

{
  const model = profitImageModel({
    total: 35000,
    count: 4,
    range: "all",
    hasEv: true,
    evTotal: 28000,
    points: [
      { cumulative: 10000, cumulativeEv: 8000, at: "2026-10-01T16:00:00Z" },
      { cumulative: 35000, cumulativeEv: 28000, at: "2026-11-09T16:00:00Z" },
    ],
  });
  assert.equal(model.hasEv, true);
  assert.equal(model.evTotalText, "+$28,000.00");
  assert.doesNotMatch(JSON.stringify(model), /@|Kevin|gmail/i);
}



{
  const line = stepLine(
    [{ x: 10, y: 80 }, { x: 40, y: 20 }, { x: 70, y: 40 }],
    { x: 0, y: 100 },
  );
  // origin -> horizontal to first x -> vertical to first y -> horizontal -> vertical ...
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    assert.ok(a.x === b.x || a.y === b.y, "step segments are axis-aligned");
  }
  assert.deepEqual(line, [
    { x: 0, y: 100 },
    { x: 10, y: 100 },
    { x: 10, y: 80 },
    { x: 40, y: 80 },
    { x: 40, y: 20 },
    { x: 70, y: 20 },
    { x: 70, y: 40 },
  ]);
}

{
  const many = [];
  for (let i = 0; i < 1144; i++) {
    many.push({ id: "p" + i, at: "2026-01-01T00:00:00Z", cumulative: i + 1, cumulativeEv: i });
  }
  assert.equal(sampleProfitPoints(many).length, 1144, "default cap keeps every settlement at Kevin's scale");
  const layout = profitChartLayout(many, { range: "all" });
  for (let i = 1; i < layout.line.length; i++) {
    const a = layout.line[i - 1], b = layout.line[i];
    assert.ok(a.x === b.x || a.y === b.y, "profit path is a step line");
  }
  assert.equal(layout.samples.length, 1144);
  assert.equal(layout.axisY, layout.height - layout.padB);
  assert.ok(layout.xTick >= 3 && layout.xTick < layout.padB);
  assert.equal(nearestProfitIndex(layout.samples, layout.samples[800].x), 800);
  assert.equal(nearestProfitIndex(layout.samples, layout.samples[0].x - 20), 0);
  assert.equal(nearestProfitIndex(layout.samples, layout.samples[1143].x + 20), 1143);
}

{
  const model = profitImageModel({
    total: 35,
    count: 2,
    range: "all",
    hasEv: true,
    evKnown: 1,
    evLegend: "EV (1 of 2 locks)",
    evNote: "Locks without fair odds use their realized P/L so the lines stay comparable.",
    evTotal: 40,
    points: [
      { cumulative: 50, cumulativeEv: 50, ev: 50, at: "2026-09-05T00:00:00Z" },
      { cumulative: 35, cumulativeEv: 40, ev: null, evFromRealized: true, at: "2026-09-11T00:00:00Z" },
    ],
  });
  assert.equal(model.hasEv, true);
  assert.equal(model.evLegend, "EV (1 of 2 locks)");
  assert.match(model.evNote, /realized/);
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
  const svgFn = viewSrc.slice(viewSrc.indexOf("function ProfitSvg"), viewSrc.indexOf("export function ComboProfitChart"));
  assert.doesNotMatch(svgFn, /useState/, "hover updates the crosshair in place");
  assert.match(svgFn, /nearestProfitIndex/);
  assert.match(svgFn, /onPointerLeave/);
  assert.match(svgFn, /pointerType === "touch"/);
  assert.match(svgFn, /etStamp/);
  assert.match(svgFn, /profitTipDollars/);
  assert.match(svgFn, /profitTipBox/);
  assert.match(svgFn, /vectorEffect="non-scaling-stroke"/);
  assert.match(svgFn, /PROFIT_STROKE_PX/);
  assert.match(svgFn, /EV_STROKE_PX/);
  assert.doesNotMatch(svgFn, /strokeDasharray="4 3"/);
  assert.doesNotMatch(svgFn, /strokeWidth="2"/);
  assert.match(viewSrc, /fontSize="9"/);
  assert.doesNotMatch(imageSrc, /tooltip|crosshair|pointermove|clientX|email|displayName/);
  assert.match(viewSrc, /import\("\.\/comboProfitImage\.js"\)/);
  assert.doesNotMatch(viewSrc, /import\s*\{[^}]*\}\s*from\s*"\.\/comboProfitImage\.js"/);
  assert.match(viewSrc, /new Clip\(\{ "image\/png": blobPromise \}\)/);
  assert.match(locksSrc, /<ComboProfitChart lines=\{historyStatement\.lines\} \/>/);
  const chartAt = locksSrc.indexOf("<ComboProfitChart");
  const histAt = locksSrc.indexOf("<ComboHistory");
  assert.ok(chartAt > 0 && histAt > chartAt, "chart sits above History");
}

{
  assert.equal(profitTipDollars(54210), "+$54,210");
  assert.equal(profitTipDollars(-1200), "-$1,200");
  assert.equal(profitTipDollars(0), "+$0");
  assert.equal(profitTipDollars(61827.16), "+$61,827.16");
  assert.equal(profitTipDollars(-0.5), "-$0.50");
  assert.equal(profitTipDollars("nope"), "—");
  assert.equal(etStamp("2026-11-09T02:42:00Z"), "Nov 8, 9:42 PM ET");
  assert.equal(PROFIT_STROKE_PX, 1.5);
  assert.equal(EV_STROKE_PX, 1.25);
  assert.deepEqual(EV_DASH_PX, [2, 2]);
  assert.ok(PROFIT_DOT_PX <= 2.5);
}

{
  const right = profitTipBox({ boxW: 400, boxH: 120, anchorX: 360, anchorY: 40, tipW: 120, tipH: 48 });
  assert.ok(right.left + 120 <= 400 - 4, "tooltip stays inside the right edge");
  assert.ok(right.left < 360, "tooltip flips left of a right-edge anchor");
  const top = profitTipBox({ boxW: 400, boxH: 120, anchorX: 80, anchorY: 6, tipW: 100, tipH: 40 });
  assert.ok(top.top >= 4, "tooltip stays inside the top edge");
  const bottom = profitTipBox({ boxW: 400, boxH: 120, anchorX: 80, anchorY: 110, tipW: 100, tipH: 40 });
  assert.ok(bottom.top + 40 <= 120 - 4, "tooltip stays inside the bottom edge");
  const left = profitTipBox({ boxW: 400, boxH: 120, anchorX: 4, anchorY: 60, tipW: 100, tipH: 36 });
  assert.ok(left.left >= 4);
  assert.equal(nearestProfitIndex([], 10), -1);
  assert.equal(nearestProfitIndex([{ x: 5 }], NaN), -1);
}

{
  const samples = [];
  for (let i = 0; i < 1144; i++) samples.push({ x: i * 0.5 });
  let reads = 0;
  const proxied = new Proxy(samples, {
    get(target, prop) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) reads += 1;
      return target[prop];
    },
  });
  const idx = nearestProfitIndex(proxied, 400.2);
  assert.equal(idx, 800);
  assert.ok(reads < 40, "binary search reads " + reads);
  const mid = (samples[10].x + samples[11].x) / 2;
  const tied = nearestProfitIndex(samples, mid);
  assert.equal(tied, 10, "an exact midpoint snaps to the earlier settlement");
}

console.log("comboProfit.test.js ok");
