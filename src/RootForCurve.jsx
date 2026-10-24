// Smoothed P&L curve for "What to root for": red below $0, green above, worst-case lump, markers, hover.
import React, { useEffect, useRef, useState } from "react";
import { curveModel, cdfAt, quantileOf, niceTicks, shortMoney } from "./rootForSimple";

const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const pc = (p) => (p * 100 < 1 && p > 0 ? "<1%" : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

export default function PnlCurve({ hist, worst, ev, pProfit, best, xLabel = "Your result ($)", worstWord = "worst case", unit = "weekends", evLabel = null, todayLocks = false, nowEv = null, nowLabel = "Now" }) {
  const wrap = useRef(null); const [W, setW] = useState(720); const [hx, setHx] = useState(null);
  useEffect(() => {
    const el = wrap.current; if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width)))); ro.observe(el); return () => ro.disconnect();
  }, []);
  const m = curveModel(hist, { worst, cap: 0.995 }); // a little past the 99% best case so its marker sits inside
  if (!m) return null;
  const small = W < 520; const H = small ? 266 : 276; const top = 26, bot = 98, padL = 24, padR = 10;
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
  const tw = (str, fs = 11) => String(str).length * fs * 0.58; // rough text width for collision checks
  const p99 = quantileOf(hist, 0.99); const b99 = Number.isFinite(p99) && p99 > m.xMin && p99 <= m.xMax ? x(p99) : null;
  // Top labels: "Break-even $0" and "Expected $X" never overlap. Default: break-even to the left of its line,
  // expected to the right of its line. If expected is left of $0 (or they'd touch), flip them; if a label would
  // run off the edge or still collide, drop expected to a second row with a short leader line.
  const showBE = !evLabel && m.xMin < 0 && m.xMax > 0;
  const lab = (() => {
    const beText = small && z < 100 ? "$0" : "Break-even $0";
    const evText = evLabel || `Expected ${money(ev)}`;
    const ex = evIn ? x(ev) : null; const L = padL, R = W - padR;
    let beX = z - 4, beAnchor = "end", evX = ex != null ? ex + 4 : 0, evAnchor = "start", evY = 16, beY = 16, evLeader = false;
    const span = (x0, a, t) => (a === "end" ? [x0 - tw(t), x0] : [x0, x0 + tw(t)]);
    const hit = (a, b) => a[0] < b[1] + 6 && b[0] < a[1] + 6;
    if (ex != null && showBE && ex < z) { beX = z + 4; beAnchor = "start"; evX = ex - 4; evAnchor = "end"; }
    if (ex != null) {
      const e = span(evX, evAnchor, evText);
      if (e[0] < L) { evX = ex + 4; evAnchor = "start"; }
      if (e[1] > R) { evX = ex - 4; evAnchor = "end"; }
      const b = span(beX, beAnchor, beText);
      if (b[0] < L) { beX = z + 4; beAnchor = "start"; }
      if (b[1] > R) { beX = z - 4; beAnchor = "end"; }
      if (showBE && hit(span(evX, evAnchor, evText), span(beX, beAnchor, beText))) { evY = top + 12; evLeader = true; }
    }
    return { beText, evText, beX, beY, beAnchor, evX, evY, evAnchor, evLeader };
  })();
  // Bottom labels: worst case (left) and 99% best case (right). If they'd collide, lift the best case label into
  // the plot just above the axis, with its tick line as the leader.
  const wcText = sp ? `${money(sp.x)} ${worstWord}` : "";
  const bcText = b99 != null ? `${money(p99)} best case (99%)` : "";
  const bcX = b99 != null ? Math.min(b99 + 4, W - padR) : 0;
  const bcLift = !!(sp && b99 != null && spX + Math.max(tw(wcText), tw(`${pc(sp.p)} chance`)) + 8 > bcX - Math.max(tw(bcText), tw("1% chance of doing better")));
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
        <g opacity=".9"><path d={`M${x(p10)},${top + plotH + 58}v6H${x(p90)}v-6`} fill="none" stroke="#93c5fd" />
          <text x={(x(p10) + x(p90)) / 2} y={top + plotH + 77} fill="#93c5fd" fontSize="11" textAnchor="middle">{todayLocks ? "Most likely" : `Most ${unit}`}: {shortMoney(p10)} to {shortMoney(p90)}</text></g>
        <path d={area} fill="url(#rf-h)" />
        <path d={line} fill="none" stroke="#e5e7eb" strokeOpacity=".55" strokeWidth="1.5" />
        {sp && <g>
          <rect x={spX} y={top} width={7} height={plotH} rx={2} fill="#991b1b"><title>{`Worst case ${money(sp.x)}: ${pc(sp.p)} chance`}</title></rect>
        </g>}
        {showBE && <g>
          <line x1={z} x2={z} y1={top - 2} y2={top + plotH} stroke="#e5e7eb" strokeDasharray="3 3" />
          <text x={lab.beX} y={lab.beY} fill="#e5e7eb" fontSize="11" textAnchor={lab.beAnchor}>{lab.beText}</text>
        </g>}
        {evIn && <g>
          <line x1={x(ev)} x2={x(ev)} y1={top - 2} y2={top + plotH} stroke="#f59e0b" strokeWidth="1.5" />
          {lab.evLeader && <line x1={x(ev)} x2={lab.evX + (lab.evAnchor === "end" ? 2 : -2)} y1={lab.evY - 4} y2={lab.evY - 4} stroke="#f59e0b" strokeWidth="1" />}
          <text x={lab.evX} y={lab.evY} fill="#fbbf24" fontSize="11" fontWeight="700" textAnchor={lab.evAnchor}>{lab.evText}</text>
        </g>}
        {nowEv != null && Number.isFinite(Number(nowEv)) && nowEv > m.xMin && nowEv < m.xMax && <g data-testid="now-marker">
          <line x1={x(nowEv)} x2={x(nowEv)} y1={top + 18} y2={top + plotH} stroke="#93c5fd" strokeWidth="1" strokeDasharray="4 3" />
          <text x={x(nowEv) + (x(nowEv) > W / 2 ? -4 : 4)} y={top + 30} fill="#93c5fd" fontSize="10" textAnchor={x(nowEv) > W / 2 ? "end" : "start"}>{nowLabel} {money(Number(nowEv))}</text>
        </g>}
        <line x1={padL} x2={W - padR} y1={top + plotH} y2={top + plotH} stroke="#374151" />
        {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={top + plotH} y2={top + plotH + 4} stroke="#4b5563" /><text x={x(t)} y={top + plotH + 17} fill="#9ca3af" fontSize="11" textAnchor="middle">{shortMoney(t)}</text></g>)}
        {sp && <g>
          <line x1={spX + 3.5} x2={spX + 3.5} y1={top + plotH} y2={top + plotH + 24} stroke="#ef4444" strokeWidth="1.5" />
          <text x={spX} y={top + plotH + 35} fill="#fca5a5" fontSize="11" fontWeight="700">{wcText}</text>
          <text x={spX} y={top + plotH + 49} fill="#fca5a5" fontSize="11">{pc(sp.p)} chance</text>
        </g>}
        {b99 != null && <g>
          <line x1={b99} x2={b99} y1={bcLift ? top + plotH - 34 : top + plotH} y2={bcLift ? top + plotH : top + plotH + 24} stroke="#10b981" strokeWidth="1.5" />
          <text x={bcLift ? b99 - 4 : bcX} y={bcLift ? top + plotH - 22 : top + plotH + 35} fill="#6ee7b7" fontSize="11" fontWeight="700" textAnchor="end">{bcText}</text>
          <text x={bcLift ? b99 - 4 : bcX} y={bcLift ? top + plotH - 8 : top + plotH + 49} fill="#6ee7b7" fontSize="11" textAnchor="end">1% chance of doing better</text>
        </g>}
        <text x={(padL + W - padR) / 2} y={H - 4} fill="#cbd5e1" fontSize="12" textAnchor="middle">{xLabel}</text>
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
        Smoothed from {hist.samples ? hist.samples.toLocaleString("en-US") : "simulated"} {todayLocks ? "simulated outcomes of today\u2019s locks" : `simulated ${unit}`}. {todayLocks || unit === "weekends" ? "Deeper red = bigger loss, deeper green = bigger win" : "Deeper green = higher expected profit"}; hover or tap for the chance of finishing below any amount.
        {m.beyond > 0 ? ` Chart stops at ${shortMoney(m.xMax)}: ${pc(m.beyond)} of ${todayLocks ? "outcomes" : unit} go higher (rare big ${todayLocks || unit === "weekends" ? "wins" : "days"}${best && best.pnl ? `, up to ${money(best.pnl)}` : ""}).` : ""}
      </div>
    </div>
  );
}
