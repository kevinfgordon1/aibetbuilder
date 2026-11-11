import assert from "node:assert/strict";
import { paintProfitImage } from "./comboProfitImage.js";
import { profitImageModel } from "./comboProfit.js";

function recorder() {
  const texts = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    lineCap: "butt",
    fillText(text) { texts.push(String(text)); },
    measureText(text) { return { width: String(text).length * 12 }; },
  };
  ctx.setLineDash = () => {};
  for (const name of ["clearRect", "fillRect", "fill", "stroke", "beginPath", "moveTo", "lineTo", "closePath", "arc", "arcTo", "rect", "save", "restore"]) {
    ctx[name] = () => {};
  }
  return { ctx, texts };
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
  const { ctx, texts } = recorder();
  paintProfitImage(ctx, { ...model, user: "person@example.com", email: "person@example.com" }, 1080, 760);
  const painted = texts.join("\n");
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
  const { ctx, texts } = recorder();
  paintProfitImage(ctx, { ...model, email: "person@example.com", name: "Kevin Gordon" }, 1080, 760);
  const painted = texts.join("\n");
  assert.match(painted, /Profit/);
  assert.match(painted, /\bEV\b/);
  assert.match(painted, /\$0/);
  assert.ok((painted.match(/Sep |Oct |Nov /g) || []).length >= 3, "share image paints several date ticks: " + painted);
  assert.doesNotMatch(painted, /person@example\.com|Kevin Gordon|@/);
}

console.log("comboProfitImage.test.js ok");
