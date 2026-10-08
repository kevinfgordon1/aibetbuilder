// Combo Locks presentation pieces: status pill, explainer, summary strip, lock
// card shell, and the History table. Data and actions stay in ComboLocks.jsx;
// everything here is display only. Copy is plain English with American odds.
import React from "react";
import {
  betSummary, countText, dollars, etDateTime, fmtAmerican, historyRow, historyTotals,
  lockMetaLine, lockTitle, plainLeg, profitLine, QUOTE_ROWS_SHOWN, signedDollars,
} from "./comboLockView";
import { STATEMENT_DATE_FILTERS } from "./comboStatement";
import { shouldToggleFromCard } from "./comboCardToggle.js";

export const COMBO_VIEW_CSS = `
  .cl .cl-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .cl .cl-title{font-size:22px;font-weight:800;letter-spacing:-.2px;line-height:1.2}
  .cl .cl-sub{font-size:14px;color:#9aa3b2;margin-top:4px;line-height:1.45;max-width:640px}
  .cl .cl-master{display:flex;align-items:center;gap:10px;margin-left:auto;padding:8px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03)}
  .cl .cl-master .m-k{font-size:13px;font-weight:700;color:#e8eaed}
  .cl .cl-master .m-s{font-size:12px;color:#8a8f98}
  .cl .cl-master.stopped{border-color:rgba(239,68,68,.45);background:rgba(239,68,68,.08)}
  .cl .cl-master.stopped .m-s{color:#fca5a5}
  .cl .how{border:1px solid rgba(255,255,255,0.08);border-radius:12px;background:rgba(59,130,246,.05);margin:0 0 14px}
  .cl .how>summary{cursor:pointer;list-style:none;padding:11px 14px;font-weight:700;font-size:14px;color:#bfdbfe;display:flex;align-items:center;gap:8px}
  .cl .how>summary::-webkit-details-marker{display:none}
  .cl .how>summary .car{transition:transform .15s;display:inline-block}
  .cl .how[open]>summary .car{transform:rotate(90deg)}
  .cl .how ol{margin:0;padding:0 16px 14px 34px;color:#c3c6cc;font-size:14px;line-height:1.6}
  .cl .how ol li{margin:2px 0}
  .cl .how .how-foot{padding:0 16px 14px;font-size:13px;color:#8a8f98;line-height:1.5}
  .cl .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 6px}
  .cl .stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;text-align:left;color:inherit;font:inherit;cursor:pointer}
  .cl .stat:hover{border-color:rgba(147,197,253,.35)}
  .cl .stat .k{font-size:12px;color:#8a8f98;font-weight:600}
  .cl .stat .v{font-size:22px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
  .cl .stat .s{font-size:12px;color:#6b7280;margin-top:2px}
  .cl .sec-h{display:flex;align-items:baseline;gap:10px;margin:26px 2px 10px;flex-wrap:wrap}
  .cl .sec-h h2{font-size:17px;font-weight:800;margin:0;color:#e8eaed}
  .cl .sec-h .cnt{font-size:12px;font-weight:700;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#c3c6cc}
  .cl .sec-h .sec-sub{font-size:13px;color:#8a8f98;flex-basis:100%;margin-top:2px}
  .cl .pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;line-height:1.4}
  .cl .pill .dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto}
  .cl .pill.blue{background:rgba(59,130,246,.16);color:#93c5fd}
  .cl .pill.blue .dot{animation:cl-pulse 1.6s ease-in-out infinite}
  .cl .pill.teal{background:rgba(20,184,166,.16);color:#5eead4}
  .cl .pill.green{background:rgba(16,185,129,.17);color:#6ee7b7}
  .cl .pill.amber{background:rgba(245,158,11,.17);color:#fcd34d}
  .cl .pill.red{background:rgba(239,68,68,.18);color:#fca5a5}
  .cl .pill.grey{background:rgba(255,255,255,0.08);color:#9aa3b2}
  @keyframes cl-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .cl .lk{border:1px solid rgba(255,255,255,0.09);border-radius:14px;padding:14px 16px;margin-bottom:12px;background:rgba(255,255,255,0.025);border-left:4px solid rgba(147,197,253,.55)}
  .cl .lk.lk-partial{border-left-color:rgba(94,234,212,.7)}
  .cl .lk.lk-filled{border-left-color:rgba(52,211,153,.8)}
  .cl .lk.lk-paused{border-left-color:rgba(252,211,77,.7);background:rgba(245,158,11,.03)}
  .cl .lk.lk-stopped{border-left-color:rgba(248,113,113,.75)}
  .cl .lk.lk-off{border-left-color:rgba(255,255,255,.2)}
  .cl .lk.open{border-color:rgba(147,197,253,.3)}
  .cl .lk{transition:border-color .12s,background-color .12s}
  .cl .lk-sum{cursor:pointer;border-radius:10px;outline:none}
  .cl .lk:has(.lk-sum:hover){border-color:rgba(147,197,253,.28);background-color:rgba(255,255,255,0.035)}
  .cl .lk-sum:focus-visible{box-shadow:0 0 0 2px rgba(147,197,253,.55)}
  .cl .lk-sum .lk-ctl,.cl .lk-sum button{cursor:pointer}
  .cl .lk-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cl .lk-title{font-size:16px;font-weight:700;line-height:1.35;flex:1 1 260px;min-width:0;color:#f3f4f6}
  .cl .lk-ctl{display:flex;align-items:center;gap:8px;margin-left:auto}
  .cl .lk-meta{font-size:13px;color:#8a8f98;margin-top:4px}
  .cl .lk-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 10px}
  .cl .fact{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;min-width:0}
  .cl .fact .k{font-size:11px;font-weight:600;color:#8a8f98;text-transform:uppercase;letter-spacing:.4px}
  .cl .fact .v{font-size:16px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cl .fact .s{font-size:11px;color:#6b7280;margin-top:1px}
  .cl .lk-profit{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:14px;margin-top:8px;font-variant-numeric:tabular-nums}
  .cl .lk-profit .lead{color:#8a8f98;font-weight:600}
  .cl .lk-profit.pos .val{color:#34d399;font-weight:700}
  .cl .lk-profit.warn .val{color:#fcd34d;font-weight:700}
  .cl .lk-profit.muted .val{color:#c3c6cc;font-weight:700}
  .cl .lk-hint{font-size:12px;color:#6b7280;margin-top:4px}
  .cl .lk-details{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08)}
  .cl .dblock{margin-bottom:14px}
  .cl .dblock>.dt{font-size:12px;font-weight:700;color:#9aa3b2;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .cl .leglist{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .cl .leglist li{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);font-size:14px}
  .cl .leglist .lt{font-size:11px;font-weight:700;color:#7ea2e0;text-transform:uppercase;letter-spacing:.3px;min-width:84px}
  .cl .leglist .lg{font-size:12px;color:#6b7280;margin-left:auto}
  .cl .chips{display:flex;flex-wrap:wrap;gap:6px}
  .cl .actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 6px}
  .cl .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .cl .hist-totals{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px}
  .cl .hist-totals .stat{cursor:default}
  .cl .hist-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 12px}
  .cl .hist-filters .fl{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin:0 2px 0 6px}
  .cl .hist-filters .fl:first-child{margin-left:0}
  .cl .fchip{border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#9ca3af;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
  .cl .fchip.on{background:rgba(59,130,246,.2);color:#93c5fd;border-color:rgba(59,130,246,.35)}
  .cl .hist-filters input[type=search]{flex:1 1 160px;max-width:240px;width:auto;padding:6px 10px}
  .cl .htable{width:100%;border-collapse:collapse;font-size:14px}
  .cl .htable>thead th{font-size:11px;padding:8px 10px}
  .cl .htable>tbody>tr>td{padding:11px 10px;vertical-align:middle}
  .cl .htable .hrow{cursor:pointer}
  .cl .htable .hrow:hover td{background:rgba(255,255,255,0.03)}
  .cl .htable .hrow.open td{background:rgba(147,197,253,.06)}
  .cl .htable .h-title{font-weight:600;color:#e8eaed;line-height:1.35}
  .cl .htable .h-sub{font-size:12px;color:#6b7280;margin-top:2px}
  .cl .htable .h-subdate{display:none}
  .cl .htable .h-pnl{font-weight:800;text-align:right;white-space:nowrap}
  .cl .htable th.r{text-align:right}
  .cl .htable .h-car{color:#93c5fd;width:18px;text-align:center}
  .cl .htable>tbody>.hdetail>td{padding:4px 10px 16px;background:rgba(147,197,253,.03)}
  .cl .res{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}
  .cl .res.win{background:rgba(16,185,129,.15);color:#6ee7b7}
  .cl .res.lose{background:rgba(248,113,113,.14);color:#fca5a5}
  .cl .res.wait{background:rgba(147,197,253,.14);color:#93c5fd}
  .cl .tag{font-size:11px;font-weight:600;color:#8a8f98;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0 6px;margin-left:6px;white-space:nowrap}
  .cl .adv{margin-top:26px;border:1px solid rgba(255,255,255,0.08);border-radius:12px}
  .cl .adv>summary{cursor:pointer;padding:12px 14px;font-weight:700;color:#9aa3b2;font-size:14px}
  .cl .adv .adv-body{padding:0 14px 14px}
  .cl .adv h3{margin-top:14px}
  .cl .fact .s .fair{color:#c3c6cc;font-weight:600}
  .cl .htable .c-fair{white-space:nowrap}
  .cl .htable .m-lbl{display:none}
  .cl .qh-sec{margin:0 0 12px}
  .cl .qh-h{display:flex;align-items:baseline;gap:4px 8px;flex-wrap:wrap;margin:2px 0 6px;font-size:13px;font-weight:700;color:#e8eaed}
  .cl .qh-h>span:first-child{white-space:nowrap}
  .cl .qh-h .cnt{font-size:12px;font-weight:700;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#c3c6cc}
  .cl .qh-h.ok .cnt{background:rgba(16,185,129,.16);color:#6ee7b7}
  .cl .qh-h .qh-s{font-size:12px;font-weight:500;color:#8a8f98}
  .cl .qtable{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}
  .cl .qtable th:nth-child(1){width:20%}.cl .qtable th:nth-child(2){width:11%}.cl .qtable th:nth-child(3){width:10%}.cl .qtable th:nth-child(4){width:14%}
  .cl .qtable th{font-size:11px;padding:6px 8px;text-align:left}
  .cl .qtable td{padding:7px 8px;vertical-align:top;border-top:1px solid rgba(255,255,255,0.05)}
  .cl .qtable .q-price,.cl .qtable .q-size{font-variant-numeric:tabular-nums;white-space:nowrap}
  .cl .qtable .q-time{white-space:nowrap;color:#c3c6cc}
  .cl .qtable .q-det{font-size:12px;color:#8a8f98;margin-top:2px}
  .cl .res.skip{background:rgba(255,255,255,0.07);color:#9aa3b2}
  .cl .res.warn{background:rgba(245,158,11,.15);color:#fcd34d}
  .cl .qh-more{margin-top:6px}
  .cl .qh-foot{font-size:12px;color:#6b7280;margin-top:4px}
  .cl .venue{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:6px;background:rgba(255,255,255,0.06);color:#c3c6cc;white-space:nowrap}
  .cl .venue.kalshi{background:rgba(16,185,129,.12);color:#6ee7b7}
  .cl .venue.polymarket{background:rgba(99,102,241,.16);color:#a5b4fc}
  @media (max-width:860px){
    .cl .grid2{grid-template-columns:1fr}
    .cl .hist-totals{grid-template-columns:1fr 1fr}
  }
  @media (max-width:640px){
    .cl .cl-title{font-size:20px}
    .cl .cl-master{margin-left:0;width:100%;justify-content:space-between}
    .cl .stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    .cl .stat{padding:10px}
    .cl .stat .v{font-size:18px}
    .cl .card{padding:12px}
    .cl .lk{padding:12px}
    .cl .lk-title{flex-basis:100%;order:2;font-size:15px}
    .cl .lk-top .pill{order:1}
    .cl .lk-ctl{order:1}
    .cl .lk-facts{grid-template-columns:1fr 1fr}
    .cl .row.c3,.cl .row.c2{grid-template-columns:1fr}
    .cl .profile,.cl .tiles{grid-template-columns:1fr}
    .cl .legrow{grid-template-columns:1fr auto}
    .cl .legrow>div:first-child{grid-column:1 / -1}
    .cl .leglist .lg{margin-left:0;flex-basis:100%}
    .cl .htable>thead{display:none}
    .cl .htable,.cl .htable>tbody{display:block}
    .cl .htable>tbody>tr.hrow{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,0.06)}
    .cl .htable>tbody>tr.hrow>td{display:block;padding:0;border:0}
    .cl .htable>tbody>tr.hrow>.c-title{grid-column:1;grid-row:1}
    .cl .htable>tbody>tr.hrow>.c-pnl{grid-column:2;grid-row:1}
    .cl .htable>tbody>tr.hrow>.c-res{grid-column:2;grid-row:2;text-align:right}
    .cl .htable>tbody>tr.hrow>.c-bet{grid-column:1;grid-row:2;font-size:13px;color:#9aa3b2}
    .cl .htable>tbody>tr.hrow>.c-fair{grid-column:1;grid-row:3;font-size:13px;color:#9aa3b2}
    .cl .htable .m-lbl{display:inline;color:#6b7280;font-weight:600}
    .cl .htable>tbody>tr.hrow>.c-date,.cl .htable>tbody>tr.hrow>.c-sold,.cl .htable>tbody>tr.hrow>.h-car{display:none}
    .cl .qtable thead{display:none}
    .cl .qtable,.cl .qtable tbody{display:block}
    .cl .qh-h .qh-s{flex-basis:100%;font-size:11px}
    .cl .qtable tr{display:grid;grid-template-columns:auto 1fr auto;gap:3px 8px;padding:8px 2px;border-top:1px solid rgba(255,255,255,0.05);align-items:center}
    .cl .qtable td{display:block;padding:0;border:0}
    .cl .qtable .q-res{grid-column:1 / 3;grid-row:1}
    .cl .qtable .q-price{grid-column:3;grid-row:1;text-align:right;font-weight:700;align-self:start}
    .cl .qtable .q-time{grid-column:1;grid-row:2;font-size:12px;color:#8a8f98}
    .cl .qtable .q-venue{grid-column:2;grid-row:2}
    .cl .qtable .q-size{grid-column:3;grid-row:2;text-align:right;font-size:12px;color:#8a8f98}
    .cl .qtable .q-size::after{content:" contracts"}
    .cl .htable .h-subdate{display:inline}
    .cl .htable .hrow:hover td{background:transparent}
    .cl .htable>tbody>tr.hrow.open{background:rgba(147,197,253,.06)}
    .cl .htable>tbody>tr.hrow.open>td{background:transparent}
    .cl .htable>tbody>tr.hdetail{display:block}
    .cl .htable>tbody>tr.hdetail>td{display:block;padding:8px 4px 14px}
    .cl .hist-filters input[type=search]{max-width:none;flex-basis:100%}
  }
`;

