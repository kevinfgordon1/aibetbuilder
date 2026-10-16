// Combo Sniper row detail (rows with EV >= 3% per $100 risked). Inverse bet method, leg by leg.
import React, { useEffect } from "react";

const am = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (Number(n) > 0 ? "+" : "") + Math.round(Number(n)));
const amFromP = (p) => (!(p > 0 && p < 1) ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
const pFromAm = (a) => (a == null ? null : a < 0 ? -a / (100 - a) : 100 / (100 + a));
const p4 = (p) => (p == null || !Number.isFinite(p) ? "—" : p.toFixed(4));
const pct = (p) => (p == null ? "—" : (p * 100).toFixed(2) + "%");
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };
const etFull = (ts) => (ts ? new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET" : "—");

function legName(l) {
  if (l.kind === "td") {
    const m = /^KXNFLTD-\w+?-([A-Z]{2,3})([A-Z]+?)(\d+)-/.exec(l.id || "");
    return (m ? `${m[2].charAt(0)}. ${m[2].slice(1).charAt(0)}${m[2].slice(2).toLowerCase()} (${m[1]})` : l.id) + ` anytime TD ${l.side === "no" ? "No" : "Yes"}`;
  }
  const g = (l.gameId || "").split("|");
  return `${String(l.team || "").toUpperCase()} moneyline${g[2] ? ` (${g[2].replace("+", " vs ").toUpperCase()})` : ""}`;
}

export default function SniperRowDetail({ e, onClose }) {
  useEffect(() => { const k = (ev) => ev.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const d = e.detail || { legs: [] };
  const P = d.parlayP != null ? d.parlayP : pFromAm(e.fairAmerican);
  const poly = e.venue === "polymarket";
  const C = e.contracts;
  const takerFeeGets = e.takerGetsCost - C * e.weSellYes;
  const takerFeeGot = e.takerGotCost - C * e.winningMmYes;
  return (
    <div className="snd-back" onClick={onClose}>
      <div className="snd" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Row detail">
        <button type="button" className="snd-x" onClick={onClose} aria-label="Close">×</button>
        <h3>{poly ? "Polymarket" : "Kalshi"} request · {etFull(e.ts)}</h3>
        <div className="snd-sub">{e.nLegs}-leg {e.market === "td" ? "player TD" : "moneyline"} parlay · {Math.round(C).toLocaleString()} contracts{e.requestedCost != null ? ` · ${usd(e.requestedCost)} requested` : ""}</div>

        <h4>Legs: inverse bet fair</h4>
        <table className="snd-t">
          <thead><tr><th>Leg</th><th>Best opposing price</th><th>Source</th><th>Depth</th><th className="num">Fair</th><th className="num">Prob</th></tr></thead>
          <tbody>
            {d.legs.length ? d.legs.map((l, i) => (
              <tr key={i}>
                <td>{legName(l)}</td>
                <td className="num">{am(l.oppAmerican)}{l.oppVwap != null ? ` (${l.oppVwap.toFixed(4)})` : ""}</td>
                <td>{VENUE[l.oppSource] || l.oppSource || "—"}</td>
                <td>$500 filled</td>
                <td className="num fair">{am(l.fairAmerican != null ? l.fairAmerican : amFromP(l.p))}</td>
                <td className="num">{p4(l.p)}</td>
              </tr>
            )) : <tr><td colSpan={6}>Per-leg data wasn't logged for this request.</td></tr>}
            <tr className="snd-tot"><td colSpan={4}>Parlay fair = product of legs</td><td className="num fair">{am(amFromP(P))}</td><td className="num">{p4(P)}</td></tr>
          </tbody>
        </table>

        <h4>Prices</h4>
        <dl className="snd-g">
          <dt>Winning MM quote</dt><dd>{am(e.winningMmAmerican)} <span>(YES ${e.winningMmYes})</span></dd>
          <dt>Taker got (after fee)</dt><dd>{am(e.takerGotAmerican)} <span>paid {usd(e.takerGotCost)}</span></dd>
          <dt>We sell at</dt><dd className="pos">{am(e.weSellAmerican)} <span>(YES ${e.weSellYes}, we receive {usd(e.weReceive)})</span></dd>
          <dt>Taker gets</dt><dd>{am(e.takerGetsAmerican)} <span>pays {usd(e.takerGetsCost)}</span></dd>
        </dl>

        <h4>Fees ({poly ? "Polymarket US" : "Kalshi"})</h4>
        <dl className="snd-g">
          {poly ? (<>
            <dt>Taker fee</dt><dd>Polymarket US combo fee curve: {usd(takerFeeGets)} at our price ({usd(takerFeeGot)} on the winning quote)</dd>
            <dt>Maker fee (us)</dt><dd>$0.00 (combo makers pay no fee)</dd>
          </>) : (<>
            <dt>Taker fee</dt><dd>0.07 × {C} × {e.weSellYes} × {(1 - e.weSellYes).toFixed(4)}, rounded up = {usd(takerFeeGets)} ({usd(takerFeeGot)} on the winning quote)</dd>
            <dt>Maker fee (us)</dt><dd>{e.makerRate ? `${e.makerRate} × ${C} × p × (1−p) = ${usd(e.makerFee)}` : "$0.00 (series has no maker fee)"}</dd>
          </>)}
        </dl>

        <h4>Risk and EV</h4>
        <dl className="snd-g">
          <dt>Contracts</dt><dd>{C.toLocaleString()}</dd>
          <dt>Max loss</dt><dd className="neg">{usd(e.maxLoss)} <span>(we buy NO at ${(1 - e.weSellYes).toFixed(4)})</span></dd>
          <dt>We win (parlay misses)</dt><dd>{pct(1 - P)} <span>+{usd(C - e.maxLoss)}</span></dd>
          <dt>We lose (parlay hits)</dt><dd>{pct(P)} <span>−{usd(e.maxLoss)}</span></dd>
          <dt>EV</dt><dd className="pos">{usd(e.ev)} <span>= {(1 - P).toFixed(4)} × {C} − {usd(e.maxLoss)}</span></dd>
          <dt>EV / $100 risked</dt><dd className="pos">{usd(e.evPer100)}</dd>
          <dt>Request</dt><dd>{etFull(e.ts)} · {poly ? "Polymarket" : "Kalshi"} · <code>{e.ticker}</code></dd>
        </dl>
      </div>
    </div>
  );
}
