// Combo Locks — private tab for the Kalshi combo RFQ auto-quoter.
// Gated by canSeeComboLocks (OWNER_EMAIL + VITE_COMBO_LOCKS_ALLOWLIST). This
// component returns null for anyone else — no copy that names the feature.
// Backed by Supabase (combo_parlays / combo_settings / combo_submissions) so the
// always-on worker reads the same active parlays. NO live prices — the lock uses
// only the user's own numbers.
// Each card's always-visible desk strip (fill remaining, quoting state, last skip,
// last loss / tape clearing price) is derived in comboDesk.js from the same polls.
// Per-lock history (armed / quoted / skipped / unfilled / filled) reuses Miss-tape
// classification. Matched RFQs lists filled quotes only (combo_fills /
// filled submissions). History itself splits the same way: filled orders,
// then the full attempt tape (quotes, skips, no-takes) so an empty watcher
// combo_matches cannot hide quotes or skips.
// Per-lock submissions fetch quotes/fills separately from game_started noise
// (comboLockSubmissions.js) so midday Polymarket quote_id rows stay visible.
// Risk/profit uses parlay_stake + fill_american + max_contracts.
// Unfilled outcomes: official Kalshi combo ticker, else Kalshi single-game legs,
// else ESPN public scoreboard (/api/espn-scores). Never invents scores.
// History (archived / games-over) uses the P/L Statement board: filters, metric
// cards, quiet lock + P/L rows. One tap expands attempt tape under the row.
// Living cards keep chips + risk profile visible; attempt history starts collapsed (one tap).
// Blank underlying_result rows re-settle on Combo Locks page load / poll — no SQL backfill.
// Probe (Add Parlay) opens a real Kalshi RFQ at max_contracts, waits up to ~8s
// (early-exit on a usable quote), shows best maker NO / implied fill, then
// deletes the RFQ. Never accept/confirm.
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { mapPromoLegsToKalshi, toDatetimeLocalValue, flattenComboGames, formatGameOption, comboGameId, indexComboGames, COMBO_SPORT_ORDER } from "./comboPrefill";
import { applyComboDeskPoll, buildParlayDesk, comboDeskCatchNote, comboDeskChrome, comboListQueryOk, comboSettingsQueryOk, comboSectionKind, comboSettledQuery, COMBO_DESK_RETRY_MS, shouldShowDeskFailure, overFillText, formatLoss, skipLabel, skipReasonOf, formatCents, tapeNoPrice } from "./comboDesk";
import { dataSourceStatus, isSupabaseUnhealthy } from "./dataSourceHealth.js";
import { DataSourceBanner, DataSourceChip } from "./DataSourceStatus.jsx";
import { resolveComboTicker, marketSettlement, historyOutcome } from "./comboSettlement";
import { lockProfile, signedMoney, moneyAbs, hedgeCap, decideAtFill as decideAtFillCore, lockKind, isFreeBetLock } from "./comboLockProfile";
import { buildComboStatement } from "./comboStatement";
import { downloadStatementCsv, useStatementView } from "./StatementBoard";
import { attemptRepeatLabel, attemptSummaryFilled, attemptSummaryParts, buildLockAttempts, filledAttemptEvents, historyFillsEmptyText, matchedRfqCounts, matchedRfqEmptyText, matchedRfqFillRows, matchedRfqMatchedCount, matchedRfqWatcherParked, collapseAttempts, visibleAttempts } from "./comboLockHistory";
import { deskFillCounts, isConfirmedFillSubmission } from "./comboTape";
import { lockSubmissionQueriesForParlays, mergeSubmissionRows } from "./comboLockSubmissions";
import { settleLegs, uniqueEspnQueries, needsUnderlyingStamp, outcomeChrome } from "./comboLegResult";
import { OWNER_EMAIL, canSeeComboLocks, canSeeOwnerTools, comboLockHash } from "./comboAccess";
import { isLockPaused, pauseUpdate, isMissingPausedColumn, pauseToggleTitle, PAUSE_SQL_HINT, bucketReadoutRows, bucketAgeLabel } from "./comboLockPause";
import { absoluteShareUrl, copyTextToClipboard } from "./shareCard";
import { fillBeatsMarket, formatProbeNote, probeDisabled } from "./comboProbe";
import { americanFromNoPrice, etDateTime, etStamp, historyTotals, lockStatus, plainAttemptLabel, plainOutcomeText, fmtAmerican as fmtAmOdds } from "./comboLockView";
import { COMBO_VIEW_CSS, ComboHistory, DetailBlock, HowItWorks, LegList, LockCard, SectionHead, SummaryStrip } from "./ComboLocksView";
import {
  buildMergePlan,
  findDuplicateGroups,
  findMergeTarget,
  formatAmerican,
  formatDollars,
  mergeEconomics,
  sortOriginalBets,
  undoStatus,
} from "./comboMerge";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
export { OWNER_EMAIL };

/* ── engine (mirrors worker engine.js exactly) ── */
// The fill odds you enter are the odds you SELL at AFTER your maker fee — already baked in.
// The lock math uses them directly (no separate fee term). Fees below only recover the nominal
// exchange price and the taker's matched odds (they pay a 7% taker fee, 4× your 1.75% maker fee).
const KFEE = 0.0175;
const TAKER_FEE = 0.07;
const impliedProb = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100));
const americanFromProb = (p) => (!(p > 0 && p < 1) ? null : p < 0.5 ? Math.round((100 * (1 - p)) / p) : -Math.round((100 * p) / (1 - p)));
// Floor to cents so we never quote a no_bid worse than the fill target (user buys NO).
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
function nominalProbFromEff(sEff) {
  const b = 1 - KFEE; // solve KFEE*sNom^2 + (1-KFEE)*sNom - sEff = 0
  return (-b + Math.sqrt(b * b + 4 * KFEE * sEff)) / (2 * KFEE);
}
// Your fill is net of your maker fee. effTaker = the odds the taker is matched at (nominal + their fee).
function fillView(fillAfterFeeAmerican) {
  const sEff = impliedProb(fillAfterFeeAmerican);
  const sNom = nominalProbFromEff(sEff);
  const takerProb = sNom + TAKER_FEE * sNom * (1 - sNom);
  return { sEff, sNom, effTaker: americanFromProb(takerProb), noBid: floor2(1 - sNom).toFixed(2) };
}
// Hedge cap / decide-at-fill live in comboLockProfile (cash + free-bet PnL).
// This wrapper only attaches fillView (maker/taker fee display) for the UI.
function decideAtFill(args) {
  const d = decideAtFillCore(args);
  if (!d.ok) return d;
  const v = fillView(args.fillAmerican);
  return {
    ...d,
    competitive: args.fairAmerican == null ? null : args.fillAmerican >= args.fairAmerican,
    fillAmerican: args.fillAmerican,
    effTakerOdds: v.effTaker,
    quote: { yes_bid: "0.00", no_bid: v.noBid, rest_remainder: false },
  };
}
const MODE_LABEL = {
  riskfree: "Risk-free",
  "1x": "1× pure hedge",
  riskfree_open: "Risk-free (larger orders)",
  "2x": "2× (directional)",
  "3x": "3× (directional)",
};
// Per-lock pause: off = the worker stops quoting this lock (Kalshi + Polymarket) and cancels its
// open quotes. Independent of the kill switch. Fills/history are kept.
function PauseToggle({ parlay, onToggle, busy }) {
  const paused = isLockPaused(parlay);
  return (
    <span className="pl-keep pause-wrap" title={pauseToggleTitle(paused)}>
      <span className="pause-lbl">Active</span>
      <button
        type="button"
        role="switch"
        aria-checked={!paused}
        aria-label={(paused ? "Resume quoting " : "Pause quoting ") + (parlay.label || "lock")}
        className={"pause-sw" + (paused ? "" : " on")}
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); onToggle(parlay.id, !paused); }}
      ><span className="knob" /></button>
    </span>
  );
}

// Read-only Kalshi balances from the combo-worker bucket snapshot (owner only, via /api/combo-bucket).
// Kalshi's app shows main + combo combined; this splits them.
function BucketReadout({ supabase, ready }) {
  const [bucket, setBucket] = useState(null);
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session && session.access_token;
        if (!token) return;
        const r = await fetch("/api/combo-bucket", { headers: { accept: "application/json", authorization: "Bearer " + token } });
        const j = await r.json().catch(() => null);
        if (alive) setBucket(r.ok && j && j.ok ? j.bucket : null);
      } catch (_) { /* readout is optional; keep the last value */ }
    };
    load();
    const t = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, [supabase, ready]);
  const rows = bucketReadoutRows(bucket);
  if (!rows.length) return null;
  const age = bucketAgeLabel(bucket);
  return (
    <div className="bucket-readout num" aria-label="Kalshi balances">
      {rows.map((r) => (
        <span className="bk" key={r.key} title={r.tip}>
          <span className="bk-l">{r.label}</span>
          <span className="bk-v">{r.value}</span>
          <span className="bk-s">{r.sub}</span>
        </span>
      ))}
      <span className={"bk-age" + (bucket.stale ? " stale" : "")} title="Kalshi's app shows Main + Combo combined. Updated by the combo-worker heartbeat.">
        {bucket.stale ? "stale · " : ""}{age}
      </span>
    </div>
  );
}
function CopyLockLink({ lockId }) {
  const [status, setStatus] = useState("");
  if (!lockId) return null;
  return (
    <button
      type="button"
      className="btn mini"
      title={"Copy " + comboLockHash(lockId)}
      onClick={async (e) => {
        e.stopPropagation();
        const url = absoluteShareUrl({
          origin: window.location.origin,
          tab: "combo",
          lockId,
        });
        try {
          const result = await copyTextToClipboard(url);
          setStatus(result === "copied" ? "Copied" : "Failed");
        } catch (_) {
          setStatus("Failed");
        }
        window.setTimeout(() => setStatus(""), 1600);
      }}
    >{status || "Copy link"}</button>
  );
}