export function StatusPill({ status }) {
  if (!status) return null;
  return (
    <span className={"pill " + status.tone} title={status.hint}>
      <span className="dot" aria-hidden="true" />{status.label}
    </span>
  );
}

export function HowItWorks() {
  return (
    <details className="how">
      <summary><span className="car" aria-hidden="true">▸</span>How Combo Locks works</summary>
      <ol>
        <li>Place a boosted (or free-bet) parlay at your sportsbook, like DraftKings or FanDuel.</li>
        <li>Add the same parlay here with your stake, your odds, and the odds you're willing to sell it at.</li>
        <li>We offer that exact parlay to traders on Kalshi and Polymarket at your price. You can pause any lock, or stop everything with the master switch.</li>
        <li>When a trader takes it, you're hedged: you make money whether the parlay hits or misses. Once the games end, the lock moves to History with your profit or loss.</li>
      </ol>
      <div className="how-foot">
        Statuses: <b>Quoting</b> means we're looking for a buyer. <b>Partly filled</b> means some of it is hedged. <b>Filled</b> means your profit is locked. <b>Paused</b> or <b>Stopped</b> means nothing is being offered.
      </div>
    </details>
  );
}

export function SummaryStrip({ waiting, filled, net, settled, onJump }) {
  const jump = (id) => () => onJump && onJump(id);
  return (
    <div className="stats">
      <button type="button" className="stat" onClick={jump("cl-waiting")}>
        <div className="k">Waiting for a match</div>
        <div className="v">{countText(waiting)}</div>
        <div className="s">being offered now</div>
      </button>
      <button type="button" className="stat" onClick={jump("cl-filled")}>
        <div className="k">Filled</div>
        <div className="v">{countText(filled)}</div>
        <div className="s">waiting on the games</div>
      </button>
      <button type="button" className="stat" onClick={jump("cl-history")}>
        <div className="k">History P/L</div>
        <div className={"v " + (net > 0 ? "pos" : net < 0 ? "neg" : "")}>{settled ? signedDollars(net) : "—"}</div>
        <div className="s">{settled ? `${settled} settled lock${settled === 1 ? "" : "s"}` : "nothing settled yet"}</div>
      </button>
    </div>
  );
}

