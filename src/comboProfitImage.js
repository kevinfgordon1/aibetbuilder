// PNG of the Combo Locks running-profit card. Loaded only when someone taps
// Share image or Copy image. The picture is the title, total, date range,
// chart, and aibetbuilder.io — nothing that identifies an account.

import { PROFIT_IMAGE_FILENAME, profitChartLayout, profitImageCanShareFiles, profitShareDelivery } from "./comboProfit.js";

const W = 1080;
const H = 760;

function traceRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let yy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}


function rangeFromLabel(label) {
  if (label === "Today") return "today";
  if (label === "Last 7 days") return "7d";
  if (label === "Last 30 days") return "30d";
  return "all";
}

function strokePath(ctx, points, ox, oy) {
  if (!points || !points.length) return;
  ctx.beginPath();
  ctx.moveTo(ox + points[0].x, oy + points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(ox + points[i].x, oy + points[i].y);
}

function drawChart(ctx, points, ox, oy, w, h, { range = "all", hasEv = false } = {}) {
  const layout = profitChartLayout(points, { width: w, height: h, padL: 88, padR: 28, padT: 16, padB: 44, range });
  if (!layout) return;
  const X = (p) => ox + p.x;
  const Y = (p) => oy + p.y;
  const last = layout.line[layout.line.length - 1];

  for (const tick of layout.yTicks || []) {
    ctx.beginPath();
    ctx.moveTo(ox + layout.padL, oy + tick.y);
    ctx.lineTo(ox + layout.width - layout.padR, oy + tick.y);
    ctx.strokeStyle = tick.zero ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = tick.zero ? 2 : 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(X(layout.line[0]), Y(layout.line[0]));
  for (let i = 1; i < layout.line.length; i++) ctx.lineTo(X(layout.line[i]), Y(layout.line[i]));
  ctx.lineTo(X(last), oy + layout.zeroY);
  ctx.closePath();
  ctx.fillStyle = "rgba(212,175,55,0.18)";
  ctx.fill();

  strokePath(ctx, layout.line, ox, oy);
  ctx.strokeStyle = "#f5d76e";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
  ctx.stroke();

  if (hasEv && layout.evLine && layout.evLine.length) {
    strokePath(ctx, layout.evLine, ox, oy);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([7, 6]);
    ctx.stroke();
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(X(layout.end), Y(layout.end), 7, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();

  ctx.font = "600 18px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#8a8f98";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const tick of layout.yTicks || []) {
    ctx.fillText(tick.text, ox + layout.padL - 10, oy + tick.y);
  }
  ctx.textBaseline = "alphabetic";
  ctx.font = "500 18px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#6b7280";
  for (const tick of layout.xTicks || []) {
    ctx.textAlign = tick.anchor === "end" ? "right" : tick.anchor === "start" ? "left" : "center";
    ctx.fillText(tick.text, ox + tick.x, oy + layout.height - 8);
  }
  ctx.textAlign = "left";
}

function drawLegend(ctx, x, y, hasEv) {
  if (!hasEv) return 0;
  const items = [
    { label: "Profit", color: "#f5d76e", dashed: false },
    { label: "EV", color: "#9ca3af", dashed: true },
  ];
  ctx.font = "600 20px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let xx = x;
  for (const item of items) {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    if (typeof ctx.setLineDash === "function") ctx.setLineDash(item.dashed ? [6, 5] : []);
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx + 22, y);
    ctx.stroke();
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
    ctx.fillStyle = "#8a8f98";
    ctx.fillText(item.label, xx + 28, y);
    xx += 28 + ctx.measureText(item.label).width + 22;
  }
  return 28;
}

/** Draw the share card. Only reads the fields profitImageModel returns. */
export function paintProfitImage(ctx, model, width = W, height = H) {
  const m = model || {};
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, width, height);

  const x = 28;
  const y = 28;
  const w = width - 56;
  const h = height - 56;
  traceRoundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = "#12110c";
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();

  const left = x + 48;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#d4af37";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(String(m.kicker || "Combo Locks"), left, y + 58);

  ctx.fillStyle = "#c3b48a";
  ctx.font = "700 18px Inter, system-ui, sans-serif";
  ctx.fillText(String(m.title || "Running profit").toUpperCase(), left, y + 92);

  const tone = m.tone === "pos" ? "#34d399" : m.tone === "neg" ? "#f87171" : "#f3f4f6";
  ctx.fillStyle = tone;
  ctx.font = "800 68px Inter, system-ui, sans-serif";
  ctx.fillText(String(m.totalText || "—"), left, y + 172);

  ctx.fillStyle = "#8a8f98";
  ctx.font = "600 24px Inter, system-ui, sans-serif";
  const meta = [m.countText, m.rangeLabel, m.spanText].filter(Boolean).join("   ·   ");
  ctx.fillText(meta, left, y + 216);

  const legendY = y + 246;
  const legendH = drawLegend(ctx, left, legendY, !!m.hasEv);
  const chartTop = y + 250 + legendH;
  const chartW = w - 96;
  const chartH = legendH ? 312 : 340;
  if (m.points && m.points.length) {
    drawChart(ctx, m.points, left, chartTop, chartW, chartH, { range: rangeFromLabel(m.rangeLabel), hasEv: !!m.hasEv });
  } else {
    ctx.fillStyle = "#8a8f98";
    ctx.font = "500 26px Inter, system-ui, sans-serif";
    wrapText(ctx, m.emptyText || "No settled locks yet.", left, chartTop + 48, chartW, 36);
  }

  ctx.strokeStyle = "rgba(212,175,55,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, y + h - 78);
  ctx.lineTo(x + w - 48, y + h - 78);
  ctx.stroke();

  ctx.fillStyle = "#d4af37";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(m.brand || "aibetbuilder.io"), x + w - 48, y + h - 40);
  ctx.textAlign = "left";
}

export function renderProfitImageCanvas(model) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintProfitImage(ctx, model, W, H);
  return canvas;
}

export function renderProfitImageBlob(model) {
  const canvas = renderProfitImageCanvas(model);
  if (!canvas || typeof canvas.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function downloadBlob(blob, filename, doc) {
  const documentRef = doc || (typeof document !== "undefined" ? document : null);
  if (!blob || !documentRef) return "unavailable";
  const url = URL.createObjectURL(blob);
  const a = documentRef.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  documentRef.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}

/** Share the PNG when the browser can, otherwise download it. */
export async function shareProfitImage(model, env = {}) {
  const nav = env.nav || (typeof navigator !== "undefined" ? navigator : null);
  const blob = await renderProfitImageBlob(model);
  if (!blob) return "unavailable";
  const file = new File([blob], PROFIT_IMAGE_FILENAME, { type: "image/png" });
  if (profitShareDelivery(profitImageCanShareFiles(file, nav)) === "share") {
    try {
      await nav.share({ files: [file], title: "Combo Locks running profit" });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "canceled";
    }
  }
  return downloadBlob(blob, PROFIT_IMAGE_FILENAME, env.doc);
}
