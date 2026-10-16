// "Why it's +EV": two bars. Width = how often, height = average size. Red area vs green area = expected profit.
import React from "react";
import { lossWinSplit, curveCaption } from "./rootForSimple";

const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
const P = (p) => `${Math.round(p * 100)}%`;

export default function EvBars({ hist, ev, pProfit, worst }) {
  const pLoss = pProfit != null ? 1 - pProfit : undefined;
  const s = lossWinSplit(hist, Number(ev), pLoss, worst);
  if (!s) return null;
  const W = 600, maxH = 120, pad = 8; const big = Math.max(Math.abs(s.avgLoss), Math.abs(s.avgWin), 1);
  const wL = (W - 2 * pad - 6) * s.pLoss, wW = (W - 2 * pad - 6) * s.pWin;
  const hW = (Math.abs(s.avgWin) / big) * maxH, hL = (Math.abs(s.avgLoss) / big) * maxH;
  const base = 14 + maxH; const H = base + maxH * (Math.abs(s.avgLoss) / big) + 8;
  const title = Number(ev) >= 0 ? "Why you come out ahead" : "Why you come out behind";
  return (
    <div className="evbars" style={{ margin: "6px 0 12px" }}>
      <h4>{title}</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: "1 1 280px", maxWidth: 520, display: "block" }} role="img" aria-label={title}>
          <rect x={pad} y={base} width={wL} height={hL} rx={4} fill="#dc2626"><title>{`Lose ${P(s.pLoss)} of the time, avg ${money(s.avgLoss)}`}</title></rect>
          <rect x={pad + wL + 6} y={base - hW} width={wW} height={hW} rx={4} fill="#10b981"><title>{`Win ${P(s.pWin)} of the time, avg ${money(s.avgWin)}`}</title></rect>
          <text x={pad + wL / 2} y={base + hL / 2 + 6} fill="#fff" fontSize="17" fontWeight="700" textAnchor="middle">Lose {P(s.pLoss)} · {money(s.avgLoss)}</text>
          <text x={pad + wL + 6 + wW / 2} y={base - hW / 2 + 6} fill="#052e1f" fontSize="17" fontWeight="700" textAnchor="middle">Win {P(s.pWin)} · {money(s.avgWin)}</text>
          <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="#e5e7eb" strokeDasharray="3 3" />
          <text x={W - pad} y={base - 4} fill="#9ca3af" fontSize="14" textAnchor="end">$0</text>
        </svg>
        <div style={{ flex: "1 1 220px", fontSize: 14, lineHeight: 1.6 }}>
          <div><span style={{ display: "inline-block", width: 10, height: 10, background: "#dc2626", borderRadius: 2, marginRight: 6 }} />Lose <b className="neg">{P(s.pLoss)}</b> of the time · avg <b className="neg">{money(s.avgLoss)}</b></div>
          <div><span style={{ display: "inline-block", width: 10, height: 10, background: "#10b981", borderRadius: 2, marginRight: 6 }} />Win <b className="pos">{P(s.pWin)}</b> of the time · avg <b className="pos">{money(s.avgWin)}</b></div>
          <div className="sub" style={{ marginTop: 4 }}>Wide = how often. Tall = how much. Green area ({money(s.winArea)}) minus red area ({money(s.lossArea).replace("−", "")}) = your expected profit <b style={{ color: "#fbbf24" }}>{money(Number(ev))}</b>.</div>
        </div>
      </div>
      <div style={{ fontSize: 15, color: "#e5e7eb", marginTop: 6 }}>{curveCaption(s.pLoss, Number(ev))}</div>
    </div>
  );
}
