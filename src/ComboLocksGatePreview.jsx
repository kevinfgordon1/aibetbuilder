// Marketing graphics for the locked Combo Locks screen: a flow diagram and a static,
// non-interactive replica of a member lock card fed with made-up EXAMPLE data only.
import { COMBO_VIEW_CSS } from "./ComboLocksView";

const GOLD = "#d4af37";
const VIOLET = "#a78bfa";

const FLOW = [
  { t: "Sportsbook parlay", s: "+600 boosted", icon: "ticket" },
  { t: "Quoted on Kalshi & Polymarket US", s: "same combo offered", icon: "quote" },
  { t: "Hedged", s: "fills come in", icon: "shield" },
  { t: "Profit locked", s: "win or lose", icon: "lock" },
];

function Icon({ kind }) {
  const p = { fill: "none", stroke: GOLD, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (kind === "ticket") return <g {...p}><rect x="-13" y="-9" width="26" height="18" rx="3" /><path d="M-6 -3h12M-6 3h8" /></g>;
  if (kind === "quote") return <g {...p}><path d="M-12 8l7-8 5 5 8-12" /><path d="M4 -7h5v5" /></g>;
  if (kind === "shield") return <g {...p}><path d="M0 -12l10 4v6c0 7-5 11-10 13-5-2-10-6-10-13v-6z" /><path d="M-4 0l3 3 6-6" /></g>;
  return <g {...p}><rect x="-9" y="-2" width="18" height="13" rx="2" /><path d="M-5 -2v-4a5 5 0 0 1 10 0v4" /></g>;
}

export function ComboFlowGraphic() {
  return (
    <div className="cg-flow" data-testid="combo-beta-flow">
      {FLOW.map((f, i) => (
        <div className="cg-step" key={f.t}>
          <svg viewBox="-24 -24 48 48" width="48" height="48" aria-hidden="true">
            <circle r="22" fill="rgba(212,175,55,.08)" stroke={i === FLOW.length - 1 ? GOLD : VIOLET} strokeWidth="1.5" />
            <Icon kind={f.icon} />
          </svg>
          <div className="cg-t">{f.t}</div>
          <div className="cg-s">{f.s}</div>
          {i < FLOW.length - 1 && (
            <svg className="cg-arrow" viewBox="0 0 24 12" width="24" height="12" aria-hidden="true">
              <path d="M0 6h20M15 1l5 5-5 5" fill="none" stroke={VIOLET} strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

const LEGS = [
  ["NFL · Moneyline", "Example Team A to win", "-150"],
  ["NFL · Spread", "Example Team B +3.5", "-110"],
  ["NFL · Total", "Example Game Over 44.5", "-105"],
];

export function ComboMemberPreview() {
  return (
    <div className="cg-mock" data-testid="combo-beta-preview" aria-label="Example of the Combo Locks page" inert="">
      <style>{COMBO_VIEW_CSS}</style>
      <div className="cg-tag">EXAMPLE · what members see</div>
      <div className="cl" aria-hidden="true">
        <div className="stats">
          <div className="stat"><div className="k">Waiting for a match</div><div className="v">0</div><div className="s">being offered now</div></div>
          <div className="stat"><div className="k">Filled</div><div className="v">1</div><div className="s">waiting on the games</div></div>
          <div className="stat"><div className="k">History P/L</div><div className="v" style={{ color: "#34d399" }}>+$27</div><div className="s">example</div></div>
        </div>
        <article className="lk" style={{ marginTop: 12 }}>
          <div className="lk-sum">
            <div className="lk-top">
              <span className="pill green"><span className="dot" />Filled</span>
              <div className="lk-title">3-leg NFL parlay (example)</div>
            </div>
            <div className="lk-meta lk-bet">$100 @ +600 boosted at your sportsbook</div>
            <ul className="leglist" style={{ margin: "8px 0" }}>
              {LEGS.map(([t, l, o]) => <li key={l}><span className="lt">{t}</span>{l}<span className="lg">{o}</span></li>)}
            </ul>
            <div className="lk-facts">
              <div className="fact out stand"><div className="k">Where you stand now</div><div className="srows"><div className="srow"><span className="sl">If it hits</span><span className="sv pos">+$27</span></div><div className="srow"><span className="sl">If it misses</span><span className="sv pos">+$27</span></div></div></div>
              <div className="fact"><div className="k">Sold at</div><div className="v">+450</div><div className="s">Fair odds +480</div></div>
              <div className="fact"><div className="k">Hedged</div><div className="v">100%</div><div className="s">all example contracts</div></div>
            </div>
            <div className="cg-bar"><div className="cg-bar-fill" /></div>
            <div className="cg-barlbl"><span>0%</span><span>100% hedged</span></div>
            <div className="cg-fills">
              <span className="venue kalshi">Kalshi</span> filled +450 ·{" "}
              <span className="venue polymarket">Polymarket US</span> filled +455
            </div>
            <div className="lk-hint">Profit locked: +$27 whether the parlay hits or misses.</div>
          </div>
        </article>
      </div>
      <div className="cg-fade" />
    </div>
  );
}

export const GATE_PREVIEW_CSS = `
.cg-flow{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0;text-align:center}
.cg-step{position:relative;display:flex;flex-direction:column;align-items:center;padding:4px}
.cg-t{font-size:13px;font-weight:700;color:#e8eaed;margin-top:6px;line-height:1.25}
.cg-s{font-size:11px;color:#a78bfa;margin-top:2px}
.cg-arrow{position:absolute;right:-16px;top:18px}
.cg-mock{position:relative;text-align:left;border:1px solid rgba(167,139,250,.45);border-radius:14px;padding:14px;margin:14px 0;max-height:520px;overflow:hidden;background:rgba(255,255,255,.02);pointer-events:none;user-select:none}
.cg-tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:1px;color:#a78bfa;background:rgba(167,139,250,.14);border-radius:999px;padding:2px 10px;margin-bottom:10px}
.cg-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);margin-top:10px;overflow:hidden}
.cg-bar-fill{height:100%;width:100%;background:linear-gradient(90deg,#a78bfa,#d4af37)}
.cg-barlbl{display:flex;justify-content:space-between;font-size:11px;color:#8a8f98;margin-top:3px}
.cg-fills{font-size:12.5px;color:#c3c6cc;margin-top:8px}
.cg-fade{position:absolute;left:0;right:0;bottom:0;height:60px;background:linear-gradient(transparent,#0b0d12)}
@media (max-width:640px){
  .cg-flow{grid-template-columns:repeat(2,1fr);row-gap:14px}
  .cg-arrow{display:none}
  .cg-mock .cl .stats{grid-template-columns:repeat(3,1fr);gap:6px}
  .cg-mock .cl .stat{padding:8px}
  .cg-mock .cl .stat .v{font-size:16px}
}
`;
