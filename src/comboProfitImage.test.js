import assert from "node:assert/strict";
import { paintProfitImage, profitImageChartWidth } from "./comboProfitImage.js";
import { EV_DASH_PX, EV_STROKE_PX, PROFIT_DOT_PX, PROFIT_STROKE_PX, profitImageModel } from "./comboProfit.js";

function recorder() {
  const texts = [];
  const fills = [];
  const strokes = [];
  const arcs = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    lineCap: "butt",
    fillText(text) {
      texts.push(String(text));
      fills.push({ text: String(text), font: ctx.font, fill: String(ctx.fillStyle) });
    },
    measureText(text) { return { width: String(text).length * 12 }; },
  };
  ctx._dash = [];
  ctx.setLineDash = (d) => { ctx._dash = d ? Array.from(d) : []; };
  ctx.stroke = () => {
    strokes.push({ width: ctx.lineWidth, style: String(ctx.strokeStyle), dash: ctx._dash.slice() });
  };
  ctx.arc = (x, y, r) => { arcs.push(r); };
  for (const name of ["clearRect", "fillRect", "fill", "beginPath", "moveTo", "lineTo", "closePath", "arcTo", "rect", "save", "restore"]) {
    ctx[name] = () => {};
  }
  return { ctx, texts, fills, strokes, arcs };
}

{
  const model = profitImageModel({
    total: 35,
    count: 4,
    range: "all",
    points: [
      { id: "lock-secret", cumulative: 40, at: "2026-10-01T16:00:00Z" },
      { id: "lock-other", cumulative: -80, at: "2026-10-20T16:00:00Z" },
      { id: "lock-last", cumulative: 35, at: "2026-11-09T16:00:00Z" },
    ],
    emptyText: "should not show",
  });
  const { ctx, texts, fills, strokes, arcs } = recorder();
  paintProfitImage(ctx, { ...model, user: "person@example.com", email: "person@example.com" }, 1080, 760);
  const painted = texts.join("\n");
  const scale = profitImageChartWidth(1080) / 640;
  const gold = strokes.filter((s) => s.style === "#f5d76e");
  assert.ok(gold.length >= 1);
  assert.ok(gold.every((s) => Math.abs(s.width - PROFIT_STROKE_PX * scale) < 0.001));
  assert.ok(gold.every((s) => s.dash.length === 0));
  assert.ok(arcs.length >= 1);
  assert.ok(arcs.every((r) => Math.abs(r - PROFIT_DOT_PX * scale) < 0.001));
  const zero = fills.find((f) => f.text === "$0");
  assert.equal(zero.font, "500 16px Inter, system-ui, sans-serif");
  assert.equal(zero.fill, "#9aa3af");
  assert.match(painted, /Combo Locks/);
  assert.match(painted, /RUNNING PROFIT/);
  assert.match(painted, /\+\$35\.00/);
  assert.match(painted, /All time/);
  assert.match(painted, /aibetbuilder\.io/);
  assert.match(painted, /Oct 1/);
  assert.match(painted, /Nov 9/);
  assert.match(painted, /\$0/);
  assert.doesNotMatch(painted, /lock-secret|person@example\.com|@|Kevin Gordon|gmail/i);
}

{
  const model = profitImageModel({ count: 0, range: "30d", emptyText: "No settled locks in this range." });
  const { ctx, texts } = recorder();
  paintProfitImage(ctx, model, 1080, 760);
  const painted = texts.join("\n");
  assert.match(painted, /No settled locks in this range\./);
  assert.match(painted, /aibetbuilder\.io/);
  assert.match(painted, /—/);
  assert.doesNotMatch(painted, /@/);
}


{
  const model = profitImageModel({
    total: 35000,
    count: 8,
    range: "all",
    hasEv: true,
    evTotal: 28000,
    points: [
      { id: "a", cumulative: 5000, cumulativeEv: 4000, at: "2026-09-01T16:00:00Z" },
      { id: "b", cumulative: 12000, cumulativeEv: 9000, at: "2026-09-15T16:00:00Z" },
      { id: "c", cumulative: 20000, cumulativeEv: 15000, at: "2026-10-01T16:00:00Z" },
      { id: "d", cumulative: 26000, cumulativeEv: 20000, at: "2026-10-15T16:00:00Z" },
      { id: "e", cumulative: 35000, cumulativeEv: 28000, at: "2026-11-01T16:00:00Z" },
    ],
  });
  const { ctx, texts, strokes } = recorder();
  paintProfitImage(ctx, { ...model, email: "person@example.com", name: "Kevin Gordon" }, 1080, 760);
  const painted = texts.join("\n");
  const scale = profitImageChartWidth(1080) / 640;
  const ev = strokes.filter((s) => s.style === "#9ca3af" && s.dash.length);
  assert.ok(ev.length >= 1);
  assert.ok(ev.every((s) => Math.abs(s.width - EV_STROKE_PX * scale) < 0.001));
  assert.ok(ev.every((s) => s.dash[0] === EV_DASH_PX[0] * scale && s.dash[0] < 4));
  assert.match(painted, /Profit/);
  assert.match(painted, /\bEV\b/);
  assert.match(painted, /\$0/);
  assert.ok((painted.match(/Sep |Oct |Nov /g) || []).length >= 3, "share image paints several date ticks: " + painted);
  assert.doesNotMatch(painted, /person@example\.com|Kevin Gordon|@/);
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
      { id: "a", cumulative: 50, cumulativeEv: 50, at: "2026-09-05T16:00:00Z" },
      { id: "b", cumulative: 35, cumulativeEv: 40, at: "2026-09-11T16:00:00Z" },
    ],
  });
  const { ctx, texts } = recorder();
  paintProfitImage(ctx, { ...model, email: "person@example.com" }, 1080, 760);
  const painted = texts.join("\n");
  assert.match(painted, /EV \(1 of 2 locks\)/);
  assert.doesNotMatch(painted, /person@example\.com|@/);
}

console.log("comboProfitImage.test.js ok");