// "taker gets" + "fair" header chips. Shared by the Active (0 fills) and Filled (≥1 fill) lock headers so
// a partially-filled lock keeps them — both come from the saved lock (fill_american / fair_american).
function TakerFairChips({ parlay }) {
  const fill = Number(parlay.fill_american);
  const eff = parlay.fill_american != null && parlay.fill_american !== "" && Number.isFinite(fill) && fill !== 0 ? fillView(fill) : null;
  const fair = parlay.fair_american != null && parlay.fair_american !== "" && Number.isFinite(Number(parlay.fair_american)) ? Number(parlay.fair_american) : null;
  const beatsFair = eff && eff.effTaker != null && fair != null && eff.effTaker >= fair;
  return (
    <>
      {eff && eff.effTaker != null && <span className="chip num" title="What the taker is matched at after their 7% fee — this is what they shop on" style={{ background: beatsFair ? "rgba(16,185,129,.15)" : "rgba(255,255,255,0.06)", color: beatsFair ? "#6ee7b7" : "#c3c6cc" }}>Buyer gets {fmtAm(eff.effTaker)} after their fee</span>}
      {fair != null && <span className="chip num" title="Your estimate of the fair price for this parlay.">Fair odds {fmtAm(fair)}</span>}
    </>
  );
}
const BET_TYPE_LABEL = { cash: "cash", boost: "boost", free: "free" };
function formBetType(form) {
  if (lockKind(form) === "freebet") return "free";
  if (form && form.kind === "boost") return "boost";
  return "cash";
}
function betWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
function MergeFigures({ plan }) {
  if (!plan || !plan.ok) return null;
  const econ = plan.economics;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="num">
        Merged: at risk {formatDollars(econ.totalAtRisk)} · win {formatDollars(econ.totalProfit)} · true odds {formatAmerican(econ.trueAmericanExact)} · cap {plan.afterCap} contracts
      </div>
      <ul className="merged-list">
        {econ.parts.map((part, i) => (
          <li key={i} className="num">
            {formatDollars(part.stake)} at {formatAmerican(part.american)} · {BET_TYPE_LABEL[part.type] || part.type}
            {part.sportsbook ? ` · ${part.sportsbook}` : ""}
            {part.boostPct > 0 ? ` · boost ${part.boostPct}%` : ""}
            {part.createdAt ? ` · ${betWhen(part.createdAt)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
function MergedOrder({ parlay, bets, fills, onUndo, busy }) {
  const rows = sortOriginalBets(bets);
  if (!parlay || rows.length < 2) return null;
  const econ = mergeEconomics(rows);
  const status = undoStatus({
    mergedAt: parlay.merged_at,
    fillIdsAtMerge: parlay.merge_fill_ids,
    fills: (fills || []).filter((row) => row.parlay_id === parlay.id),
  });
  return (
    <div style={{ marginTop: 8 }}>
      <span className="chip">Combined from {rows.length} sportsbook bets</span>
      {econ && (
        <div className="num" style={{ fontSize: 13, marginTop: 6 }}>
          At risk {formatDollars(econ.totalAtRisk)} · wins {formatDollars(econ.totalProfit)} · combined odds {formatAmerican(econ.trueAmericanExact)}
        </div>
      )}
      <ul className="merged-list">
        {rows.map((bet) => (
          <li key={bet.id || `${bet.stake}-${bet.american}-${bet.created_at}`} className="num">
            {formatDollars(bet.stake)} at {formatAmerican(bet.american)} · {BET_TYPE_LABEL[bet.bet_type] || bet.bet_type || "cash"}
            {bet.sportsbook ? ` · ${bet.sportsbook}` : " · —"}
            {bet.boost_pct > 0 ? ` · boost ${bet.boost_pct}%` : ""}
            {bet.created_at ? ` · ${betWhen(bet.created_at)}` : ""}
          </li>
        ))}
      </ul>
      {status.ok ? (
        <button type="button" className="btn mini" style={{ marginTop: 6 }} disabled={busy} onClick={() => onUndo(parlay)} title="Split this back into the original bets. A fill after the merge turns this off.">Undo merge</button>
      ) : (
        <div className="note warn">{status.reason}</div>
      )}
    </div>
  );
}
function outcomeChipClass(chrome) {
  if (!chrome) return "settle-wait";
  if (chrome.tone === "win") return "settle-win";
  if (chrome.tone === "lose") return "settle-lose";
  if (chrome.text === "push") return "settle-push";
  return "settle-wait";
}
function outcomeChipTitle(chrome) {
  if (!chrome) return "";
  if (chrome.official) {
    return "Official Kalshi combo-market result. We sold NO, so yes = parlay won (we lost) and no = parlay lost (we won).";
  }
  if (chrome.kind === "awaiting") return "Waiting for Kalshi to determine this combo market.";
  if (chrome.kind === "pending") return "Waiting for official Kalshi single-game results or ESPN final scores. We do not invent scores.";
  if (chrome.sourceText) return `Underlying result from ${chrome.sourceText}. Not an official Kalshi combo ticker.`;
  return "Underlying game result.";
}
function OutcomeChip({ out, filled }) {
  const chrome = outcomeChrome(out, { filled });
  if (!chrome) return null;
  const title = outcomeChipTitle(chrome);
  return (
    <span className="outcome-pair">
      <span className={"chip " + outcomeChipClass(chrome)} title={title + (chrome.sourceText ? ` Source: ${chrome.sourceText}.` : "")}>{plainOutcomeText(chrome.text)}</span>
    </span>
  );
}
function RiskProfile({ parlay, filled }) {
  const profile = lockProfile(parlay, filled);
  if (!profile.current) return null;
  const standingLocked = profile.filled > 0 && !(profile.current.miss < 0);
  const freeBet = profile.current.kind === "freebet";
  const missTone = profile.current.miss < 0 ? "neg" : "pos";
  return (
    <div className="profile">
      <div className="tile">
        <div className="k">{profile.filled > 0 ? "Right now (with fills)" : "Right now (not hedged)"}</div>
        <div className="v num">
          {standingLocked ? (
            <>
              <span className="pos">{signedMoney(profile.current.hit)}</span>
              {" / "}
              <span className="pos">{signedMoney(profile.current.miss)}</span>
            </>
          ) : freeBet ? (
            <>
              <span className="pos">{((profile.current.conversionRate || 0) * 100).toFixed(1)}%</span>
              <span className="muted"> conversion · </span>
              <span className="pos">{moneyAbs(profile.current.unhedgedUpside ?? profile.current.profit)}</span>
              <span className="muted"> unhedged upside</span>
            </>
          ) : (
            <>
              <span className="muted">risk </span>
              <span className="neg">{moneyAbs(profile.current.risk)}</span>
              <span className="muted"> for </span>
              <span className="pos">{moneyAbs(profile.current.profit)}</span>
              <span className="muted"> profit</span>
            </>
          )}
        </div>
        <div className="sub">
          If it hits <span className="pos">{signedMoney(profile.current.hit)}</span>
          {" · "}
          if it loses <span className={missTone}>{signedMoney(profile.current.miss)}</span>
        </div>
      </div>
      <div className="tile">
        <div className="k">When fully hedged</div>
        {profile.target ? (
          <>
            <div className={"v num " + (profile.target.locks ? "pos" : "neg")}>{signedMoney(profile.target.hit)} / {signedMoney(profile.target.miss)}</div>
            <div className="sub">{profile.target.contracts.toLocaleString("en-US")} contracts · {profile.target.locks ? "profit locked either way" : "doesn't fully lock"}</div>
          </>
        ) : (
          <>
            <div className="v num" style={{ color: "#fcd34d" }}>Not set yet</div>
            <div className="sub">Add your sell odds and a size to see the locked profit.</div>
          </>
        )}
      </div>
      <div className="tile">
        <div className="k">Hedged so far</div>
        <div className="v num">{profile.targetTbd ? "Not set yet" : `${profile.filled.toLocaleString("en-US")} of ${Number(profile.targetContracts).toLocaleString("en-US")} contracts`}</div>
        <div className="sub">
          {profile.filled > 0 && profile.soFar
            ? `so far ${signedMoney(profile.soFar.hit)} / ${signedMoney(profile.soFar.miss)}`
            : (isFreeBetLock(parlay) ? "Nothing filled yet. It's still just your free bet." : "Nothing filled yet. It's still just your sportsbook bet.")}
        </div>
      </div>
    </div>
  );
}
const ATTEMPT_COLOR = {
  armed: "#93c5fd", created: "#93c5fd", quoted: "#93c5fd",
  skipped: "#fcd34d", cancelled: "#fca5a5", expired: "#9aa3b2",
  unfilled: "#fcd34d", filled: "#6ee7b7",
};
function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue || "—"}</span>;
}
function AttemptSummary({ attempts }) {
  const parts = attemptSummaryParts(attempts);
  if (!parts.skip && !parts.miss) return null;
  return (
    <>
      {parts.skip && (
        <span
          className={"chip num hist-sum " + (attemptSummaryFilled(attempts) ? "ok" : "warn")}
          title="Miss-tape skips — Kalshi and Polymarket"
        >{plainAttemptLabel(parts.skip)}</span>
      )}
      {parts.miss && (
        <span
          className="chip num hist-sum warn"
          title="Quoted misses — posted, no take. Kalshi and Polymarket"
        >{plainAttemptLabel(parts.miss)}</span>
      )}
    </>
  );
}
function AttemptRows({ events }) {
  return (
    <div className="tbl-wrap"><table><thead><tr><th>Time (ET)</th><th>What happened</th><th>Size</th><th>Where</th></tr></thead>
      <tbody>{events.map((e, i) => (
        <tr key={(e.at || e.key) + "-" + e.reason + "-" + i}>
          <td>{e.count > 1
            ? <span className="hist-rpt" title={`${e.count} identical attempts`}>{attemptRepeatLabel(e)}</span>
            : etStamp(e.at)}</td>
          <td style={{ color: ATTEMPT_COLOR[e.key] || "#c3c6cc" }}>{plainAttemptLabel(e.label)}</td>
          <td className="num">{e.contracts != null ? e.contracts : "—"}</td>
          <td><VenueChip venue={e.venue} venueKey={e.venueKey} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
function AttemptHistory({ attempts, open = true, onToggle, showSummary = true }) {
  if (!attempts) return null;
  const { shown, extra } = visibleAttempts(attempts.events);
  const fillEvents = collapseAttempts(filledAttemptEvents(attempts));
  const fillsEmpty = historyFillsEmptyText(attempts);
  const toggleable = typeof onToggle === "function";
  const expanded = toggleable ? !!open : true;
  const heading = "Activity";
  const summary = showSummary ? <AttemptSummary attempts={attempts} /> : null;
  const body = (
    <>
      <div className="hist-sub">{(() => { const c = matchedRfqCounts(attempts); return c.filled > 0 ? `Fills · ${c.filled} order${c.filled === 1 ? "" : "s"}${c.contracts > 0 ? ` · ${c.contracts} contracts` : ""}` : "Fills"; })()}</div>
      {fillEvents.length === 0 ? <div className="empty">{plainAttemptLabel(fillsEmpty).replace(/see History and the fill bar|see the fill bar/, "see the Hedged bar")}</div> : <AttemptRows events={fillEvents} />}
      <div className="hist-sub">Every offer and skip</div>
      {summary && !toggleable ? <div className="hist-static" style={{ marginTop: 0 }}>{summary}</div> : null}
      {shown.length === 0 ? <div className="empty">Nothing yet.</div> : <AttemptRows events={shown} />}
      {extra > 0 && <div className="empty">Showing newest {shown.length} rows. {extra} older omitted.</div>}
    </>
  );
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
      {toggleable ? (
        <button
          type="button"
          className="hist-head"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "Hide activity" : "Show every offer, skip and fill for this lock"}
        >
          <span className="arch-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <span>{heading}</span>
          {summary}
          <span className="chip hist-toggle">{expanded ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      {expanded ? body : null}
    </div>
  );
}
function DeskChips({ desk, thin }) {
  if (!desk) return null;
  const skip = thin ? (desk.relevant && desk.relevant.kind === "skip" ? desk.relevant : null) : desk.skip;
  const loss = thin ? (desk.relevant && desk.relevant.kind === "loss" ? desk.relevant : null) : desk.loss;
  if (!skip && !loss && !(desk.awaiting && !thin)) return null;
  return (
    <div className={"desk" + (thin ? " thin" : "")}>
      {desk.awaiting && !thin && <span className="chip" style={{ background: "rgba(147,197,253,.18)", color: "#93c5fd" }} title="An offer is out for this parlay, but no buyer has taken it yet.">Offer out · waiting for a buyer</span>}
      {skip && <span className="chip skip num" title="Matched RFQ the worker did not quote. Oversized RFQs are skipped (Kalshi makers cannot partial-fill).">Last skip: {plainAttemptLabel(skip.text)}</span>}
      {loss && <span className="chip loss num" title="Last lost quote. Tape-matched no_purchase / outbid rows show the inferred clearing price.">Last miss: {plainAttemptLabel(loss.text)}</span>}
    </div>
  );
}
function matchedRfqOutcome(row, oc, skip) {
  const outMap = { executed: ["#6ee7b7", "filled"], accepted: ["#93c5fd", "accepted"], lost: ["#fca5a5", "lost"], posted: ["#9aa3b2", "awaiting"] };
  if (oc) return outMap[oc.outcome] || ["#c3c6cc", oc.outcome];
  if (row && row.bucket === "filled") return ["#6ee7b7", "filled"];
  if (row && row.bucket === "awaiting") return ["#93c5fd", row.reason === "open" ? "quoted · rested" : "awaiting"];
  if (row && (row.bucket === "outbid" || row.bucket === "too_slow" || row.bucket === "lost" || row.bucket === "no_taker")) {
    const label = row.reason === "quoted · no take" ? "quoted · no take"
      : row.reason === "cancelled" ? "cancelled"
        : row.reason || "lost";
    return ["#fca5a5", label];
  }
  if (skip && skip.kind === "oversized") return ["#fcd34d", skip.text];
  if (skip) return ["#6b7280", skip.text];
  if (row && (row.bucket === "skipped" || row.bucket === "oversized")) {
    return [row.bucket === "oversized" ? "#fcd34d" : "#6b7280", row.reason || "skipped"];
  }
  return ["#6b7280", (row && (row.reason || row.bucket)) || "skipped"];
}

// Venue chip uses tape row venue / venueKey from comboTape.inferRfqVenue
// (combo_submissions.venue when the worker writes kalshi | polymarket).
function MatchedRfqTable({ attempts, matches, submissions, outcomeByRfq = {}, desk }) {
  const counts = matchedRfqCounts(attempts);
  const tapeRows = matchedRfqFillRows(attempts);
  const fillCtx = desk ? { filled: desk.fill.filled, ceiling: desk.fill.ceiling, hedgeCap: desk.fill.ceiling } : {};
  const matchByRfq = {};
  (matches || []).forEach((m) => { if (m && m.rfq_id) matchByRfq[m.rfq_id] = m; });
  const subByRfq = {};
  (submissions || []).forEach((s) => { if (s && s.rfq_id) subByRfq[s.rfq_id] = s; });
  const parked = matchedRfqWatcherParked(matches, attempts);
  const empty = matchedRfqEmptyText(attempts);
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#6b7280", marginBottom: 6 }}>
        Matched requests{counts.filled ? ` · ${counts.filled} filled` : ""}
      </div>
      {parked ? (
        <div className="empty" style={{ paddingTop: 0, paddingBottom: 6 }}>The request watcher is paused. Fills below still come straight from your account.</div>
      ) : null}
      {counts.filled === 0 ? <div className="empty">{plainAttemptLabel(empty).replace("in History", "under Activity").replace(/see History and the fill bar/, "see the Hedged bar")}</div> : (
        <div className="tbl-wrap"><table><thead><tr><th>Time (ET)</th><th>Where</th><th>Size</th><th>Locks profit?</th><th>Worst case</th><th>You offered</th><th>Outcome</th><th>Notes</th></tr></thead>
          <tbody>{tapeRows.map((row) => {
            const m = (row.rfqId && matchByRfq[row.rfqId]) || null;
            const oc = (row.rfqId && outcomeByRfq[row.rfqId]) || row.outcome || null;
            const twin = (row.rfqId && subByRfq[row.rfqId]) || row.submission || null;
            const contracts = (m && m.contracts != null) ? m.contracts : row.contracts;
            const req = m && m.sizing === "dollar" ? `$${m.target_dollars} (dollar)` : `${contracts != null ? contracts : "—"} contracts`;
            const locks = m ? m.locks : null;
            const lockable = locks === true ? "Yes" : locks === false ? "No" : "—";
            const worst = (m && m.worst != null) ? m.worst : (twin && twin.worst_lock != null ? twin.worst_lock : null);
            const skip = !oc ? skipLabel({
              ...(m || {}),
              ...(twin || {}),
              skip_reason: skipReasonOf(twin) || skipReasonOf(m) || skipReasonOf(row),
              contracts,
            }, fillCtx) : null;
            const [ocCol, ocLbl] = matchedRfqOutcome(row, oc, skip);
            const why = oc && oc.outcome === "lost" ? (formatLoss(oc) || "checking…")
              : (skip && skip.kind === "oversized" ? "cannot partial-fill" : (row.reason && row.reason !== ocLbl ? row.reason : ""));
            const tape = oc ? formatCents(tapeNoPrice(oc)) : (row.tapeNo != null ? formatCents(row.tapeNo) : null);
            const quotedNo = oc && oc.submitted_no_bid != null ? oc.submitted_no_bid
              : (oc && oc.no_bid != null ? oc.no_bid : row.ourNo);
            const speed = oc && oc.responded_ms != null ? `${(oc.responded_ms / 1000).toFixed(1)}s${oc.rfq_lifetime_ms != null ? `/${(oc.rfq_lifetime_ms / 1000).toFixed(1)}s` : ""}` : "";
            const tapeAm = tape ? americanFromNoPrice(parseFloat(tape) / 100) : null;
            const whyBits = [plainAttemptLabel(why), tapeAm != null && oc && oc.outcome === "lost" && !String(why).includes("¢") ? `market ${fmtAmOdds(tapeAm)}` : "", speed].filter(Boolean);
            return (
              <tr key={row.rfqId || row.fillId || `${row.at}-${row.contracts}`}>
                <td>{etStamp(row.at)}</td>
                <td><VenueChip venue={row.venue} venueKey={row.venueKey} /></td>
                <td className="num">{req}</td>
                <td className="num" style={{ color: locks === true ? "#6ee7b7" : locks === false ? "#fcd34d" : "#6b7280" }}>{lockable}</td>
                <td className="num">{worst != null ? money(worst) : "—"}</td>
                <td className="num">{quotedNo != null ? fmtAmOdds(americanFromNoPrice(quotedNo)) : "—"}</td>
                <td style={{ color: ocCol }}>{plainAttemptLabel(ocLbl)}</td>
                <td style={{ color: "#8a8f98" }}>{whyBits.join(" · ")}</td>
              </tr>
            );
          })}</tbody></table></div>
      )}
    </div>
  );
}

/* ── sample games fallback (same shape the /api/kalshi-games feed returns) ── */
const gSide = (tk, label) => ({ ticker: tk, side: "yes", label });
const gTot = (tk, line) => [{ ticker: tk, side: "yes", label: `Over ${line}` }, { ticker: tk, side: "no", label: `Under ${line}` }];
const gSpr = (tk, fav, dog, line) => [{ ticker: tk, side: "yes", label: `${fav} −${line}` }, { ticker: tk, side: "no", label: `${dog} +${line}` }];
const sampleGame = (key, ka, kb, A, B, series = { side: "KXMLBGAME", spread: "KXMLBSPREAD", total: "KXMLBTOTAL" }, lines = ["1.5", "2.5"], totals = ["6.5", "7.5", "8.5", "9.5"]) => ({
  key, title: `${A} vs ${B}`, date: `${ka} vs ${kb}`,
  markets: {
    side: [gSide(`${series.side}-${key}-${ka}`, A), gSide(`${series.side}-${key}-${kb}`, B)],
    spread: [
      ...gSpr(`${series.spread}-${key}-${ka}2`, A, B, lines[0]),
      ...(lines[1] ? gSpr(`${series.spread}-${key}-${ka}3`, A, B, lines[1]) : []),
      ...gSpr(`${series.spread}-${key}-${kb}2`, B, A, lines[0]),
    ],
    total: totals.flatMap((line, i) => gTot(`${series.total}-${key}-${Math.floor(Number(line))}`, line)),
  },
});
const NFL_SERIES = { side: "KXNFLGAME", spread: "KXNFLSPREAD", total: "KXNFLTOTAL" };
const NCAAF_SERIES = { side: "KXNCAAFGAME", spread: "KXNCAAFSPREAD", total: "KXNCAAFTOTAL" };
const NHL_SERIES = { side: "KXNHLGAME", spread: "KXNHLSPREAD", total: "KXNHLTOTAL" };
const SAMPLE = { comboCollection: "KXMVESPORTSMULTIGAMEEXTENDED-R", sample: true, sports: {
  mlb: [
    sampleGame("26AUG071905PHIATL", "PHI", "ATL", "Philadelphia", "Atlanta"),
    sampleGame("26AUG071905NYMWSH", "NYM", "WSH", "New York M", "Washington"),
    sampleGame("26AUG071905NYYBOS", "NYY", "BOS", "New York Y", "Boston"),
  ],
  nfl: [
    sampleGame("26SEP09NESEA", "NE", "SEA", "New England", "Seattle", NFL_SERIES, ["3.5", "6.5"], ["42.5", "45.5"]),
  ],
  ncaaf: [
    sampleGame("26SEP03MASSRUTG", "MASS", "RUTG", "UMass", "Rutgers", NCAAF_SERIES, ["35.5"], ["49.5", "52.5"]),
  ],
  nhl: [
    sampleGame("26OCT07PITPHI", "PHI", "PIT", "Philadelphia", "Pittsburgh", NHL_SERIES, ["1.5", "2.5"], ["5.5", "6.5", "7.5"]),
  ],
} };
const TYPE_LABEL = { side: "Side (moneyline)", spread: "Spread (alt lines)", total: "Total (alt over/unders)", prop: "Player props (MLB 1+ HR / NFL anytime TD / NHL 1+ Goal)" };
const encVal = (t, s) => `${t}|${s}`;
const decValFn = (v) => { const i = v.lastIndexOf("|"); return i < 0 ? [v, "yes"] : [v.slice(0, i), v.slice(i + 1)]; };
const DEFAULT_FORM = { stake: 100, boost: 2000, fill: 1200, fair: 1000, mode: "1x", kind: "cash", starts: "", label: "", labelEdited: false, sportsbook: "", boostPct: "" };
const emptyLegRows = (n) => Array.from({ length: Math.max(2, n || 2) }, (_, i) => ({ id: i + 1, gameKey: "", marketVal: "" }));
function formFromPrefill(prefill) {
  if (!prefill) return { ...DEFAULT_FORM };
  return {
    stake: prefill.stake ?? DEFAULT_FORM.stake,
    boost: prefill.boost ?? DEFAULT_FORM.boost,
    fill: prefill.fill ?? "",
    fair: prefill.fair == null || prefill.fair === "" ? "" : prefill.fair,
    mode: prefill.mode || "1x",
    kind: prefill.kind === "boost" ? "boost" : lockKind(prefill),
    sportsbook: prefill.sportsbook || "",
    boostPct: prefill.boostPct ?? prefill.boost_pct ?? "",
    starts: toDatetimeLocalValue(prefill.starts),
    label: prefill.label || "",
    labelEdited: true,
  };
}
const fmtAm = (a) => (a == null ? "—" : a > 0 ? "+" + a : "" + a);
const money = (v) => (v < 0 ? "-$" : "+$") + Math.abs(Number(v)).toFixed(2);
// A parlay auto-moves to History this many hours after its game start — still
// only an archive heuristic. Settlement copy on filled/history cards comes from
// the official Kalshi combo market result, not this clock.
const HISTORY_BUFFER_HOURS = 6;
const historyMoveAt = (startsAtIso) => (startsAtIso ? new Date(new Date(startsAtIso).getTime() + HISTORY_BUFFER_HOURS * 3600 * 1000) : null);

export default function ComboLocks({ user, prefill = null, focusLockId = null }) {
  const [games, setGames] = useState(SAMPLE);
  const [srcLive, setSrcLive] = useState(false);
  const [parlays, setParlays] = useState([]);
  const [kill, setKill] = useState(false);
  const [deskLoading, setDeskLoading] = useState(true); // first settings+parlays fetch
  const [deskReady, setDeskReady] = useState(false);
  const [deskError, setDeskError] = useState(null);
  const [sourceUnhealthy, setSourceUnhealthy] = useState(false);
  const [deskHealthError, setDeskHealthError] = useState(null);
  const parlaysRef = useRef([]);
  const killRef = useRef(false);
  const parlaysReadyRef = useRef(false);
  const settingsReadyRef = useRef(false);
  const [history, setHistory] = useState([]);
  const [archived, setArchived] = useState([]);
  const [realFills, setRealFills] = useState({}); // parlay_id -> real contracts filled (from Kalshi account)
  const filledSubsRef = useRef([]); // last confirmed-fill submissions (kept if a poll's query fails)
  const [quoted, setQuoted] = useState({});       // parlay_id -> contracts the worker quoted (from combo_submissions)
  const [realUnattr, setRealUnattr] = useState(0);// real combo fills we couldn't tie to a specific parlay
  const [matchCounts, setMatchCounts] = useState({}); // parlay_id -> { n, locks_n, dollar_n, last_match }
  const [outcomes, setOutcomes] = useState([]);   // recent quote_outcomes rows (accepted/executed/lost)
  const [submissions, setSubmissions] = useState([]); // quoted / skipped / unfilled rows (combo ticker)
  const [comboFills, setComboFills] = useState([]); // combo_fills rows — History ticker without a persist yet
  const [originalBets, setOriginalBets] = useState([]);
  const [mergePrompt, setMergePrompt] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [dismissedDupes, setDismissedDupes] = useState({});
  const [matchesByParlay, setMatchesByParlay] = useState({}); // parlay_id -> [combo_matches rows]
  const [openParlays, setOpenParlays] = useState({});         // id / hist-<id> / arch-<id> -> expanded?
  const [legRows, setLegRows] = useState(() => emptyLegRows(prefill?.legs?.length));
  const [form, setForm] = useState(() => formFromPrefill(prefill));
  const [sim, setSim] = useState({ parlayId: "", size: 2000, result: null });
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState(null);
  const [gamesReady, setGamesReady] = useState(false);
  const [prefillWarning, setPrefillWarning] = useState(null);
  const createFormRef = useRef(null);
  const appliedNonceRef = useRef(null);
  const settleInflight = useRef(false);
  const [liveSettlement, setLiveSettlement] = useState({}); // parlay_id -> { result, status, ticker } from Kalshi this session

  const gameList = useMemo(() => flattenComboGames(games.sports), [games]);
  const gameIdx = useMemo(() => indexComboGames(games.sports), [games]);
  const owner = canSeeComboLocks(user);

  const loadGames = useCallback(async () => {
    try { const r = await fetch("/api/kalshi-games", { headers: { accept: "application/json" } });
      if (!r.ok) throw 0; const d = await r.json();
      const n = COMBO_SPORT_ORDER.reduce((acc, s) => acc + ((d.sports && d.sports[s]) || []).length, 0);
      if (d && d.sports && n) { setGames(d); setSrcLive(true); setGamesReady(true); return; }
    } catch (_) {}
    setGames(SAMPLE); setSrcLive(false); setGamesReady(true);
  }, []);
  const refreshSettlements = useCallback(async ({ living, archived, fills, outcomes, matchesByParlay, submissions, filledById }) => {
    if (settleInflight.current) return;
    const tickerOf = (row) => resolveComboTicker({
      parlay: row,
      fills,
      outcomes,
      matches: (matchesByParlay && matchesByParlay[row.id]) || [],
      submissions,
    });
    const candidates = [];
    const foundTickers = [];
    (living || []).forEach((row) => {
      if (!row) return;
      const ticker = tickerOf(row);
      if (ticker && !row.combo_ticker) foundTickers.push({ row, ticker });
      if (row.kalshi_result === "yes" || row.kalshi_result === "no") return;
      if (!((filledById && filledById[row.id]) > 0)) return;
      if (ticker) candidates.push({ row, ticker });
    });
    (archived || []).forEach((row) => {
      if (!row) return;
      const ticker = tickerOf(row);
      if (ticker && !row.combo_ticker) foundTickers.push({ row, ticker });
      if (row.kalshi_result === "yes" || row.kalshi_result === "no") return;
      if (ticker) candidates.push({ row, ticker });
    });
    const needUnderlying = [];
    [...(living || []), ...(archived || [])].forEach((row) => {
      if (needsUnderlyingStamp(row)) needUnderlying.push(row);
    });
    // Unfilled locks often have no combo ticker. Still stamp risk won / risk lost
    // from Kalshi single-game legs or ESPN — do not wait for a combo market.
    if (!candidates.length && !foundTickers.length && !needUnderlying.length) return;
    const tickers = [...new Set(candidates.map((c) => c.ticker))];
    settleInflight.current = true;
    try {
      const livePatch = {};
      const rowPatch = {};
      const stampTicker = ({ row, ticker }) => {
        if (!ticker || row.combo_ticker || (rowPatch[row.id] && rowPatch[row.id].combo_ticker)) return;
        rowPatch[row.id] = { ...(rowPatch[row.id] || {}), combo_ticker: ticker };
      };
      foundTickers.forEach(stampTicker);
      candidates.forEach(stampTicker);
      if (tickers.length) {
        const r = await fetch("/api/kalshi-games?tickers=" + encodeURIComponent(tickers.join(",")), { headers: { accept: "application/json" } });
        if (r.ok) {
          const d = await r.json();
          const markets = (d && d.markets) || {};
          for (const { row, ticker } of candidates) {
            const m = markets[ticker];
            if (!m) continue;
            const official = marketSettlement(m);
            if (!official) continue;
            const next = rowPatch[row.id] || {};
            next.kalshi_result = official.result;
            next.kalshi_status = m.status || null;
            next.settled_at = new Date().toISOString();
            rowPatch[row.id] = next;
            livePatch[row.id] = { result: official.result, status: m.status, ticker };
          }
        }
      }
      if (needUnderlying.length) {
        const started = needUnderlying.filter((p) => {
          if (!p.starts_at) return true;
          const t = Date.parse(p.starts_at);
          return !Number.isFinite(t) || t <= Date.now();
        });
        const tickerRows = started.length ? started : needUnderlying;
        const tickers = [...new Set(tickerRows.flatMap((p) => (p.legs || []).map((l) => l && l.ticker).filter(Boolean)))].slice(0, 50);
        const markets = {};
        for (let i = 0; i < tickers.length; i += 25) {
          const batch = tickers.slice(i, i + 25);
          const ur = await fetch("/api/kalshi-games?tickers=" + encodeURIComponent(batch.join(",")), { headers: { accept: "application/json" } });
          if (ur.ok) {
            const d = await ur.json();
            Object.assign(markets, (d && d.markets) || {});
          }
        }
        let espnGames = [];
        const queries = uniqueEspnQueries(started).slice(0, 12);
        if (queries.length) {
          try {
            const er = await fetch("/api/espn-scores?queries=" + encodeURIComponent(queries.map((q) => q.sport + ":" + q.date).join(",")), { headers: { accept: "application/json" } });
            if (er.ok) {
              const d = await er.json();
              espnGames = (d && d.games) || [];
            }
          } catch (_) {}
        }
        for (const row of needUnderlying) {
          const settled = settleLegs({ legs: row.legs, kalshiMarkets: markets, espnGames });
          if (settled.outcome !== "won" && settled.outcome !== "lost" && settled.outcome !== "push") continue;
          const src = settled.source === "espn" || settled.source === "kalshi_legs" ? settled.source : null;
          if (!src) continue;
          const next = rowPatch[row.id] || {};
          next.underlying_result = settled.outcome;
          next.underlying_source = src;
          next.underlying_settled_at = new Date().toISOString();
          next.leg_results = settled.legs;
          rowPatch[row.id] = next;
        }
      }
      for (const [id, next] of Object.entries(rowPatch)) {
        if (!next || !Object.keys(next).length) continue;
        await supabase.from("combo_parlays").update(next).eq("id", id);
      }
      if (Object.keys(livePatch).length) setLiveSettlement((prev) => ({ ...prev, ...livePatch }));
      if (Object.keys(rowPatch).length) {
        const apply = (list) => (list || []).map((p) => (rowPatch[p.id] ? { ...p, ...rowPatch[p.id] } : p));
        setParlays((prev) => apply(prev));
        setArchived((prev) => apply(prev));
      }
    } catch (_) {
      // Keep awaiting settlement; next 20s poll retries.
    } finally {
      settleInflight.current = false;
    }
  }, []);
  const deskFailStreakRef = useRef(0);
  const loadDesk = useCallback(async () => {
    if (!owner) return;
    try {
      const settled = await Promise.allSettled([
        // All LIVING parlays (not yet archived), whether the worker is actively watching them
        // (active=true) or paused after recording a quote (active=false). Loading both means a
        // parlay can never fall through the gap between the Active and History lists again.
        supabase.from("combo_parlays").select("*").eq("user_id", user.id).is("archived_at", null).order("created_at", { ascending: false }),
        supabase.from("combo_settings").select("kill_switch").eq("user_id", user.id).maybeSingle(),
        supabase.from("combo_submissions").select("*").eq("user_id", user.id).neq("status", "shadow").or("quote_id.not.is.null,order_id.not.is.null,status.in.(filled,unfilled,quoted)").order("created_at", { ascending: false }).limit(80),
        supabase.from("combo_parlays").select("*").eq("user_id", user.id).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100),
        // REAL fills, straight from the account (via the read-only fills reader), maker + combo only.
        supabase.from("combo_fills").select("parlay_id,count,is_combo,is_taker,ticker,raw,fill_id,order_id,kalshi_created_time,recorded_at,no_price,yes_price").eq("user_id", user.id).eq("is_combo", true).eq("is_taker", false),
        // QUOTED contracts the worker recorded on post — for the quoted-vs-filled comparison.
        supabase.from("combo_submissions").select("parlay_id,contracts,status,is_live,order_id,venue,created_at").eq("user_id", user.id).or("status.eq.filled,is_live.eq.true").order("created_at", { ascending: false }),
        // How many RFQs matched each parlay (from the read-only watcher).
        supabase.from("combo_match_counts").select("*"),
        // What happened to each quote we posted (accepted / executed / lost + latency + fill reconcile).
        supabase.from("quote_outcomes").select("*").order("updated_at", { ascending: false }).limit(200),
        // Every RFQ that matched a parlay — for the per-lock drilldown.
        supabase.from("combo_matches").select("*").order("matched_at", { ascending: false }).limit(400),
      ]);
      const [parlaysRaw, settingsRaw, historyRes, archivedRes, fillsRes, bookedRes, mcRes, ocRes, mrowsRes] = settled.map(comboSettledQuery);
      // The locks + kill-switch reads are the only ones that can raise the banner. A transient failure
      // (dropped connection, gateway blip) gets ONE retry before it counts.
      let parlaysRes = parlaysRaw;
      let settingsRes = settingsRaw;
      if (!comboListQueryOk(parlaysRes) || !comboSettingsQueryOk(settingsRes)) {
        await new Promise((resolve) => setTimeout(resolve, COMBO_DESK_RETRY_MS));
        const [pRetry, sRetry] = await Promise.allSettled([
          comboListQueryOk(parlaysRes) ? Promise.resolve(parlaysRes) : supabase.from("combo_parlays").select("*").eq("user_id", user.id).is("archived_at", null).order("created_at", { ascending: false }),
          comboSettingsQueryOk(settingsRes) ? Promise.resolve(settingsRes) : supabase.from("combo_settings").select("kill_switch").eq("user_id", user.id).maybeSingle(),
        ]);
        parlaysRes = comboSettledQuery(pRetry);
        settingsRes = comboSettledQuery(sRetry);
      }
      const poll = applyComboDeskPoll({
        parlaysRes,
        settingsRes,
        prevParlays: parlaysRef.current,
        prevKill: killRef.current,
        parlaysReady: parlaysReadyRef.current,
        settingsReady: settingsReadyRef.current,
      });
      if (poll.applyParlays) {
        parlaysRef.current = poll.parlays;
        setParlays(poll.parlays);
      }
      if (poll.applyKill) {
        killRef.current = poll.kill;
        setKill(poll.kill);
      }
      parlaysReadyRef.current = poll.parlaysReady;
      settingsReadyRef.current = poll.settingsReady;
      setDeskReady(poll.deskReady);
      // Only warn after consecutive failed polls (the desk keeps its last known data meanwhile).
      deskFailStreakRef.current = poll.failed ? deskFailStreakRef.current + 1 : 0;
      const showDeskFailure = shouldShowDeskFailure({ failed: poll.failed, streak: deskFailStreakRef.current, hadReady: !!(parlaysReadyRef.current || settingsReadyRef.current) });
      setDeskError(showDeskFailure ? poll.errorNote : null);
      setSourceUnhealthy(showDeskFailure && !!poll.sourceUnhealthy);
      setDeskHealthError(showDeskFailure ? (poll.healthError || null) : null);

      // Everything below is secondary (history, fills, matches, per-lock attempts, settlement stamping).
      // locks + kill-switch already loaded above, so a failure here must NOT raise the
      // "Couldn't refresh locks / kill-switch" banner — it keeps the last known values and the next poll retries.
      try {
      const takeList = (res) => (comboListQueryOk(res) ? res.data : null);
      const historyRows = takeList(historyRes);
      if (historyRows) setHistory(historyRows);
      const archivedRows = takeList(archivedRes);
      if (archivedRows) setArchived(archivedRows);
      const betsRes = await supabase.from("combo_parlay_bets").select("*").eq("user_id", user.id);
      if (!betsRes.error && Array.isArray(betsRes.data)) setOriginalBets(betsRes.data);
      const mcRows = takeList(mcRes);
      if (mcRows) {
        const mcMap = {};
        mcRows.forEach((r) => { mcMap[r.parlay_id] = r; });
        setMatchCounts(mcMap);
      }
      const ocRows = takeList(ocRes);
      if (ocRows) setOutcomes(ocRows);
      const fillRows = takeList(fillsRes);
      if (fillRows) setComboFills(fillRows);
      const bookedRows = takeList(bookedRes);
      if (bookedRows) {
        const q = {};
        bookedRows.forEach((b) => { q[b.parlay_id] = (q[b.parlay_id] || 0) + Number(b.contracts || 0); });
        setQuoted(q);
        // Confirmed-fill submissions (status=filled) fill the one gap combo_fills can have: a stamped
        // order_id whose combo_fills row is still unattributed. Unwindowed on purpose — the per-lock
        // History window (newest 400 rows) must not change the fill count between polls.
        filledSubsRef.current = bookedRows.filter(isConfirmedFillSubmission);
      }
      // ONE fills write per poll, from combo_fills (+ confirmed submissions). It used to be written
      // twice (fills only, then fills + a windowed submission sample) so the bar flipped every poll.
      const summed = fillRows ? deskFillCounts(fillRows, filledSubsRef.current) : null;
      if (summed) {
        setRealFills(summed.byParlay);
        setRealUnattr(summed.unattributed);
      }
      const matchRows = takeList(mrowsRes);
      const mbp = {};
      if (matchRows) {
        matchRows.forEach((m) => { (mbp[m.parlay_id] = mbp[m.parlay_id] || []).push(m); });
        setMatchesByParlay(mbp);
      }

      if (!poll.applyParlays) return;
      const livingRows = poll.parlays;
      const archivedForSubs = archivedRows || [];
      // Per-lock attempts: quotes/fills and noisy skips are separate queries so
      // a game_started flood cannot hide midday Polymarket quote_id rows.
      const archivedIds = archivedForSubs.map((row) => row.id).filter(Boolean);
      const livingForSubs = livingRows.slice(0, 20);
      const subReqs = lockSubmissionQueriesForParlays(supabase, {
        userId: user.id,
        living: livingForSubs,
        archivedIds,
      });
      const subSettled = await Promise.allSettled(subReqs.length ? subReqs : [Promise.resolve({ data: [] })]);
      const subRes = subSettled.map(comboSettledQuery);
      const livingSubsOk = subReqs.length === 0 || subRes.every(comboListQueryOk);
      const livingSubRows = subRes.flatMap((r) => (comboListQueryOk(r) ? r.data : []));
      if (livingSubsOk) {
        const subRows = mergeSubmissionRows(livingSubRows);
        setSubmissions(subRows);
        refreshSettlements({
          living: livingRows,
          archived: archivedForSubs,
          fills: fillRows || [],
          outcomes: ocRows || [],
          matchesByParlay: matchRows ? mbp : {},
          submissions: subRows,
          filledById: summed ? summed.byParlay : {},
        });
      }
      } catch (secondaryErr) {
        console.warn("Combo Locks: secondary desk refresh failed (locks / kill-switch are fine)", secondaryErr);
      }
    } catch (err) {
      // Only the locks / kill-switch path (or a transport-level throw) lands here.
      deskFailStreakRef.current += 1;
      const hadReady = parlaysReadyRef.current || settingsReadyRef.current;
      if (shouldShowDeskFailure({ failed: true, streak: deskFailStreakRef.current, hadReady: !!hadReady })) {
        setDeskError(comboDeskCatchNote(err, hadReady));
        setSourceUnhealthy(isSupabaseUnhealthy(err));
        setDeskHealthError(isSupabaseUnhealthy(err) ? err : null);
      }
    } finally {
      setDeskLoading(false);
    }
  }, [owner, user, refreshSettlements]);
  // Single-flight: the 20s poll, the pause toggle and every other action call reload(). Overlapping runs
  // each fire ~45 submission queries and race each other's results, so a call that lands while one is
  // running schedules ONE trailing run (which sees the write that triggered it).
  const reloadInflightRef = useRef(false);
  const reloadAgainRef = useRef(false);
  const reload = useCallback(async () => {
    if (reloadInflightRef.current) { reloadAgainRef.current = true; return; }
    reloadInflightRef.current = true;
    try {
      await loadDesk();
    } finally {
      reloadInflightRef.current = false;
      if (reloadAgainRef.current) { reloadAgainRef.current = false; reload(); }
    }
  }, [loadDesk]);
  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => { reload(); }, [reload]);
  // Apply a Promo Builder prefill once live (or sample) games are in. Prefill is
  // App state and is cleared when leaving this tab — do not insert into Supabase.
  useEffect(() => {
    if (!prefill || !gamesReady) return;
    const nonce = prefill.nonce ?? prefill;
    if (appliedNonceRef.current === nonce) return;
    appliedNonceRef.current = nonce;
    const { rows, unmatched } = mapPromoLegsToKalshi(prefill.legs, games.sports);
    const n = Math.max(rows.length, prefill.legs?.length || 0, 2);
    const next = [];
    for (let i = 0; i < n; i++) {
      const r = rows[i] || { gameKey: "", marketVal: "" };
      const g = r.gameKey ? gameIdx[r.gameKey] : null;
      next.push({ id: i + 1, gameKey: g ? comboGameId(g) : (r.gameKey || ""), marketVal: r.marketVal || "" });
    }
    setLegRows(next);
    setForm(formFromPrefill(prefill));
    setPrefillWarning(unmatched.length ? unmatched : null);
    requestAnimationFrame(() => createFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [prefill, gamesReady, games, gameIdx]);
  // Live-ish monitor: refresh the parlay/fills data every 20s so the real-fills bars update on their own.
  useEffect(() => { const t = setInterval(() => { reload(); }, 20000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    if (!focusLockId) return;
    setOpenParlays((o) => ({ ...o, [focusLockId]: true, ["hist-" + focusLockId]: true, ["arch-" + focusLockId]: true }));
    const t = window.setTimeout(() => {
      const el = document.getElementById("lock-" + focusLockId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusLockId, parlays, archived]);

  const findMarket = (g, ticker, side) => { for (const t of ["side", "spread", "total", "prop"]) { const m = (g.markets[t] || []).find((x) => x.ticker === ticker && x.side === side); if (m) return { ...m, type: t }; } return null; };
  const readLegs = useCallback(() => legRows.map((r) => {
    if (!r.gameKey || !r.marketVal) return null;
    const [tk, side] = decValFn(r.marketVal); const g = gameIdx[r.gameKey]; const m = g && findMarket(g, tk, side);
    if (!m) return null;
    // NHL keys are date-only (no HHMM), so the worker can't read puck drop from the ticker:
    // stamp the exact start on the leg (started.js reads leg.starts_at) for the pre-game gate.
    return { ticker: tk, side, label: m.label, type: m.type, game: g.title, gameKey: r.gameKey, ...(g.startExact && g.startTime ? { starts_at: g.startTime } : {}) };
  }).filter(Boolean), [legRows, gameIdx]);

  // Game start autofill for NHL (exact puck drop from the feed): earliest leg start, only while the field is empty.
  const startsTouched = useRef(false);
  useEffect(() => {
    if (startsTouched.current) return;
    const ms = legRows.map((r) => { const g = r.gameKey && gameIdx[r.gameKey]; return g && g.startExact ? Date.parse(g.startTime) : NaN; }).filter(Number.isFinite);
    if (!ms.length) return;
    const v = toDatetimeLocalValue(new Date(Math.min(...ms)).toISOString());
    setForm((f) => (f.starts ? f : { ...f, starts: v }));
  }, [legRows, gameIdx]);

  // keep label synced from legs unless the user has edited it
  useEffect(() => { setForm((f) => (f.labelEdited ? f : { ...f, label: readLegs().map((l) => l.label).join(" + ") })); }, [legRows, readLegs]);

  // live preview: auto contracts cap for the chosen mode + the outcome if filled to that cap
  const preview = useMemo(() => {
    const stake = +form.stake, boost = +form.boost, fill = +form.fill;
    const kind = lockKind(form);
    if (!(stake > 0) || !boost || !fill) return null;
    const cap = hedgeCap({ stake, boostAmerican: boost, fillAmerican: fill, mode: form.mode, kind });
    if (!(cap > 0) && !(kind === "freebet" && form.mode === "riskfree")) return null;
    const d = decideAtFill({ parlayStake: stake, parlayAmerican: boost, fillAmerican: fill,
      fairAmerican: form.fair === "" ? null : +form.fair, rfqContracts: cap, hedgeMode: form.mode, kind });
    if (!d.ok) return null;
    return { cap, d, kind };
  }, [form.stake, form.boost, form.fill, form.fair, form.mode, form.kind]);

  // Lifecycle split (derived, so nothing can disappear):
  //   waiting  = living parlay with NO confirmed real fill yet  → "Active — waiting to be filled"
  //   filled   = living parlay WITH ≥1 confirmed real fill       → "Filled — awaiting settlement"
  // A confirmed real fill means Kalshi actually executed the position (from combo_fills, the
  // read-only fills reader) — NOT merely a quote the worker posted.
  const { waiting, filledParlays } = useMemo(() => {
    const w = [], f = [];
    (parlays || []).forEach((p) => ((realFills[p.id] || 0) > 0 ? f : w).push(p));
    return { waiting: w, filledParlays: f };
  }, [parlays, realFills]);
  const toggleOpen = (id) => setOpenParlays((o) => ({ ...o, [id]: !o[id] }));
  // rfq_id -> the quote outcome we recorded for it (only exists for RFQs we actually quoted).
  const outcomeByRfq = useMemo(() => { const m = {}; (outcomes || []).forEach((o) => { if (o.rfq_id) m[o.rfq_id] = o; }); return m; }, [outcomes]);
  const submissionsByParlay = useMemo(() => {
    const m = {};
    (submissions || []).forEach((row) => {
      if (!row.parlay_id) return;
      (m[row.parlay_id] = m[row.parlay_id] || []).push(row);
    });
    return m;
  }, [submissions]);
  const deskByParlay = useMemo(() => {
    const out = {};
    (parlays || []).forEach((p) => {
      out[p.id] = buildParlayDesk({
        parlay: p,
        filled: realFills[p.id] || 0,
        quoted: quoted[p.id] || 0,
        kill: deskReady && !deskLoading ? kill : false,
        matches: matchesByParlay[p.id] || [],
        submissions: submissionsByParlay[p.id] || [],
        outcomes,
        outcomeByRfq,
      });
    });
    return out;
  }, [parlays, realFills, quoted, kill, deskLoading, deskReady, matchesByParlay, submissionsByParlay, outcomes, outcomeByRfq]);
  const fillsByParlay = useMemo(() => {
    const m = {};
    (comboFills || []).forEach((f) => {
      if (!f.parlay_id) return;
      (m[f.parlay_id] = m[f.parlay_id] || []).push(f);
    });
    return m;
  }, [comboFills]);
  const attemptsByParlay = useMemo(() => {
    const out = {};
    [...(parlays || []), ...(archived || [])].forEach((p) => {
      if (!p || !p.id) return;
      out[p.id] = buildLockAttempts({
        parlay: p,
        fills: fillsByParlay[p.id] || [],
        matches: matchesByParlay[p.id] || [],
        outcomes,
        outcomeByRfq,
        submissions: submissionsByParlay[p.id] || [],
      });
    });
    return out;
  }, [parlays, archived, fillsByParlay, matchesByParlay, outcomes, outcomeByRfq, submissionsByParlay]);
  const lockOutcome = (p, filledN) => historyOutcome({
    parlay: p,
    liveResult: liveSettlement[p && p.id] && liveSettlement[p.id].result,
    fills: comboFills,
    outcomes,
    matches: (p && matchesByParlay[p.id]) || [],
    submissions,
    filled: filledN != null ? filledN : ((p && realFills[p.id]) || 0),
  });

  const setLeg = (id, patch) => setLegRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addLeg = () => setLegRows((rows) => [...rows, { id: (rows.at(-1)?.id || 0) + 1, gameKey: "", marketVal: "" }]);
  const removeLeg = (id) => setLegRows((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));

  const runProbe = async () => {
    const legs = readLegs();
    const contracts = preview && preview.cap;
    if (probeDisabled({ probing, legCount: legs.length, contracts })) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session && session.access_token;
      if (!token) {
        setProbeResult({ ok: false, error: "Sign in required" });
        return;
      }
      const r = await fetch("/api/combo-probe", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({
          legs: legs.map((l) => ({ ticker: l.ticker, side: l.side, label: l.label })),
          contracts,
          waitMs: 8000,
          collection: games.comboCollection,
        }),
      });
      let d = null;
      try { d = await r.json(); } catch (_) { d = null; }
      if (!d || typeof d !== "object") {
        setProbeResult({ ok: false, error: r.ok ? "Probe returned an empty response" : `Probe failed (${r.status})` });
        return;
      }
      setProbeResult(d);
    } catch (err) {
      setProbeResult({ ok: false, error: String(err && err.message || err) });
    } finally {
      setProbing(false);
    }
  };

  const betsByParlay = useMemo(() => {
    const m = {};
    (originalBets || []).forEach((bet) => {
      if (!bet || !bet.parlay_id) return;
      (m[bet.parlay_id] = m[bet.parlay_id] || []).push(bet);
    });
    return m;
  }, [originalBets]);
  const dupGroups = useMemo(() => findDuplicateGroups(parlays, Date.now()), [parlays]);

  const incomingBet = () => ({
    stake: +form.stake,
    american: +form.boost,
    kind: form.kind,
    bet_type: formBetType(form),
    sportsbook: String(form.sportsbook || "").trim(),
    boostPct: form.boostPct === "" ? null : +form.boostPct,
    fill: +form.fill,
    fair: form.fair === "" ? null : +form.fair,
    mode: form.mode,
    label: form.label.trim(),
  });
  const insertParlay = async (row) => {
    let payload = { ...row };
    for (let attempt = 0; attempt < 6; attempt++) {
      const { error } = await supabase.from("combo_parlays").insert(payload);
      if (!error) return null;
      const match = String(error.message || "").match(/Could not find the '([^']+)' column/i);
      if (!match || !Object.prototype.hasOwnProperty.call(payload, match[1])) return error;
      const next = { ...payload };
      if (match[1] === "is_free_bet" && payload.is_free_bet && !/^free bet\b/i.test(next.label || "")) {
        next.label = `Free bet · ${next.label || ""}`.trim();
      }
      delete next[match[1]];
      payload = next;
    }
    return { message: "Save failed" };
  };
  const saveSeparateParlay = async (legs) => {
    const kind = lockKind(form);
    const cap = hedgeCap({ stake: +form.stake, boostAmerican: +form.boost, fillAmerican: +form.fill, mode: form.mode, kind });
    const row = {
      user_id: user.id,
      label: form.label.trim() || legs.map((l) => l.label).join(" + "),
      legs,
      mve_collection: games.comboCollection,
      leg_keys: legs.map((l) => `${l.ticker}:${l.side}`).sort(),
      parlay_stake: +form.stake,
      parlay_american: +form.boost,
      fill_american: +form.fill,
      fair_american: form.fair === "" ? null : +form.fair,
      hedge_mode: form.mode,
      max_contracts: cap,
      scale_factor: 1,
      is_free_bet: kind === "freebet",
      bet_type: formBetType(form),
      sportsbook: String(form.sportsbook || "").trim() || null,
      boost_pct: form.boostPct === "" ? null : +form.boostPct,
      starts_at: form.starts ? new Date(form.starts).toISOString() : null,
    };
    const error = await insertParlay(row);
    if (error) return alert("Save failed: " + error.message);
    setLegRows([{ id: 1, gameKey: "", marketVal: "" }, { id: 2, gameKey: "", marketVal: "" }]);
    setForm((f) => ({ ...f, label: "", labelEdited: false, starts: "", sportsbook: "", boostPct: "" }));
    setMergePrompt(null);
    reload();
  };
  const postMerge = async (body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session && session.access_token;
    if (!token) throw new Error("Sign in required");
    const r = await fetch("/api/combo-merge", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await r.json(); } catch (_) { payload = null; }
    if (!r.ok || !payload || payload.ok === false) {
      throw new Error((payload && payload.error) || `Merge failed (${r.status})`);
    }
    return payload;
  };
  const addParlay = async ({ separate = false } = {}) => {
    const legs = readLegs();
    if (legs.length < 2) return alert("Pick at least 2 legs (game + market each).");
    if (!(+form.stake > 0) || !+form.boost || !+form.fill) {
      return alert(lockKind(form) === "freebet"
        ? "Enter free-bet amount, book parlay odds, and fill odds."
        : "Enter stake, boosted odds, and fill odds.");
    }
    if (!separate) {
      const target = findMergeTarget(parlays, { legs }, Date.now());
      if (target) {
        const plan = buildMergePlan({
          survivor: target,
          newBet: { ...incomingBet(), legs },
          existingBets: originalBets,
          fills: comboFills,
          now: new Date(),
        });
        if (plan.ok) {
          setMergeError("");
          setMergePrompt({ kind: "new", target, plan });
          return;
        }
      }
    }
    await saveSeparateParlay(legs);
  };
  const confirmMerge = async () => {
    if (!mergePrompt || mergeBusy) return;
    setMergeBusy(true);
    setMergeError("");
    try {
      if (mergePrompt.kind === "group") {
        await postMerge({ action: "merge", survivorId: mergePrompt.target.id, absorbIds: mergePrompt.absorbIds });
      } else {
        const legs = readLegs();
        await postMerge({
          action: "merge",
          survivorId: mergePrompt.target.id,
          newBet: { ...incomingBet(), legs },
        });
        setLegRows([{ id: 1, gameKey: "", marketVal: "" }, { id: 2, gameKey: "", marketVal: "" }]);
        setForm((f) => ({ ...f, label: "", labelEdited: false, starts: "", sportsbook: "", boostPct: "" }));
      }
      setMergePrompt(null);
      reload();
    } catch (err) {
      setMergeError(String(err && err.message || err));
    } finally {
      setMergeBusy(false);
    }
  };
  const mergeExistingGroup = async (group) => {
    if (mergeBusy) return;
    const plan = buildMergePlan({
      survivor: group.survivor,
      absorb: group.others,
      existingBets: originalBets,
      fills: comboFills,
      now: new Date(),
    });
    if (!plan.ok) {
      setMergeError(plan.error || "Those parlays can't be merged.");
      return;
    }
    setMergeBusy(true);
    setMergeError("");
    try {
      await postMerge({ action: "merge", survivorId: group.survivor.id, absorbIds: group.others.map((row) => row.id) });
      setMergePrompt(null);
      reload();
    } catch (err) {
      setMergeError(String(err && err.message || err));
    } finally {
      setMergeBusy(false);
    }
  };
  const undoMerge = async (parlay) => {
    if (!parlay || mergeBusy) return;
    setMergeBusy(true);
    setMergeError("");
    try {
      await postMerge({ action: "undo", survivorId: parlay.id });
      reload();
    } catch (err) {
      setMergeError(String(err && err.message || err));
    } finally {
      setMergeBusy(false);
    }
  };
  const removeParlay = async (id) => { await supabase.from("combo_parlays").delete().eq("id", id); reload(); };
  // Move a parlay to History: deactivate it (worker stops watching) and stamp archived_at.
  const archiveParlay = async (id) => { await supabase.from("combo_parlays").update({ active: false, archived_at: new Date().toISOString() }).eq("id", id); reload(); };
  // Reactivate a parlay the worker paused (active=false) — it resumes watching for RFQs.
  const reactivateParlay = async (id) => {
    const row = [...parlays, ...archived].find((p) => p.id === id);
    if (row && row.merged_into_id) return alert("That ticket was merged into another order. Undo the merge there instead of reactivating it.");
    await supabase.from("combo_parlays").update({ active: true }).eq("id", id);
    reload();
  };
  // Per-lock pause. Persisted in combo_parlays.paused; combo-worker polls it (~5s). Owner RLS applies.
  const [pauseBusy, setPauseBusy] = useState({});
  const setParlayPaused = async (id, paused) => {
    setPauseBusy((b) => ({ ...b, [id]: true }));
    setParlays((prev) => prev.map((p) => (p.id === id ? { ...p, paused } : p)));
    const { error } = await supabase.from("combo_parlays").update(pauseUpdate(paused)).eq("id", id);
    setPauseBusy((b) => { const n = { ...b }; delete n[id]; return n; });
    if (error) {
      setMergeError(isMissingPausedColumn(error) ? PAUSE_SQL_HINT : "Could not " + (paused ? "pause" : "resume") + " that lock: " + error.message);
    } else {
      setMergeError("");
    }
    reload();
  };
  const toggleKill = async () => {
    if (deskLoading || !deskReady) return;
    const next = !kill;
    killRef.current = next;
    setKill(next);
    const { error } = await supabase.from("combo_settings").upsert({ user_id: user.id, kill_switch: next, updated_at: new Date().toISOString() });
    // Only approved live users may disarm (DB trigger). Put the switch back and say why.
    if (error) {
      killRef.current = !next;
      setKill(!next);
      alert(/not enabled/i.test(String(error.message || "")) ? "Live trading is not enabled for this account yet." : "Could not change the kill switch: " + (error.message || error));
    }
  };

  const simulate = async () => {
    const p = parlays.find((x) => x.id === sim.parlayId);
    if (!p) return setSim((s) => ({ ...s, result: { kind: "empty" } }));
    const d = decideAtFill({ parlayStake: p.parlay_stake, parlayAmerican: p.parlay_american, fillAmerican: p.fill_american,
      fairAmerican: p.fair_american, rfqContracts: +sim.size, hedgeMode: p.hedge_mode || "1x", kind: lockKind(p) });
    setSim((s) => ({ ...s, result: { ...d, parlay: p, kill } }));
    if (d.ok && d.locks) {
      const sub = { user_id: user.id, parlay_id: p.id, label: p.label, fill_american: d.fillAmerican, contracts: d.contracts, worst_lock: d.worst, status: "shadow" };
      await supabase.from("combo_submissions").insert(sub); reload();
    }
  };
  const loadExample = () => {
    const g = gameList;
    setLegRows([
      { id: 1, gameKey: g[0] ? comboGameId(g[0]) : "", marketVal: g[0] ? encVal(g[0].markets.side[0].ticker, "yes") : "" },
      { id: 2, gameKey: g[1] ? comboGameId(g[1]) : "", marketVal: g[1]?.markets.total[0] ? encVal(g[1].markets.total[0].ticker, g[1].markets.total[0].side) : "" },
      { id: 3, gameKey: g[2] ? comboGameId(g[2]) : "", marketVal: g[2]?.markets.spread[0] ? encVal(g[2].markets.spread[0].ticker, g[2].markets.spread[0].side) : "" },
    ]);
    setForm({ ...DEFAULT_FORM });
  };

  const historyStatement = useMemo(() => buildComboStatement({
    parlays: archived,
    fillsById: realFills,
    fills: comboFills,
    outcomes,
    matchesByParlay,
    submissions,
    liveSettlement,
  }), [archived, realFills, comboFills, outcomes, matchesByParlay, submissions, liveSettlement]);
  const historyView = useStatementView(historyStatement);
  const archivedById = useMemo(() => {
    const m = {};
    (archived || []).forEach((row) => { if (row && row.id) m[row.id] = row; });
    return m;
  }, [archived]);

  if (!owner) return null;

  const deskChrome = comboDeskChrome({ deskLoading, deskReady, kill, deskError, sourceUnhealthy });
  const deskHealth = dataSourceStatus({
    error: deskHealthError,
    lastKnown: deskReady,
    context: "combo",
  });
  const waitingKind = comboSectionKind({ deskLoading, deskReady, count: waiting.length });
  const filledKind = comboSectionKind({ deskLoading, deskReady, count: filledParlays.length });
  const archivedKind = comboSectionKind({ deskLoading, deskReady, count: archived.length });

  const marketGroups = (gameKey, selVal) => {
    const g = gameIdx[gameKey]; if (!g) return null;
    return ["side", "spread", "total", "prop"].map((t) => (g.markets[t] || []).length ? (
      <optgroup key={t} label={TYPE_LABEL[t]}>
        {g.markets[t].map((m) => { const v = encVal(m.ticker, m.side); return <option key={v} value={v}>{m.label}</option>; })}
      </optgroup>) : null);
  };
  const res = sim.result;
  const historyTotalsAll = historyTotals(historyStatement.lines);
  const historyEmptyText = `Nothing here yet. A lock moves to History about ${HISTORY_BUFFER_HOURS} hours after its game starts, or when you tap "Move to history".`;
  const matchedCountText = (p) => {
    const mc = matchCounts[p.id];
    const n = Math.max((mc && mc.n) || 0, matchedRfqMatchedCount(attemptsByParlay[p.id]));
    if (!n) return "";
    return `Matched ${n} request${n === 1 ? "" : "s"}${mc && mc.locks_n ? ` (${mc.locks_n} would lock profit)` : ""}`;
  };
  // One lock card for both the Waiting and Filled sections. Summary up top,
  // everything technical behind Details.
  const renderLock = (p, { filledSection }) => {
    const desk = deskByParlay[p.id];
    const filledN = filledSection ? (desk ? desk.fill.filled : (realFills[p.id] || 0)) : (realFills[p.id] || 0);
    const ceiling = desk && desk.fill ? desk.fill.ceiling : p.max_contracts;
    const status = lockStatus({ parlay: p, filled: filledN, ceiling, kill: deskReady && !deskLoading ? kill : false });
    const out = outcomeChrome(lockOutcome(p, filledN), { filled: filledN > 0 });
    const matched = matchedCountText(p);
    const open = !!openParlays[p.id];
    const toggle = () => setOpenParlays((o) => {
      const next = !o[p.id];
      return { ...o, [p.id]: next, ...(next ? {} : { ["hist-" + p.id]: false }) };
    });
    return (
      <LockCard
        key={p.id}
        parlay={p}
        status={status}
        profile={lockProfile(p, filledN)}
        filled={filledN}
        ceiling={ceiling}
        overText={desk && desk.fill ? overFillText(desk.fill) : ""}
        open={open}
        onToggle={toggle}
        controls={<PauseToggle parlay={p} onToggle={setParlayPaused} busy={!!pauseBusy[p.id]} />}
      >
        <DetailBlock title="The legs"><LegList legs={p.legs} /></DetailBlock>
        <DetailBlock title="Profit picture"><RiskProfile parlay={p} filled={filledN} /></DetailBlock>
        <DetailBlock title="Price and size">
          <div className="chips">
            <span className="chip fill num">Selling at {fmtAm(p.fill_american)}</span>
            <TakerFairChips parlay={p} />
            <span className="chip">{MODE_LABEL[p.hedge_mode] || p.hedge_mode || "1× pure hedge"}</span>
            <span className="chip num">Up to {p.max_contracts} contracts</span>
            {matched && <span className="chip num">{matched}</span>}
            {p.starts_at
              ? <span className="chip">Moves to History {etDateTime(historyMoveAt(p.starts_at))}</span>
              : <span className="chip">Move to History by hand when the games end</span>}
            {out && out.kind !== "pending" && <OutcomeChip out={lockOutcome(p, filledN)} filled={filledN > 0} />}
          </div>
          {desk && desk.quoted > desk.fill.filled && (
            <div className="note warn">We offered {desk.quoted.toLocaleString("en-US")} contracts and {desk.fill.filled.toLocaleString("en-US")} were confirmed filled. The rest weren't taken (or haven't gone through yet).</div>
          )}
          <DeskChips desk={desk} />
        </DetailBlock>
        <MergedOrder parlay={p} bets={betsByParlay[p.id]} fills={comboFills} onUndo={undoMerge} busy={mergeBusy} />
        <div className="actions">
          <CopyLockLink lockId={p.id} />
          {p.active === false && (!filledSection || (desk && desk.fill.left > 0)) && <button className="btn mini" onClick={() => reactivateParlay(p.id)} title="Start offering this lock again">Reactivate</button>}
          <button className="btn mini" onClick={() => archiveParlay(p.id)} title="Stop offering it and move it to History">Move to history</button>
          {!filledSection && <button className="btn mini danger" onClick={() => { if (window.confirm("Remove this lock? It stops being offered and is deleted.")) removeParlay(p.id); }}>Remove</button>}
        </div>
        <AttemptHistory attempts={attemptsByParlay[p.id]} open={!!openParlays["hist-" + p.id]} onToggle={() => toggleOpen("hist-" + p.id)} showSummary={false} />
        {matchedRfqCounts(attemptsByParlay[p.id]).filled > 0 && <MatchedRfqTable attempts={attemptsByParlay[p.id]} matches={matchesByParlay[p.id] || []} submissions={submissionsByParlay[p.id] || []} outcomeByRfq={outcomeByRfq} desk={desk} />}
      </LockCard>
    );
  };

  return (
    <div className="cl">
      <style>{`
        .cl{color:#e8eaed}
        .cl .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px}
        .cl h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin:22px 2px 10px}
        .cl label{display:block;font-size:12px;font-weight:600;color:#8a8f98;margin:0 0 4px}
        .cl input,.cl select{width:100%;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:inherit}
        .cl .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .cl .row{display:grid;gap:12px;margin-bottom:12px}.cl .c3{grid-template-columns:1fr 1fr 1fr}.cl .c2{grid-template-columns:1fr 1fr}
        .cl .legrow{display:grid;grid-template-columns:1fr 1.15fr auto;gap:8px;margin-bottom:8px;align-items:end}
        .cl .btn{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#e8eaed;font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;cursor:pointer}
        .cl .btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}.cl .btn.mini{padding:6px 10px;font-size:13px}.cl .btn.danger{color:#f87171;border-color:rgba(248,113,113,.4)}
        .cl .num{font-variant-numeric:tabular-nums}
        .cl .parlay{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:10px;background:rgba(255,255,255,0.02)}
        .cl .chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:#c3c6cc}.cl .chip.fill{background:rgba(59,130,246,.15);color:#93c5fd}
        .cl .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px;font-variant-numeric:tabular-nums}
        .cl .merged-list{list-style:none;margin:6px 0 0;padding:0}
        .cl .merged-list li{font-size:13px;color:#c3c6cc;padding:2px 0}
        .cl .leg .ty{font-size:10px;font-weight:700;text-transform:uppercase;color:#7ea2e0;margin-right:5px}
        .cl .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
        .cl .tile{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px}
        .cl .tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280}.cl .tile .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:3px}
        .cl .tile .sub{font-size:12px;color:#8a8f98;margin-top:4px;line-height:1.4}
        .cl .profile{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px}
        .cl .profile .tile .v{font-size:15px;line-height:1.35}
        .cl .pos{color:#34d399}.cl .neg{color:#f87171}.cl .muted{color:#8a8f98}
        .cl .kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px}
        .cl .note{font-size:13px;padding:8px 10px;border-radius:8px;margin-top:8px}.cl .note.ok{background:rgba(16,185,129,.12);color:#6ee7b7}.cl .note.warn{background:rgba(245,158,11,.12);color:#fcd34d}
        .cl .post{background:#0c1512;color:#9ff0be;border-radius:8px;padding:10px 12px;font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap;margin-top:6px}
        .cl table{width:100%;border-collapse:collapse;font-size:13px}
        .cl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .cl td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums}
        .cl .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
        .cl .st.shadow{background:rgba(255,255,255,.08);color:#9aa3b2}.cl .st.filled{background:rgba(16,185,129,.15);color:#6ee7b7}.cl .st.unfilled{background:rgba(245,158,11,.12);color:#fcd34d}.cl .st.declined{background:rgba(248,113,113,.12);color:#fca5a5}
        .cl .st.real{background:rgba(139,92,246,.22);color:#c4b5fd}.cl .st.test{background:rgba(255,255,255,.06);color:#8a8f98}
        .cl .switch{position:relative;width:46px;height:26px;border-radius:999px;background:#3a3d46;cursor:pointer;border:none}
        .cl .switch .knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
        .cl .switch.on{background:#ef4444}.cl .switch.on .knob{left:23px}
        .cl .switch:disabled{opacity:.45;cursor:wait}
        .cl .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .cl .empty.loading{display:flex;align-items:center;gap:8px}
        .cl .spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.15);border-top-color:#93c5fd;border-radius:50%;animation:cl-spin .7s linear infinite;flex:0 0 auto}
        @keyframes cl-spin{to{transform:rotate(360deg)}}
        .cl .bar{height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:2px}
        .cl .bar.thin{height:4px}
        .cl .bar-fill{height:100%;background:#34d399;border-radius:999px;transition:width .3s}
        .cl .desk{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
        .cl .desk.thin{margin-top:6px}
        .cl .chip.skip{background:rgba(245,158,11,.15);color:#fcd34d}
        .cl .chip.warn{background:rgba(245,158,11,.15);color:#fcd34d}
        .cl .chip.ok{background:rgba(16,185,129,.15);color:#6ee7b7}
        .cl .chip.loss{background:rgba(248,113,113,.14);color:#fca5a5}
        .cl .chip.settle-win{background:rgba(16,185,129,.15);color:#6ee7b7}
        .cl .chip.settle-lose{background:rgba(248,113,113,.14);color:#fca5a5}
        .cl .chip.settle-wait{background:rgba(147,197,253,.18);color:#93c5fd}
        .cl .chip.settle-push{background:rgba(251,191,36,.14);color:#fcd34d}
        .cl .chip.src{background:rgba(255,255,255,.05);color:#9aa3b2}
        .cl .chip.venue-kalshi{background:rgba(6,182,212,.15);color:#67e8f9}
        .cl .chip.venue-poly{background:rgba(91,110,245,.15);color:#a5b4fc}
        .cl .outcome-pair{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
        .cl .arch-head{display:block;width:100%;text-align:left;background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:0}
        .cl .arch-caret{color:#93c5fd;font-size:14px;width:12px}
        .cl .arch-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:#8a8f98}
        .cl .hist-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .cl .sb td{border-bottom:none}
        .cl .hist-head{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:transparent;border:0;color:#6b7280;font:inherit;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;padding:0;margin-bottom:6px;flex-wrap:wrap}
        .cl .hist-head .chip{text-transform:none;letter-spacing:0}
        .cl .hist-head .hist-toggle{margin-left:auto}
        .cl .hist-static{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px}
        .cl .hist-static .chip{text-transform:none;letter-spacing:0}
        .cl .hist-sub{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin:12px 0 6px}
        .cl .hist-sub:first-child{margin-top:0}
        .cl .hist-rpt{display:inline-block;margin-left:6px;color:#9aa3b2;font-weight:600;white-space:nowrap}
        .cl .pause-wrap{display:inline-flex;align-items:center;gap:6px}
        .cl .pause-lbl{font-size:11px;font-weight:600;color:#8a8f98}
        .cl .pause-sw{position:relative;width:32px;height:18px;border-radius:999px;background:#3a3d46;cursor:pointer;border:none;padding:0}
        .cl .pause-sw .knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}
        .cl .pause-sw.on{background:#10b981}.cl .pause-sw.on .knob{left:16px}
        .cl .pause-sw:disabled{opacity:.5;cursor:wait}
        .cl .chip.paused-badge{background:rgba(245,158,11,.18);color:#fcd34d}
        .cl .parlay.paused{border-style:dashed}
        .cl .parlay.paused > *:not(.plhead){opacity:.45}
        .cl .parlay.paused .plhead > *:not(.pl-keep):not(.btn){opacity:.5}
        .cl .bucket-readout{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px;margin:0 0 12px;padding:7px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02);font-size:13px}
        .cl .bucket-readout .bk{display:inline-flex;align-items:baseline;gap:5px;cursor:default}
        .cl .bk-l{color:#c3c6cc;font-weight:600}.cl .bk-v{font-weight:700}.cl .bk-s{font-size:11px;color:#6b7280}
        .cl .bk-age{margin-left:auto;font-size:11px;color:#6b7280}.cl .bk-age.stale{color:#fcd34d}
        .cl .parlay.arch-open{border-color:rgba(147,197,253,.28)}
        .cl .info{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:rgba(147,197,253,.2);color:#93c5fd;font-size:10px;font-weight:700;font-style:italic;font-family:Georgia,'Times New Roman',serif;cursor:pointer;position:relative;vertical-align:middle;user-select:none}
        .cl .info::after{content:attr(data-tip);position:absolute;bottom:150%;left:50%;transform:translateX(-50%);width:250px;background:#0c1016;color:#d7dbe2;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:9px 11px;font-size:12px;font-weight:400;font-style:normal;line-height:1.45;text-align:left;white-space:normal;opacity:0;pointer-events:none;transition:opacity .12s;z-index:30;box-shadow:0 6px 20px rgba(0,0,0,.4)}
        .cl .info::before{content:"";position:absolute;bottom:150%;left:50%;transform:translate(-50%,90%);border:6px solid transparent;border-top-color:#0c1016;opacity:0;transition:opacity .12s;z-index:31}
        .cl .info:hover::after,.cl .info:focus::after,.cl .info:hover::before,.cl .info:focus::before{opacity:1}
      `}</style>
      <style>{COMBO_VIEW_CSS}</style>

      <div className="cl-head">
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="cl-title">Combo Locks</div>
          <div className="cl-sub">Lock in profit on a sportsbook parlay by offering the same parlay to traders on Kalshi and Polymarket. All odds are American and all times are ET.</div>
        </div>
        <div className={"cl-master" + (deskChrome.killSwitchOn ? " stopped" : "")}>
          <div>
            <div className="m-k">Stop all quoting</div>
            <div className="m-s">{!deskReady ? "Loading…" : kill ? "On. Nothing is being offered." : "Your active locks are being offered."}</div>
          </div>
          <button type="button" className={"switch" + (deskChrome.killSwitchOn ? " on" : "")} onClick={toggleKill} disabled={deskChrome.killSwitchDisabled} role="switch" aria-checked={!!deskChrome.killSwitchOn} aria-label="Stop all quoting" aria-busy={deskLoading || !deskReady || undefined} title={!deskReady ? "Loading…" : (kill ? "Everything is stopped. Turn off to start offering again." : "Turn on to stop offering every lock at once.")}><span className="knob" /></button>
        </div>
      </div>
      {(deskLoading || (!deskLoading && deskError)) && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {deskLoading && <span className="chip">Loading your locks…</span>}
          {!deskLoading && deskError && (deskChrome.sourceUnhealthy
            ? <DataSourceChip status={deskHealth} label="Supabase flaky" />
            : <span className="chip">Refresh failed. Retrying…</span>)}
        </div>
      )}
      <BucketReadout supabase={supabase} ready={deskReady} />
      {deskHealth.show
        ? <DataSourceBanner status={deskHealth} style={{ margin: "0 0 12px" }} />
        : deskChrome.deskError && <div className="note warn" style={{ marginBottom: 12 }}>{deskChrome.deskError}</div>}
      {deskChrome.showKillBanner && <div className="note warn" style={{ marginBottom: 12 }}>⛔ All quoting is stopped, so nothing is being offered. You can still add locks and run test requests below.</div>}

      <HowItWorks />
      <SummaryStrip
        waiting={waiting.length}
        filled={filledParlays.length}
        net={historyTotalsAll.net}
        settled={historyTotalsAll.settled}
        onJump={(id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }}
      />

      <SectionHead id="cl-waiting" title="Waiting for a match" count={waitingKind === "rows" ? waiting.length : null} sub="Offered on Kalshi and Polymarket at your price. Nothing is hedged yet." />
      {dupGroups.filter((group) => !dismissedDupes[group.signature]).map((group) => {
        const plan = buildMergePlan({
          survivor: group.survivor,
          absorb: group.others,
          existingBets: originalBets,
          fills: comboFills,
          now: new Date(),
        });
        return (
          <div className="note warn" key={group.signature} style={{ marginBottom: 10 }}>
            <div>{group.warning}</div>
            <MergeFigures plan={plan} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn mini primary" disabled={mergeBusy || !plan.ok} onClick={() => mergeExistingGroup(group)}>Combine</button>
              <button type="button" className="btn mini" disabled={mergeBusy} onClick={() => setDismissedDupes((prev) => ({ ...prev, [group.signature]: true }))}>Keep separate</button>
            </div>
          </div>
        );
      })}
      {mergeError && <div className="note warn" style={{ marginBottom: 10 }}>{mergeError}</div>}
      <div aria-busy={deskLoading || !deskReady || undefined}>
        {waitingKind === "loading" ? <div className="card empty loading"><span className="spin" aria-hidden="true" />Loading locks…</div>
          : waitingKind === "empty" ? <div className="card empty">No locks waiting. Add a parlay below and it shows up here while we look for a buyer.</div>
          : waiting.map((p) => renderLock(p, { filledSection: false }))}
      </div>

      <SectionHead id="cl-filled" title="Filled" count={filledKind === "rows" ? filledParlays.length : null} sub="At least part of these is hedged. They move to History after the games end." />
      <div aria-busy={deskLoading || !deskReady || undefined}>
        {filledKind === "loading" ? <div className="card empty loading"><span className="spin" aria-hidden="true" />Loading locks…</div>
          : filledKind === "empty" ? <div className="card empty">Nothing filled yet. A lock moves here once a trader actually takes your offer (a quote nobody took doesn't count).</div>
          : filledParlays.map((p) => renderLock(p, { filledSection: true }))}
        {realUnattr > 0 && <div style={{ fontSize: 12, color: "#8a8f98", marginTop: 6 }}>{realUnattr} filled contract{realUnattr === 1 ? "" : "s"} couldn't be matched to a specific lock. They're counted, just not shown on a card.</div>}
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div ref={createFormRef}>
          <div className="sec-h">
            <h2>Add a lock</h2>
            <span className="chip" style={{ background: srcLive ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.06)", color: srcLive ? "#6ee7b7" : "#9aa3b2" }} title={srcLive ? "Game list is live from Kalshi." : "Couldn't load live games, showing sample games."}>{srcLive ? "Live games" : "Sample games"}</span>
            <div className="sec-sub">Already placed the parlay at your sportsbook? Enter it here.</div>
          </div>
          <div className="card">
            {prefill && !gamesReady && (
              <div className="note warn" style={{ marginBottom: 12 }}>Matching your Promo Builder legs to live games…</div>
            )}
            {prefillWarning && prefillWarning.length > 0 && (
              <div className="note warn" style={{ marginBottom: 12 }}>
                Couldn't match {prefillWarning.length} leg{prefillWarning.length === 1 ? "" : "s"} automatically (supported: MLB, NFL, college football and NHL main lines, MLB home runs, NFL anytime TDs, NHL goals). Pick those rows by hand, then save. Nothing has been saved yet.
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {prefillWarning.map((u, i) => <li key={i}>{u.name} — {u.reason}</li>)}
                </ul>
              </div>
            )}
            <label>Legs: pick each game, then the bet (moneyline, spread, total, or player prop)</label>
            {legRows.map((r) => (
              <div className="legrow" key={r.id}>
                <div><label>Game</label>
                  <select value={r.gameKey} onChange={(e) => setLeg(r.id, { gameKey: e.target.value, marketVal: "" })}>
                    <option value="">— game —</option>
                    {gameList.map((g) => <option key={comboGameId(g)} value={comboGameId(g)}>{formatGameOption(g)}</option>)}
                  </select></div>
                <div><label>Bet</label>
                  <select value={r.marketVal} onChange={(e) => setLeg(r.id, { marketVal: e.target.value })}>
                    <option value="">— bet —</option>{marketGroups(r.gameKey, r.marketVal)}
                  </select></div>
                <button className="btn mini" title="Remove this leg" aria-label="Remove this leg" onClick={() => removeLeg(r.id)}>✕</button>
              </div>
            ))}
            <button className="btn mini" onClick={addLeg}>+ Add leg</button>
            <div className="row c3" style={{ marginTop: 12 }}>
              <div><label>Bet type</label>
                <select value={form.kind === "freebet" ? "freebet" : (form.kind === "boost" ? "boost" : "cash")} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="boost">Profit boost</option>
                  <option value="freebet">Free bet</option>
                </select></div>
              <div><label>Sportsbook (optional)</label><input value={form.sportsbook} onChange={(e) => setForm({ ...form, sportsbook: e.target.value })} placeholder="FanDuel, DraftKings…" /></div>
              <div><label>Boost % (optional)</label><input className="num" type="number" value={form.boostPct} onChange={(e) => setForm({ ...form, boostPct: e.target.value })} placeholder="25" /></div>
            </div>
            <div className="row c3" style={{ marginTop: 14 }}>
              <div><label>{lockKind(form) === "freebet" ? "Free bet amount ($)" : "Your stake ($)"}</label><input className="num" type="number" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} /></div>
              <div><label>{lockKind(form) === "freebet" ? "Your parlay odds at the book" : "Your odds at the book (boosted)"}</label><input className="num" type="number" value={form.boost} onChange={(e) => setForm({ ...form, boost: e.target.value })} /></div>
              <div><label style={{ display: "flex", alignItems: "center", gap: 6 }}>Sell at (odds you offer, after fees)
                {+form.fill ? <span className="info" tabIndex={0} data-tip={`The buyer gets ${fmtAm(fillView(+form.fill).effTaker)}, a bit worse than your ${fmtAm(+form.fill)}, because their fee (7%) is bigger than yours. That's the price they shop on.`}>i</span> : null}
              </label><input className="num" type="number" value={form.fill} onChange={(e) => setForm({ ...form, fill: e.target.value })} placeholder={prefill ? "enter sell odds" : undefined} /></div>
            </div>
            <div className="row c2">
              <div><label>Fair odds (optional)</label><input className="num" type="number" value={form.fair} onChange={(e) => setForm({ ...form, fair: e.target.value })} /></div>
              <div><label>Hedge style (sets the size for you)</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option value="riskfree">Risk-free — floor $0, keep upside</option>
                  <option value="1x">1× pure hedge — equal both sides (default)</option>
                  <option value="riskfree_open">Risk-free — floor $0, open to larger orders (new)</option>
                  <option value="2x">2× — directional short (can lose big)</option>
                </select></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>Game start (optional, ET). The lock moves to History after this</label>
              <input className="num" type="datetime-local" value={form.starts} onChange={(e) => { startsTouched.current = true; setForm({ ...form, starts: e.target.value }); }} />
            </div>
            {preview && (
              <div className="tiles" style={{ marginTop: 2 }}>
                <div className="tile"><div className="k">Size (contracts)</div><div className="v num">{preview.cap}</div></div>
                <div className="tile"><div className="k">You profit</div>
                  <div className="num" style={{ marginTop: 4, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
                    <div className={preview.d.hit >= 0 ? "pos" : "neg"}>{money(preview.d.hit)} <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>if the parlay hits</span></div>
                    <div className={preview.d.miss >= 0 ? "pos" : "neg"}>{money(preview.d.miss)} <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>if the parlay misses</span></div>
                  </div>
                </div>
                <div className="tile"><div className="k">{preview.kind === "freebet" ? "Free bet kept" : "Worst case"}</div>
                  <div className={"v " + (preview.d.worst >= 0 ? "pos" : "neg")}>
                    {preview.kind === "freebet" && +form.stake > 0
                      ? `${((Math.max(0, preview.d.worst) / +form.stake) * 100).toFixed(1)}% · ${money(preview.d.worst)}`
                      : money(preview.d.worst)}
                  </div>
                </div>
              </div>
            )}
            {lockKind(form) === "freebet" && (
              <div className="note ok">Free bet: if the parlay misses you lose nothing, and if it hits you keep the winnings. A 1× hedge makes both outcomes pay the same cash.</div>
            )}
            {preview && !preview.d.locks && form.mode !== "2x" && form.mode !== "3x" && (
              <div className="note warn">⚠ This won't fully lock in profit: your {lockKind(form) === "freebet" ? "parlay" : "boosted"} odds and sell odds are too close. Widen the gap ({lockKind(form) === "freebet" ? "longer parlay odds" : "a bigger boost"}, or sell at shorter odds).</div>
            )}
            {preview && (form.mode === "2x" || form.mode === "3x") && (
              <div className="note warn">⚠ Directional: {MODE_LABEL[form.mode]} sells more than the hedge. You profit if the parlay misses but take the loss shown above if it hits.</div>
            )}
            <label>Name (filled in from your legs; edit if you like)</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, labelEdited: true })} placeholder="pick legs above…" />
            {mergePrompt && mergePrompt.kind === "new" && (
              <div className="note warn" style={{ marginTop: 12 }}>
                <div>{mergePrompt.plan.warning}</div>
                <MergeFigures plan={mergePrompt.plan} />
                <div style={{ fontSize: 12, marginTop: 6 }}>The combined lock keeps this lock's sell odds. The original bets stay listed on the card.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn mini primary" disabled={mergeBusy} onClick={confirmMerge}>Combine</button>
                  <button type="button" className="btn mini" disabled={mergeBusy} onClick={() => addParlay({ separate: true })}>Keep separate</button>
                </div>
                {mergeError && <div style={{ marginTop: 8 }}>{mergeError}</div>}
              </div>
            )}
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn primary" onClick={() => addParlay()}>Add lock</button>
              {/* Probe opens a real RFQ on Kevin's Kalshi key: owner only (api/combo-probe enforces it too). */}
              {canSeeOwnerTools(user) && (
                <button
                  type="button"
                  className="btn"
                  disabled={probeDisabled({ probing, legCount: readLegs().length, contracts: preview && preview.cap })}
                  title="Ask the market for its best price on this parlay at this size."
                  onClick={runProbe}
                >{probing ? "Checking…" : "Check market price"}</button>
              )}
              <button className="btn" onClick={loadExample}>Load example</button>
            </div>
            {canSeeOwnerTools(user) && (
              <div style={{ fontSize: 12, color: "#8a8f98", marginTop: 8, lineHeight: 1.45 }}>
                "Check market price" shows the best price traders would pay for this parlay right now. It doesn't place anything.
              </div>
            )}
            {probeResult && (
              <div className={"note " + (probeResult.ok && fillBeatsMarket(+form.fill, probeResult.bestAmerican) ? "ok" : "warn")}>
                {plainAttemptLabel(formatProbeNote(probeResult, form.fill === "" ? null : +form.fill))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="sec-h">
            <h2>Test a request</h2>
            <div className="sec-sub">See what a lock would do if a trader asked for it. Nothing is sent.</div>
          </div>
          <div className="card">
            <div className="row c2">
              <div><label>Lock</label>
                <select value={sim.parlayId} onChange={(e) => setSim({ ...sim, parlayId: e.target.value })}>
                  <option value="">— pick a lock —</option>
                  {parlays.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select></div>
              <div><label>Request size (contracts)</label><input className="num" type="number" value={sim.size} onChange={(e) => setSim({ ...sim, size: e.target.value })} /></div>
            </div>
            <button className="btn primary" onClick={simulate}>See what it would do</button>
            <div style={{ marginTop: 16 }}>
              {res && res.kind === "empty" && <div className="empty">Pick a lock first.</div>}
              {res && res.ok === false && res.kind !== "empty" && (
                <div><div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 8 }}>Would skip this request</div>
                  <div className="kv"><span>Why</span><span className="num">{res.reason === "over_limit" ? `A request for ${sim.size} is bigger than this lock's size (${res.cap})` : plainAttemptLabel(res.reason)}</span></div></div>
              )}
              {res && res.ok && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: res.locks ? "#34d399" : "#fcd34d" }}>
                    {res.locks ? "✓ Would offer it. Profit is locked either way." : "! Doesn't lock profit at this size. This would be a bet, not a hedge."}
                  </div>
                  <div className="tiles">
                    <div className="tile"><div className="k">If the parlay hits</div><div className={"v " + (res.hit >= 0 ? "pos" : "neg")}>{money(res.hit)}</div></div>
                    <div className="tile"><div className="k">If the parlay misses</div><div className={"v " + (res.miss >= 0 ? "pos" : "neg")}>{money(res.miss)}</div></div>
                    <div className="tile"><div className="k">Worst case</div><div className={"v " + (res.worst >= 0 ? "pos" : "neg")}>{money(res.worst)}</div></div>
                  </div>
                  <div className="kv"><span>You sell at (after your fee)</span><span className="num">{fmtAm(res.fillAmerican)}</span></div>
                  <div className="kv"><span>Buyer gets</span><span className="num">{fmtAm(res.effTakerOdds)}</span></div>
                  <div className="kv"><span>Contracts</span><span className="num">{res.contracts}</span></div>
                  {res.competitive != null && <div className={"note " + (res.competitive ? "ok" : "warn")}>{res.competitive ? `✓ Your ${fmtAm(res.fillAmerican)} is better than fair odds of ${fmtAm(res.parlay.fair_american)}, so it should get taken.` : `⚠ Your ${fmtAm(res.fillAmerican)} is worse than fair odds of ${fmtAm(res.parlay.fair_american)}, so it probably won't get taken.`}</div>}
                  {res.locks && (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12, color: "#8a8f98", fontWeight: 600 }}>Technical: the quote it would send</summary>
                      <div className="post">POST /communications/quotes{"\n"}{JSON.stringify(res.quote, null, 2)}</div>
                    </details>
                  )}
                  {res.kill && <div className="note warn">All quoting is stopped, so this wouldn't actually be sent.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SectionHead id="cl-history" title="History" count={archivedKind === "rows" ? historyStatement.lines.length : null} sub="Locks whose games are over, newest first. Tap a row for the details." />
      <div className="card" aria-busy={deskLoading || !deskReady || undefined}>
        {archivedKind === "loading" ? <div className="empty loading"><span className="spin" aria-hidden="true" />Loading history…</div> : archivedKind === "empty" ? <div className="empty">{historyEmptyText}</div> : (
          <ComboHistory
            statement={historyStatement}
            view={historyView}
            archivedById={archivedById}
            isOpen={(id) => !!openParlays["arch-" + id]}
            onToggle={(id) => toggleOpen("arch-" + id)}
            onExportCsv={() => downloadStatementCsv(historyView.filtered && historyView.filtered.lines)}
            emptyText={historyEmptyText}
            renderDetail={(line) => {
              const a = archivedById[line.id];
              if (!a) return null;
              const filledN = realFills[a.id] || 0;
              return (
                <div style={{ paddingTop: 8 }}>
                  <div className="hist-detail-head">
                    <span className="chip num">Sold at {fmtAm(a.fill_american)}</span>
                    {filledN > 0 && <span className="chip num">{filledN.toLocaleString("en-US")} contracts filled</span>}
                    <span className="muted num">{MODE_LABEL[a.hedge_mode] || a.hedge_mode} · up to {a.max_contracts} contracts</span>
                    <span style={{ flex: 1 }} />
                    <CopyLockLink lockId={a.id} />
                  </div>
                  <DetailBlock title="The legs"><LegList legs={a.legs} /></DetailBlock>
                  <MergedOrder parlay={a} bets={betsByParlay[a.id]} fills={comboFills} onUndo={undoMerge} busy={mergeBusy} />
                  <AttemptHistory attempts={attemptsByParlay[a.id]} showSummary={false} />
                </div>
              );
            }}
          />
        )}
      </div>

      <details className="adv">
        <summary>Advanced logs: every offer the worker sent</summary>
        <div className="adv-body">
          <h3>Offers sent</h3>
          <div className="card">
            {history.length === 0 ? <div className="empty">No offers yet. Test requests you run show up here as Test; live offers show as Live with whether they were taken.</div> : (
              <div className="tbl-wrap"><table><thead><tr><th>Type</th><th>When (ET)</th><th>Lock</th><th>Sold at</th><th>Contracts</th><th>Worst case</th><th>Status</th></tr></thead>
                <tbody>{history.map((h) => {
                  const isReal = h.is_live || h.status === "filled" || h.status === "unfilled";
                  // A row logged 'filled' but with NO order_id is a posted quote that wasn't accepted —
                  // show it honestly as offered, not filled. Only a real execution id counts as filled.
                  const executed = !!h.order_id;
                  const dispStatus = h.status === "filled" && !executed ? "offered · waiting"
                    : h.status === "shadow" ? "test only"
                    : h.status === "unfilled" ? "not taken"
                    : h.status === "declined" ? "skipped"
                    : h.status;
                  const stClass = h.status === "filled" && !executed ? "unfilled" : h.status;
                  return (
                  <tr key={h.id}><td><span className={"st " + (isReal ? "real" : "test")}>{isReal ? "Live" : "Test"}</span></td><td>{etStamp(h.created_at)}</td><td>{h.label}</td><td>{fmtAm(h.fill_american)}</td><td>{h.contracts}</td><td>{money(h.worst_lock)}</td>
                    <td><span className={"st " + stClass} title={h.status === "filled" && !executed ? "Offer sent but not taken. No position held." : ""}>{dispStatus}</span></td></tr>
                ); })}</tbody></table></div>
            )}
          </div>

          <h3>Did our offers win?</h3>
          <div className="card">
            {outcomes.length === 0 ? (
              <div className="empty">Nothing tracked yet. Once the watcher is running, every offer shows here as filled, accepted or missed, with how fast we answered.</div>
            ) : (
              <div className="tbl-wrap"><table><thead><tr><th>When (ET)</th><th>Lock</th><th>You offered</th><th>Outcome</th><th>Why (if missed)</th><th>Speed vs window</th><th>Confirmed fill</th></tr></thead>
                <tbody>{outcomes.map((o) => {
                  const map = { executed: ["rgba(16,185,129,.15)", "#6ee7b7", "filled"], accepted: ["rgba(147,197,253,.18)", "#93c5fd", "accepted"], lost: ["rgba(248,113,113,.14)", "#fca5a5", "missed"], posted: ["rgba(255,255,255,.06)", "#9aa3b2", "waiting"] };
                  const [bg, col, lbl] = map[o.outcome] || map.posted;
                  const whyMap = { outbid: "outbid: a better price won", too_slow: "too slow: window closed first", no_taker: "buyer took no one", no_purchase: "request closed with no fill", unknown: "unknown" };
                  const why = o.outcome === "lost" ? plainAttemptLabel(formatLoss(o) || (o.loss_reason ? (whyMap[o.loss_reason] || o.loss_reason) : "checking…")) : "—";
                  const whyCol = o.loss_reason === "too_slow" ? "#fcd34d" : (o.loss_reason === "outbid" || formatCents(tapeNoPrice(o)) ? "#fca5a5" : o.loss_reason === "no_taker" || o.loss_reason === "no_purchase" ? "#9aa3b2" : "#6b7280");
                  const secs = (ms) => (ms != null ? `${(ms / 1000).toFixed(1)}s` : null);
                  return (
                  <tr key={o.id || o.quote_id}>
                    <td>{etStamp(o.posted_at)}</td>
                    <td>{o.label || "—"}</td>
                    <td className="num">{(() => {
                      const sub = o.submitted_no_bid, intended = o.no_bid;
                      if (sub != null) {
                        const mismatch = intended != null && Math.abs(Number(sub) - Number(intended)) > 0.005;
                        return <>{fmtAmOdds(americanFromNoPrice(sub))}{mismatch ? <span style={{ color: "#fcd34d" }}> (meant {fmtAmOdds(americanFromNoPrice(intended))})</span> : null}</>;
                      }
                      return intended != null ? fmtAmOdds(americanFromNoPrice(intended)) : (o.fill_american ? fmtAm(o.fill_american) : "—");
                    })()}</td>
                    <td><span className="st" style={{ background: bg, color: col }} title={o.outcome === "executed" ? "A real position was filled." : ""}>{lbl}</span></td>
                    <td style={{ color: whyCol }}>{why}</td>
                    <td className="num" style={{ color: o.in_time === false ? "#fcd34d" : "#c3c6cc" }} title="How fast we answered vs how long the request stayed open. Answering after it closes means the buyer already took someone else.">
                      {secs(o.responded_ms) || "—"}{o.rfq_lifetime_ms != null ? ` / ${secs(o.rfq_lifetime_ms)}` : ""}{o.in_time === false ? " ⚠ late" : (o.in_time === true ? " ✓" : "")}
                    </td>
                    <td className="num">{o.fill_confirmed ? `✓ ${o.fill_count || ""}` : (o.outcome === "executed" ? "checking…" : "—")}</td>
                  </tr>
                ); })}</tbody></table></div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
