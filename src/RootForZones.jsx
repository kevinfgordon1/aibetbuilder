// Average ± 1/2 SD zones with the ACTUAL simulated chance in each (empirical, not a normal curve).
import React from "react";
import { sdZones, shortMoney } from "./rootForSimple";

const BG = ["#991b1b", "#dc2626", "rgba(248,113,113,.35)", "rgba(52,211,153,.35)", "#10b981", "#059669"];
const pc = (p) => (p <= 0 ? "0%" : p < 0.001 ? "<0.1%" : `${(p * 100).toFixed(1)}%`);
const money = (n) => (n < 0 ? "−$" : n > 0 ? "+$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

export default function SdZones({ hist, ev, sd, worst, compact = false }) {
  const zones = sdZones(hist, ev, sd, worst);
  if (!zones.length) return null;
  const range = (z) => (z.from === -Infinity ? `under ${shortMoney(z.to)}` : z.to === Infinity ? `over ${shortMoney(z.from)}` : `${shortMoney(z.from)} to ${shortMoney(z.to)}`);
  if (compact) return (
    <div className="sdzc">
      <style>{`
        .rootfor .sdzc{background:rgba(11,18,32,.88);border:1px solid #374151;border-radius:8px;padding:6px 8px;font-size:11.5px}
        .rootfor .sdzc .hd{color:#cbd5e1;margin-bottom:3px}
        .rootfor .sdzc table{width:100%;border-collapse:collapse;margin:0}.rootfor .sdzc td{padding:1.5px 4px;border:0;white-space:nowrap}
        .rootfor .sdzc .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
        .rootfor .sdzc .pp{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
        .rootfor .sdzc tr.dim td{opacity:.5}.rootfor .sdzc .ft{color:#9ca3af;font-size:10.5px;margin-top:3px;white-space:normal}
      `}</style>
      <div className="hd">Average <b style={{ color: "#fbbf24" }}>{money(ev)}</b> · 1 SD = <b>{money(sd).replace("+", "")}</b></div>
      <table><tbody>
        {zones.map((z, i) => (
          <tr key={z.name} className={z.belowWorst ? "dim" : ""}>
            <td><span className="sw" style={{ background: BG[i] }} />{z.name}</td>
            <td className="sub">{range(z)}</td>
            <td className="pp">{pc(z.p)}{z.holdsWorst ? "*" : ""}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="ft">Real chances from the simulation.{zones.some((z) => z.belowWorst) ? <> Faded zones sit below your worst case (<span style={{ whiteSpace: "nowrap" }}>{money(worst.pnl)}</span>), so they&apos;re 0%.</> : ""}{zones.some((z) => z.holdsWorst) ? ` *Includes the worst case (${pc(worst.p)}).` : ""}</div>
    </div>
  );
  return (
    <div className="sdz">
      <style>{`
        .rootfor .sdz{margin:10px 0 4px}
        .rootfor .sdz .hd{font-size:13px;margin-bottom:6px}
        .rootfor .sdz .row{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
        .rootfor .sdz .z{border-radius:8px;padding:8px 8px 7px;min-height:76px;color:#f9fafb}
        .rootfor .sdz .z .n{font-size:11px;opacity:.9}.rootfor .sdz .z .r{font-size:12px;font-weight:600;margin-top:1px}
        .rootfor .sdz .z .p{font-size:20px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums}
        .rootfor .sdz .z .x{font-size:10.5px;opacity:.9;margin-top:2px;line-height:1.25}
        .rootfor .sdz .z.dim{opacity:.45}
        .rootfor .sdz .avg{position:relative;height:0}
        @media (max-width:600px){.rootfor .sdz .row{grid-template-columns:repeat(2,1fr)}}
      `}</style>
      <div className="hd">Average <b style={{ color: "#fbbf24" }}>{money(ev)}</b> · 1 SD = <b>{money(sd).replace("+", "")}</b> <span className="sub">· chance of landing in each zone, from {hist.samples ? hist.samples.toLocaleString("en-US") : "the"} simulated weekends</span></div>
      <div className="row">
        {zones.map((z, i) => (
          <div key={z.name} className={"z" + (z.belowWorst ? " dim" : "")} style={{ background: BG[i], border: i === 2 || i === 3 ? "1px solid #374151" : "1px solid transparent" }}>
            <div className="n">{z.name}</div>
            <div className="r">{range(z)}</div>
            <div className="p">{pc(z.p)}</div>
            {z.belowWorst && <div className="x">Below your worst case ({money(worst.pnl)}), so it can't happen</div>}
            {z.holdsWorst && <div className="x">Includes the worst case {money(worst.pnl)} ({pc(worst.p)})</div>}
          </div>
        ))}
      </div>
      <div className="note">Real chances from the simulation, not a bell-curve guess. Your results are lopsided: the downside stops at {money(worst ? worst.pnl : 0)}, while the upside runs much further.</div>
    </div>
  );
}
