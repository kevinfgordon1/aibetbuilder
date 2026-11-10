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

function drawChart(ctx, points, ox, oy, w, h) {
  const layout = profitChartLayout(points, { width: w, height: h, padL: 84, padR: 24, padT: 20, padB: 40 });
  if (!layout) return;
  const X = (p) => ox + p.x;
  const Y = (p) => oy + p.y;
  const last = layout.line[layout.line.length - 1];
  ctx.beginPath();
  ctx.moveTo(X(layout.line[0]), Y(layout.line[0]));
  for (let i = 1; i < layout.line.length; i++) ctx.lineTo(X(layout.line[i]), Y(layout.line[i]));
  ctx.lineTo(X(last), oy + layout.zeroY);
  ctx.closePath();
  ctx.fillStyle = "rgba(212,175,55,0.18)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(ox + layout.padL, oy + layout.zeroY);
  ctx.lineTo(ox + layout.width - layout.padR, oy + layout.zeroY);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(X(layout.line[0]), Y(layout.line[0]));
  for (let i = 1; i < layout.line.length; i++) ctx.lineTo(X(layout.line[i]), Y(layout.line[i]));
  ctx.strokeStyle = "#f5d76e";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(X(layout.end), Y(layout.end), 7, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();

  ctx.font = "600 20px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#8a8f98";
  ctx.textBaseline = "middle";
  for (const lb of layout.labels) {
    ctx.textAlign = lb.anchor === "end" ? "right" : "left";
    ctx.fillText(lb.text, ox + lb.x, oy + lb.y);
  }
  ctx.textBaseline = "alphabetic";
  ctx.font = "500 20px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "left";
  if (layout.firstDate) ctx.fillText(layout.firstDate, ox + layout.padL, oy + layout.height - 10);
  if (layout.lastDate && layout.lastDate !== layout.firstDate) {
    ctx.textAlign = "right";
    ctx.fillText(layout.lastDate, ox + layout.width - layout.padR, oy + layout.height - 10);
  }
  ctx.textAlign = "left";
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

  const chartTop = y + 250;
  const chartW = w - 96;
  const chartH = 340;
  if (m.points && m.points.length) {
    drawChart(ctx, m.points, left, chartTop, chartW, chartH);
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
