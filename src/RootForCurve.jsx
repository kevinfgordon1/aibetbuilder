// Smoothed P&L curve for "What to root for": red below $0, green above, worst-case lump, markers, hover.
import React, { useEffect, useRef, useState } from "react";
import { curveModel, cdfAt, quantileOf, niceTicks, shortMoney } from "./rootForSimple";

const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const pc = (p) => (p * 100 < 1 && p > 0 ? "<1%" : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

export default function PnlCurve({ hist, worst, ev, pProfit, best }) {
  const wrap = useRef(null); const [W, setW] = useState(720); const [hx, setHx] = useState(null);
  useEffect(() => {
    const el = wrap.current; if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width)))); ro.observe(el); return () => ro.disconnect();
  }, []);
  const m = curveModel(hist, { worst });
  if (!m) return null;
  const small = W < 520; const H = small ? 266 : 276; const top = 58, bot = 66, padL = 24, padR = 10;
  const plotH = H - top - bot; const x = (v) => padL + ((v - m.xMin) / (m.xMax - m.xMin)) * (W - padL - padR);
  const yMax = Math.max(...m.ys) || 1; const y = (d) => top + plotH - (d / yMax) * plotH * 0.92;
  const line = m.xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(m.ys[i]).toFixed(1)}`).join("");
  const area = `${line}L${x(m.xMax).toFixed(1)},${top + plotH}L${x(m.xMin).toFixed(1)},${top + plotH}Z`;
  const z = Math.min(Math.max(x(0), padL), W - padR);
  const zOff = Math.min(1, Math.max(0, (0 - m.xMin) / (m.xMax - m.xMin)));
  const p10 = quantileOf(hist, 0.1), p90 = Math.min(quantileOf(hist, 0.9), m.xMax);
  const pLoss = pProfit != null ? 1 - pProfit : cdfAt(hist, 0);
  const ticks = niceTicks(m.xMin, m.xMax, small ? 4 : 6);
  const evIn = ev != null && ev > m.xMin && ev < m.xMax;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect(); const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const v = m.xMin + ((cx * (W / r.width) - padL) / (W - padL - padR)) * (m.xMax - m.xMin);
    setHx(Math.min(m.xMax, Math.max(m.xMin, v)));
  };
  const hc = hx != null ? cdfAt(hist, hx) : null;
  const sp = m.spike; const spX = sp ? x(sp.x) : null;
  return (
    <div ref={wrap} className="pnlcurve" style={{ width: "100%", maxWidth: 900, position: "relative" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="How the weekend could go" style={{ display: "block", touchAction: "pan-y" }}>
        <defs>
          <linearGradient id="rf-h" gradientUnits="userSpaceOnUse" x1={x(m.xMin)} x2={x(m.xMax)} y1="0" y2="0">
            <stop offset="0" stopColor="#991b1b" stopOpacity="1" />
            <stop offset={zOff * 0.45} stopColor="#ef4444" stopOpacity=".75" />
            <stop offset={Math.max(0.001, zOff - 0.002)} stopColor="#fecaca" stopOpacity=".3" />
            <stop offset={Math.min(0.999, zOff + 0.002)} stopColor="#d1fae5" stopOpacity=".3" />
            <stop offset={zOff + (1 - zOff) * 0.3} stopColor="#34d399" stopOpacity=".7" />
            <stop offset="1" stopColor="#059669" stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x={x(p10)} y={top} width={Math.max(0, x(p90) - x(p10))} height={plotH} fill="#93c5fd" opacity=".07" />
        <g opacity=".9"><path d={`M${x(p10)},${top + plotH + 26}v6H${x(p90)}v-6`} fill="none" stroke="#93c5fd" />
          <text x={(x(p10) + x(p90)) / 2} y={top + plotH + 45} fill="#93c5fd" fontSize="11" textAnchor="middle">Most weekends: {shortMoney(p10)} to {shortMoney(p90)}</text></g>
        <path d={area} fill="url(#rf-h)" />
        <path d={line} fill="none" stroke="#e5e7eb" strokeOpacity=".55" strokeWidth="1.5" />
        {sp && <g>
          <rect x={spX} y={top} width={7} height={plotH} rx={2} fill="#991b1b"><title>{`Worst case ${money(sp.x)}: ${pc(sp.p)} chance`}</title></rect>
          <text x={spX} y={49} fill="#fca5a5" fontSize="11"><tspan fontWeight="700">▌Worst case {money(sp.x)}</tspan> · {pc(sp.p)} chance</text>
        </g>}
        {m.xMin < 0 && m.xMax > 0 && <g>
          <line x1={z} x2={z} y1={top - 2} y2={top + plotH} stroke="#e5e7eb" strokeDasharray="3 3" />
          <text x={z - 4} y={32} fill="#e5e7eb" fontSize="11" textAnchor="end">{small && z < 100 ? "$0" : "Break-even $0"}</text>
        </g>}
        {evIn && <g>
          <line x1={x(ev)} x2={x(ev)} y1={top - 2} y2={top + plotH} stroke="#f59e0b" strokeWidth="1.5" />
          <text x={x(ev) + 4} y={32} fill="#fbbf24" fontSize="11" fontWeight="700">Expected {money(ev)}</text>
        </g>}
        <text x={W - padR} y={14} fill="#6ee7b7" fontSize="12" fontWeight="700" textAnchor="end">Make money: {pc(1 - pLoss)}</text>
        <text x={padL} y={14} fill="#fca5a5" fontSize="12" fontWeight="700">Lose money: {pc(pLoss)}</text>
        <line x1={padL} x2={W - padR} y1={top + plotH} y2={top + plotH} stroke="#374151" />
        {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={top + plotH} y2={top + plotH + 4} stroke="#4b5563" /><text x={x(t)} y={top + plotH + 17} fill="#9ca3af" fontSize="11" textAnchor="middle">{shortMoney(t)}</text></g>)}
        <text x={(padL + W - padR) / 2} y={H - 4} fill="#cbd5e1" fontSize="12" textAnchor="middle">Your result ($)</text>
        <text transform={`translate(13,${top + plotH / 2}) rotate(-90)`} fill="#cbd5e1" fontSize="12" textAnchor="middle">More likely →</text>
        {hx != null && <line x1={x(hx)} x2={x(hx)} y1={top} y2={top + plotH} stroke="#fff" strokeOpacity=".7" />}
        <rect x={0} y={0} width={W} height={H} fill="transparent" onMouseMove={onMove} onTouchStart={onMove} onTouchMove={onMove} onMouseLeave={() => setHx(null)} />
      </svg>
      {hx != null && (
        <div className="tip" style={{ position: "absolute", left: Math.min(Math.max(x(hx) - 90, 0), W - 180), top: top + 34, width: 180, background: "#0f172a", border: "1px solid #374151", borderRadius: 8, padding: "6px 8px", fontSize: 12, pointerEvents: "none" }}>
          <b>{money(hx)}</b><br />
          <span className="neg">{pc(hc)}</span> chance you finish below this<br />
          <span className="pos">{pc(1 - hc)}</span> chance you finish above
        </div>
      )}
      <div className="note">
        Smoothed from {hist.samples ? hist.samples.toLocaleString("en-US") : "simulated"} simulated weekends. Deeper red = bigger loss, deeper green = bigger win; hover or tap for the chance of finishing below any amount.
        {m.beyond > 0 ? ` Chart stops at ${shortMoney(m.xMax)}: ${pc(m.beyond)} of weekends go higher (rare big wins${best && best.pnl ? `, up to ${money(best.pnl)}` : ""}).` : ""}
      </div>
    </div>
  );
}