export function SectionHead({ id, title, count, sub }) {
  return (
    <div className="sec-h" id={id}>
      <h2>{title}</h2>
      {count != null && <span className="cnt">{count}</span>}
      {sub && <div className="sec-sub">{sub}</div>}
    </div>
  );
}

/** Under the original bet: fair odds (always, "—" if unknown) + sportsbook (only if set). */
function BetSub({ summary }) {
  const fair = summary && summary.fair;
  return (
    <>
      <span className="fair" title={fair && fair.source === "legs" ? "Estimated from each leg's fair chance" : "The fair (true) odds saved on this lock"}>Fair odds {fair ? fair.text : "—"}{fair && fair.source === "legs" ? " (est.)" : ""}</span>
      {summary && summary.book ? <span> · {summary.book}</span> : null}
    </>
  );
}

function Fact({ k, v, s, title }) {
  return (
    <div className="fact" title={title}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

export function LegList({ legs }) {
  const rows = (legs || []).filter(Boolean);
  if (!rows.length) return null;
  return (
    <ul className="leglist">
      {rows.map((leg, i) => {
        const p = plainLeg(leg);
        return (
          <li key={i}>
            <span className="lt">{p.typeWord || "Leg"}</span>
            <span>{p.text}</span>
            {p.game ? <span className="lg">{p.game}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function DetailBlock({ title, children }) {
  return (
    <div className="dblock">
      {title ? <div className="dt">{title}</div> : null}
      {children}
    </div>
  );
}

/**
 * The always-visible lock card. Status + legs + the four numbers that matter
 * (your original bet, payout, sell price, how much is hedged) + one profit line.
 * Everything else lives behind Details (children).
 */
export function LockCard({ parlay, status, profile, filled = 0, ceiling, overText = "", open, onToggle, controls, children }) {
  const s = betSummary(parlay) || {};
  const cap = Number(ceiling) > 0 ? Number(ceiling) : Number(parlay && parlay.max_contracts) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round((Number(filled || 0) / cap) * 100)) : 0;
  const pl = profitLine(profile);
  const summaryClick = (e) => { if (shouldToggleFromCard(e)) onToggle(); };
  const summaryKey = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
  };
  return (
    <article className={"lk lk-" + status.key + (open ? " open" : "")} id={"lock-" + parlay.id}>
      <div
        className="lk-sum"
        role="button"
        tabIndex={0}
        aria-expanded={!!open}
        aria-label={(open ? "Hide details for " : "Show details for ") + lockTitle(parlay)}
        onClick={summaryClick}
        onKeyDown={summaryKey}
      >
      <div className="lk-top">
        <StatusPill status={status} />
        <div className="lk-title">{lockTitle(parlay)}</div>
        <div className="lk-ctl" data-no-toggle="">
          {controls}
          <button type="button" className="btn mini" aria-expanded={!!open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {open ? "Hide details ▴" : "Details ▾"}
          </button>
        </div>
      </div>
      <div className="lk-meta">{lockMetaLine(parlay)}</div>
      <div className="lk-facts">
        <Fact k="Your original bet" v={s.betLine} s={<BetSub summary={s} />} />
        <Fact k={s.freeBet ? "Wins if it hits" : "Pays up to"} v={dollars(s.maxPayout)} s={s.freeBet ? "profit only" : "stake included"} />
        <Fact k="Selling at" v={s.sellAt} s="on Kalshi / Polymarket" title="The odds you're offering traders, after your fees." />
        <Fact k="Hedged" v={`${pct}%`} s={cap > 0 ? `${countText(filled)} of ${countText(cap)}${overText} contracts` : "size not set"} />
      </div>
      <div className="bar thin"><div className="bar-fill" style={{ width: pct + "%" }} /></div>
      {pl && (
        <div className={"lk-profit " + pl.tone}>
          <span className="lead">{pl.lead}:</span>
          <span className="val">{pl.text}</span>
        </div>
      )}
      <div className="lk-hint">{status.hint}</div>
      </div>
      {open ? <div className="lk-details">{children}</div> : null}
    </article>
  );
}

const KIND_CHIPS = [
  { key: "all", label: "All" },
  { key: "locked_fill", label: "Hedged" },
  { key: "unfilled", label: "Not hedged" },
  { key: "open", label: "Open" },
];

/** History: totals on top, simple filters, then one clean row per lock. */
export function ComboHistory({ statement, view, archivedById, isOpen, onToggle, renderDetail, onExportCsv, emptyText }) {
  const filtered = view.filtered;
  const lines = (filtered && filtered.lines) || [];
  const t = historyTotals(lines);
  const all = (statement && statement.lines) || [];
  if (!all.length) return <div className="empty">{emptyText}</div>;
  return (
    <div data-section="history">
      <div className="hist-totals">
        <div className="stat">
          <div className="k">Net profit / loss</div>
          <div className={"v " + (t.net > 0 ? "pos" : t.net < 0 ? "neg" : "")}>{t.settled ? signedDollars(t.net) : "—"}</div>
          <div className="s">{t.settled} settled{t.pending ? ` · ${t.pending} still open` : ""}</div>
        </div>
        <div className="stat">
          <div className="k">Record</div>
          <div className="v">{t.wins}–{t.losses}</div>
          <div className="s">profitable – losing locks</div>
        </div>
        <div className="stat">
          <div className="k">Hedged locks</div>
          <div className={"v " + (t.hedgedPnl > 0 ? "pos" : t.hedgedPnl < 0 ? "neg" : "")}>{t.hedgedN ? signedDollars(t.hedgedPnl) : "—"}</div>
          <div className="s">{t.hedgedN} settled</div>
        </div>
        <div className="stat">
          <div className="k">Not hedged</div>
          <div className={"v " + (t.openPnl > 0 ? "pos" : t.openPnl < 0 ? "neg" : "")}>{t.openN ? signedDollars(t.openPnl) : "—"}</div>
          <div className="s">sportsbook bet only</div>
        </div>
      </div>
      <div className="hist-filters" role="group" aria-label="History filters">
        <span className="fl">When</span>
        {STATEMENT_DATE_FILTERS.map((c) => (
          <button key={c.key} type="button" className={"fchip" + (view.dateRange === c.key ? " on" : "")} aria-pressed={view.dateRange === c.key} onClick={() => view.setDateRange(c.key)}>{c.label}</button>
        ))}
        <span className="fl">Show</span>
        {KIND_CHIPS.map((c) => (
          <button key={c.key} type="button" className={"fchip" + (view.kindFilter === c.key ? " on" : "")} aria-pressed={view.kindFilter === c.key} onClick={() => view.setKindFilter(c.key)}>{c.label}</button>
        ))}
        <input type="search" value={view.searchInput} onChange={(e) => view.setSearchInput(e.target.value)} placeholder="Search teams or players" aria-label="Search history" />
        <button type="button" className="btn mini" onClick={onExportCsv} disabled={!lines.length}>Download CSV</button>
      </div>
      {lines.length === 0 ? <div className="empty">No locks match these filters.</div> : (
        <table className="htable">
          <thead><tr><th>Date (ET)</th><th>Parlay</th><th>Your original bet</th><th>Fair odds</th><th>Sold at</th><th>Result</th><th className="r">P/L</th><th aria-hidden="true"></th></tr></thead>
          <tbody>
            {lines.map((line) => {
              const r = historyRow(line, archivedById[line.id]);
              const open = !!isOpen(line.id);
              const toggle = () => onToggle(line.id);
              return (
                <React.Fragment key={line.id}>
                  <tr
                    className={"hrow" + (open ? " open" : "")}
                    id={"lock-" + line.id}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                    aria-label={(open ? "Hide " : "Show ") + r.title}
                    onClick={toggle}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                  >
                    <td className="c-date num" title={r.dateFull}>{r.date || "—"}</td>
                    <td className="c-title">
                      <div className="h-title">{r.title}</div>
                      <div className="h-sub">{r.sports}{r.date ? <span className="h-subdate">{r.sports ? " · " : ""}{r.date}</span> : null}<span className="tag">{r.hedged ? "Hedged" : "Not hedged"}</span></div>
                    </td>
                    <td className="c-bet num"><span className="m-lbl">Your original bet </span>{r.bet}{r.book ? <div className="h-sub">{r.book}</div> : null}</td>
                    <td className="c-fair num"><span className="m-lbl">Fair odds </span>{r.fair}</td>
                    <td className="c-sold num">{r.soldAt}</td>
                    <td className="c-res"><span className={"res " + r.resultTone}>{r.result}</span></td>
                    <td className={"c-pnl h-pnl num " + (r.pnl == null ? "" : r.pnl > 0 ? "pos" : r.pnl < 0 ? "neg" : "")}>{r.pnl == null ? "—" : signedDollars(r.pnl)}</td>
                    <td className="h-car" aria-hidden="true">{open ? "▴" : "▾"}</td>
                  </tr>
                  {open && renderDetail ? (
                    <tr className="hdetail"><td colSpan={8}>{renderDetail(line)}</td></tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VenueTag({ venue, venueKey }) {
  const key = String(venueKey || venue || "").toLowerCase().includes("poly") ? "polymarket" : "kalshi";
  return <span className={"venue " + key}>{venue || (key === "polymarket" ? "Polymarket" : "Kalshi")}</span>;
}

function QuoteSection({ title, rows, sub, ok, empty }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, QUOTE_ROWS_SHOWN);
  const extra = rows.length - shown.length;
  return (
    <div className="qh-sec" data-quotes={ok ? "filled" : "not-filled"}>
      <div className={"qh-h" + (ok ? " ok" : "")}>
        <span>{title}</span><span className="cnt num">{rows.length}</span>
        {sub ? <span className="qh-s">{sub}</span> : null}
      </div>
      {rows.length === 0 ? <div className="empty">{empty}</div> : (
        <table className="qtable">
          <thead><tr><th>Time (ET)</th><th>Price</th><th>Size</th><th>Where</th><th>Result</th></tr></thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.id}>
                <td className="q-time">{q.time}</td>
                <td className="q-price">{q.price}</td>
                <td className="q-size">{q.size}</td>
                <td className="q-venue"><VenueTag venue={q.venue} venueKey={q.venueKey} /></td>
                <td className="q-res">
                  <span className={"res " + q.tone}>{q.result}</span>
                  {q.detail ? <div className="q-det">{q.detail}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > QUOTE_ROWS_SHOWN ? (
        <button type="button" className="btn mini qh-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show ${extra} more`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Details → Quote history for one lock: every quote that FILLED first, then
 * every one that did not (outbid, too slow, not taken, expired, over limit,
 * skipped). `history` is comboLockView.quoteHistory() output.
 */
export function QuoteHistory({ history, note }) {
  if (!history) return null;
  const c = history.filledContracts;
  return (
    <div className="qh">
      {note ? <div className="note">{note}</div> : null}
      <QuoteSection
        title="Filled"
        ok
        rows={history.filled}
        sub={c > 0 ? `${countText(c)} contracts` : ""}
        empty="No fills yet."
      />
      <QuoteSection
        title="Not filled"
        rows={history.notFilled}
        sub="outbid, too slow, not taken, expired or skipped"
        empty="Nothing here. Every request we answered filled."
      />
      {history.addedText ? <div className="qh-foot">Lock added {history.addedText}{history.afterKickoff ? ` · ${history.afterKickoff} request${history.afterKickoff === 1 ? "" : "s"} after the game started not shown` : ""}</div> : null}
    </div>
  );
}

export { etDateTime, fmtAmerican };
