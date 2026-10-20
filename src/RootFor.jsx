// "What to root for" — cheat sheet across the signed-in user's OWN open Combo Locks (live inverse bet fairs).
// Shown to any signed-in user with open locks; the server scopes every query to the auth user id.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { rootFor } from "./rootForEngine";
import PnlCurve from "./RootForCurve";
import EvBars from "./RootForEvBars";
import SweatMeter, { PillLoading } from "./RootForSweat";
import { expectedProfit, lockDecided, dayValue } from "./rootForSweat";
import { createClient } from "@supabase/supabase-js";
import { todayEvents, touchedLocks, sheetDayLabel, sheetDay, todayDay, todayDayLabel } from "./rootForToday";
import { summarySentence, kickoffRef, chanceWords, typicalRange, topByGain, topByDrop, sMoney, fmtAmerican, americanFromP } from "./rootForSimple";

const VIEW_KEY = "rootfor.view";
const readView = () => { try { return (typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY)) === "detailed" ? "detailed" : "simple"; } catch { return "simple"; } };

let client = null;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sUsd = (n) => (n > 0 ? "+" : "") + usd(n);
const pct = (p, d = 1) => (p == null ? "—" : p > 0 && p * 100 < 0.5 * 10 ** -d ? `<${(10 ** -d).toFixed(d)}%` : (p * 100).toFixed(d) + "%");
const worstChance = (p) => { const w = chanceWords(p); return w.startsWith("about 1 in ") ? `about a ${w.slice(6)} chance` : w.startsWith("less than") ? `${w} chance` : w; };
// "LA Chargers vs KC Chiefs" with the row's team first; falls back to the game label.
const matchup = (o) => { const g = String(o.game || ""); const h = g.split(/\s+vs\.?\s+/i); if (h.length !== 2) return g; const n = String(o.name || ""); const i = n.startsWith(h[1]) && !n.startsWith(h[0]) ? 1 : 0; return `${h[i]} vs ${h[1 - i]}`; };
const oneIn = (p) => (p > 0 ? `about 1 in ${Math.round(1 / p).toLocaleString("en-US")}` : "");
const am = (a) => (a == null ? "—" : (a > 0 ? "+" : "") + Math.round(a));
const amFromP = (p) => (!(p > 0 && p < 1) ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
const etStamp = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
// Sunday Oct 18, 2026 only: 2-minute refresh. Reverts to 10 min after 11:59 PM ET (Oct 19 04:00 UTC) with no deploy.
const FAST_UNTIL = Date.parse("2026-10-19T04:00:00Z");
export const refreshMs = (now = Date.now()) => (now < FAST_UNTIL ? 2 : 10) * 60 * 1000;
const tStart = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET" : "");

// condition one game on a team winning (keep its outcomes) or losing (drop them), renormalized
function conditioned(model, picks) {
  const probs = { ...model.probs };
  for (const [ev, { team, won }] of Object.entries(picks)) {
    const g = model.groups[ev]; const p = probs[ev]; if (!g || !p || !g[team]) continue;
    const keep = Object.keys(p).filter((o) => g[team].includes(o) === won);
    const z = keep.reduce((a, o) => a + p[o], 0); if (!(z > 0)) continue;
    probs[ev] = Object.fromEntries(keep.map((o) => [o, p[o] / z]));
  }
  return probs;
}


function todaySentence(d) {
  const top = topByGain(d, 1)[0]; const ev = Number(d.ev) || 0;
  const head = ev >= 0 ? `You're expected to make about ${sMoney(ev)} on today's locks.` : `You're expected to lose about ${sMoney(ev).replace("−", "")} on today's locks.`;
  return `${head}${top ? ` Biggest game: ${top.game} (root for ${top.name}).` : ""}`;
}

function Simple({ d, today }) {
  const range = typicalRange(d.hist);
  // One shared scale for both columns so a +$498 bar and a -$136 bar are drawn in proportion.
  const kref = kickoffRef(d); const top = topByGain(d, 5, kref); const bad = topByDrop(d, 5, kref);
  const mx = Math.max(...top.map((t) => Math.abs(t.gain)), ...bad.map((k) => Math.abs(k.drop)), 1);
  return (
    <div>
      <div className="lead">{today ? todaySentence(d) : summarySentence(d)}</div>
      {range && <div className="lead2">{today ? "Today's locks most likely land" : "Most weekends land"} between <b className="neg">{sMoney(range.lo)}</b> and <b className="pos">{sMoney(range.hi)}</b>.</div>}
      {today && <TouchedLocks today={today} />}
      <SweatMeter d={d} />
      <NeedleHistory rows={d.sweat && d.sweat.history} />
      <div className="pair">
        <div className="panel good">
          <h5>Root for these teams</h5>
          <div className="sub" style={{ margin: "-2px 0 6px" }}>How much each win is worth vs kickoff (EV) ({today ? "EV on today\u2019s locks" : "EV now"} {sMoney(d.ev)})</div>
          {top.map((t) => (
            <div className="bar" key={t.event + t.outcome} title={t.game}>
              <div className="bl"><b>{t.name}</b> <span className="sub">{t.game ? `${matchup(t)} · ` : ""}{t.american != null ? `fair ${am(t.american)}` : ""}{t.start ? ` · ${tStart(t.start)}` : ""}</span></div>
              <div className="bt"><div className="bf pos" style={{ width: `calc((100% - 100px) * ${(Math.abs(t.gain) / mx).toFixed(4)})` }} /><span className="bv pos" title={`Worth ${sMoney(t.gain)} of expected profit vs kickoff if they win`}>{sMoney(t.gain)} EV</span></div>
            </div>))}
        </div>
        <div className="panel bad">
          <h5>Root against these</h5>
          <div className="sub" style={{ margin: "-2px 0 2px" }}>How much each loss costs vs kickoff (EV)</div>
          {d.worst && <div className="sub" style={{ margin: "0 0 6px", fontSize: 11.5 }}>Worst case scenario: <span className={d.worst.pnl < 0 ? "neg" : "pos"}>{sMoney(d.worst.pnl)}</span>{d.worst.p > 0 ? ` (${worstChance(d.worst.p)})` : ""}</div>}
          {bad.map((k) => (
            <div className="bar" key={k.event + k.outcome}>
              <div className="bl"><b>{k.label}</b> <span className="sub">{k.game ? `${matchup(k)} · ` : ""}{k.american != null ? `fair ${am(k.american)}` : ""}{k.start ? ` · ${tStart(k.start)}` : ""}</span></div>
              <div className="bt"><div className="bf negb" style={{ width: `calc((100% - 100px) * ${(Math.abs(k.drop) / mx).toFixed(4)})` }} /><span className="bv neg" title={`Costs ${sMoney(k.drop)} of expected profit vs kickoff if this happens`}>{sMoney(k.drop)} EV</span></div>
            </div>))}
        </div>
      </div>
      <EvBars hist={d.hist} ev={d.ev} pProfit={d.pProfit} worst={d.worst} />
      <h4>{today ? "How likely each result is (today\u2019s locks)" : "How likely each result is"}</h4>
      <Curve d={d} today={today} />
      <div className="note">Switch to <b>Detailed</b> for every game, what-ifs and the math.</div>
    </div>
  );
}

function Curve({ d, today }) {
  return <PnlCurve hist={d.hist} worst={d.worst} ev={d.ev} pProfit={d.pProfit} best={d.best} todayLocks={!!today} />;
}

// Owner only (rows come back only for the owner): each day's needle result and a running total.
function NeedleHistory({ rows }) {
  if (!rows || !rows.length) return null;
  const asc = [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  let run = 0; const withRun = asc.map((r) => { run += Number(r.result) || 0; return { ...r, run }; }).reverse();
  const dl = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));
  return (
    <details className="touched needle-hist" open>
      <summary>How your games ran vs fair odds <span className="sub">· total <b className={run >= 0 ? "pos" : "neg"}>{sMoney(run)}</b> over {asc.length} day{asc.length === 1 ? "" : "s"}</span></summary>
      <table style={{ width: "100%", fontSize: 12.5, marginTop: 6 }}>
        <thead><tr><th style={{ textAlign: "left" }}>Day</th><th className="num">Games</th><th className="num">Locks</th><th className="num">vs kickoff odds</th><th className="num">Running total</th></tr></thead>
        <tbody>{withRun.map((r) => (
          <tr key={r.day}><td>{dl(r.day)}{r.final ? "" : <span className="sub"> · in progress</span>}</td><td className="num">{r.games}</td><td className="num">{r.locks}</td>
            <td className={`num ${Number(r.result) >= 0 ? "pos" : "neg"}`}>{sMoney(Number(r.result) || 0)}</td><td className={`num ${r.run >= 0 ? "pos" : "neg"}`}>{sMoney(r.run)}</td></tr>))}</tbody>
      </table>
      <div className="sub" style={{ fontSize: 11.5, marginTop: 4 }}>Each day: how much the day's games moved the expected profit of the locks they touch, from kickoff numbers (inverse bet method) to final. A day closes when its games are decided, or at 11 AM ET the next morning.</div>
    </details>
  );
}

function TouchedLocks({ today }) {
  return (
    <details className="touched">
      <summary>Today ({today.dayLabel}): {today.games} game{today.games === 1 ? "" : "s"} touch <b>{today.locks.length}</b> of {today.total} open locks</summary>
      <ul>{today.locks.map((l) => <li key={l.id}>{l.label || "Lock"} <span className="sub">· {l.legs.length} legs, {l.todayLegs} today</span></li>)}</ul>
    </details>
  );
}

// Today = the same correlated engine as All, run only over locks with at least one leg in a game kicking off today (ET).
// Hedge fills are already in each lock's hit/miss P&L; later legs stay at current inverse-bet prices.
// Root for / against: E[P | result] − E[P] of those locks, restricted to today's games' outcomes.
// Needle for today's locks only: same frozen kickoff probabilities, restricted to locks touching today's games.
// Today after every game of the sheet day is final (until the 11 AM ET rollover): the saved day row (owner only).
function finalTodayView(base, nowMs) {
  const dr = base && base.sweat && base.sweat.dayRow; if (!dr) return null;
  if (String(dr.day).slice(0, 10) !== todayDay(nowMs)) return null;
  const pre = Number(dr.pregame_ev), live = Number(dr.live_ev); if (!Number.isFinite(pre) || !Number.isFinite(live)) return null;
  return { row: dr, pre, live, result: Number.isFinite(Number(dr.result)) ? Number(dr.result) : live - pre, dayLabel: todayDayLabel(nowMs) };
}
export function FinalToday({ f, d, past = false }) {
  const sweat = { ...(d.sweat || {}), started: true, baseline: f.pre, now: f.live, since: null, source: {}, error: undefined };
  return (
    <div>
      <div className="lead">{past ? `${f.dayLabel}${f.row.final ? "" : " (still in progress)"}` : `All of today’s games are final (${f.dayLabel}).`}</div>
      <div className="lead2">{f.row.games} game{f.row.games === 1 ? "" : "s"} across {f.row.locks} lock{f.row.locks === 1 ? "" : "s"}: <b className={f.result >= 0 ? "pos" : "neg"}>{sMoney(f.result)}</b> vs kickoff odds.{past ? " That day's games only, from kickoff numbers to final." : " Today switches to the next day at 2 AM ET."}</div>
      <SweatMeter d={{ ...d, sweat }} legs={false} />
      <NeedleHistory rows={d.sweat && d.sweat.history} />
    </div>
  );
}

// A saved sheet day (today after everything settled, or any past day) from its needle row + snapshot:
// gauge vs that day's frozen per-lock pregame baseline, needle at the final/latest number, finished legs by name.
export function DaySheet({ row, past = false }) {
  const day = String(row.day).slice(0, 10);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  const pre = Number(row.pregame_ev), live = Number(row.live_ev); const result = Number.isFinite(Number(row.result)) ? Number(row.result) : live - pre;
  const sn = row.snap || null; const positions = sn && sn.positions ? Object.values(sn.positions) : [];
  const approx = !sn || !sn.lockPre || !Object.keys(sn.lockPre).length;
  // settled results (snap.final, from Kalshi) → what these locks actually made; legs still live count at last price
  const fin = (sn && sn.final) || {}; const lastP = { ...((sn && sn.last) || {}), ...fin };
  const settledPos = positions.filter((p) => lockDecided(p, fin)); const openN = new Set(positions.filter((p) => !settledPos.includes(p)).map((p) => String(p.id))).size;
  const actual = sn && Object.keys(fin).length ? dayValue(settledPos, lastP, fin) : null;
  const d = { asOf: past ? undefined : row.updated_at, ev: live, model: { positions, probs: {}, finals: {}, teamNames: {} }, perEvent: [], livePos: positions,
    sweat: { started: true, baseline: pre, now: live, dayResult: result, dayRow: sn ? row : undefined, kept: [], last: lastP, frozen: (sn && sn.frozen) || {}, finished: Object.keys((sn && sn.last) || {}), source: {} } };
  return (
    <div>
      <div className="lead">{label}{row.final ? " — final" : past ? " (still in progress when last saved)" : ""}: <b className={result >= 0 ? "pos" : "neg"}>{sMoney(result)}</b> vs the pregame expectation.</div>
      <div className="lead2">{row.games} game{row.games === 1 ? "" : "s"} across {row.locks} lock{row.locks === 1 ? "" : "s"} · pregame {sMoney(pre)} → {row.final ? "final" : "latest"} {sMoney(live)}{past ? ` · saved ${etStamp(row.updated_at)}` : ""}.</div>
      {actual != null && <div className="lead2" style={{ fontSize: 15 }}>Actual P/L for these locks{openN ? ` (settled so far, ${openN} lock${openN === 1 ? "" : "s"} still live)` : ""}: <b className={actual >= 0 ? "pos" : "neg"}>{sMoney(actual)}</b> <span className="sub">· sportsbook result + hedge fills for every lock touching this day (unfilled cash parlays count their lost stake); can differ from History P/L by a few dollars (fees, rounding).</span></div>}
      {approx && <div className="note" style={{ color: "#fbbf24" }}>Baseline approximate: this day was saved before per-lock first-kickoff baselines existed, so it uses each game's kickoff numbers{sn ? "" : " (no leg detail saved for this day)"}.</div>}
      <SweatMeter d={d} legs={!!sn} liveCol={false} />
    </div>
  );
}

// Meter per day filter. Server sends All (12h rule) at top level and Today & beyond under sweat.tu.
function beyondSweat(s) { return s && s.tu ? { ...s, now: s.tu.now, baseline: s.tu.baseline, finished: s.tu.finished, keptIds: s.tu.keptIds } : s; }
function allSweat(s) { return s && s.allKeptIds ? { ...s, keptIds: s.allKeptIds } : s; }
// A past sheet day in retrospect, from its saved needle row.
function pastDayView(base, day) {
  const r = ((base && base.sweat && base.sweat.history) || []).find((h) => String(h.day).slice(0, 10) === day); if (!r) return null;
  const pre = Number(r.pregame_ev), live = Number(r.live_ev); if (!Number.isFinite(pre) || !Number.isFinite(live)) return null;
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  return { row: r, pre, live, result: Number.isFinite(Number(r.result)) ? Number(r.result) : live - pre, dayLabel: label };
}
const pastDays = (base, nowMs) => ((base && base.sweat && base.sweat.history) || []).map((h) => String(h.day).slice(0, 10)).filter((x) => x < sheetDay(nowMs)).sort().reverse();

function todaySweat(base, pos, evNow, nowMs) {
  const s = base && base.sweat; if (!s) return s;
  // Owner: the saved day row covers every game/lock of the sheet day (settled ones too) — same number as the history row.
  const dr = s.dayRow && String(s.dayRow.day).slice(0, 10) === todayDay(nowMs) ? s.dayRow : null;
  if (dr && Number.isFinite(Number(dr.pregame_ev)) && Number.isFinite(Number(dr.live_ev))) {
    return { ...s, started: true, baseline: Number(dr.pregame_ev), now: Number(dr.live_ev), dayResult: Number(dr.result) };
  }
  if (!s.frozen || !base.model) return s;
  const evs = new Set(pos.flatMap((p) => p.legs.map((l) => l.event)));
  const frozen = Object.fromEntries(Object.entries(s.frozen).filter(([ev]) => evs.has(ev)));
  const source = Object.fromEntries(Object.entries(s.source || {}).filter(([ev]) => evs.has(ev)));
  const started = Object.keys(frozen).length > 0;
  return { ...s, frozen, source, started, since: Object.values(source).includes("snapshot") ? s.since : null, now: evNow, baseline: expectedProfit(pos, { ...base.model.probs, ...frozen }) };
}
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function todayView(base, nowMs) {
  if (!base || !base.model) return null;
  const evs = todayEvents(base.perEvent, nowMs, todayDay(nowMs)); if (!evs.size) return null;
  const pos = touchedLocks(base.model, evs); if (!pos.length) return null;
  let r; try { r = rootFor(pos, base.model.probs, { histBins: 32, rng: seeded(7) }); } catch { return null; }
  const meta = {}; for (const e of base.perEvent || []) { meta[e.event] = e; for (const o of e.outcomes || []) meta[`${e.event}:${o.outcome}`] = o; }
  const deco = (o) => { const m = meta[`${o.event}:${o.outcome}`] || {}; return { ...o, name: m.name || o.outcome, game: m.game, american: m.american, start: m.start, slot: m.slot }; };
  const perEvent = r.perEvent.filter((e) => evs.has(e.event)).map((e) => { const m = meta[e.event] || {}; return { ...e, game: m.game || e.event, rootForName: m.rootForName, american: m.american, start: m.start, slot: m.slot, outcomes: e.outcomes.map(deco) }; });
  const labels = base.lockLabels || {};
  const locks = pos.map((p) => ({ id: p.id, label: labels[p.id], legs: p.legs, todayLegs: p.legs.filter((l) => evs.has(l.event)).length }));
  // finished games of this sheet day (no longer priced, kept at last live chances) feed the leg chart's "Finished games" line
  const s0 = base.sweat || {}; const fin = new Set(((s0.tu && s0.tu.finished) || s0.finished || []).filter((ev) => (s0.finishedDay || {})[ev] === todayDay(nowMs)));
  const keptToday = (s0.kept || []).filter((p) => p.legs.some((l) => fin.has(l.event)));
  return {
    d: { ...base, ...r, sweat: todaySweat(base, pos, r.ev, nowMs), livePos: [...pos, ...keptToday], perEvent, top: (r.top || []).filter((t) => evs.has(t.event)).map(deco), method: r.method, locksPriced: pos.length },
    info: { games: evs.size, locks, total: (base.model.positions || []).length, dayLabel: todayDayLabel(nowMs) + (todayDayLabel(nowMs) !== todayDayLabel(nowMs + 2 * 3600 * 1000) ? ", until 2 AM ET" : "") },
  };
}

const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };

export function RootForEmpty() {
  return (
    <div className="rootfor-empty" style={{ border: "1px solid #374151", borderRadius: 12, padding: "12px 16px", margin: "0 0 16px", background: "#0b1220", color: "#e5e7eb", fontSize: 13 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>What to root for <span style={{ color: "#9ca3af", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>No open locks</span></div>
      <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 6 }}>The live needle starts here when your next lock's first game kicks off. After the games finish, each day's actual P/L is saved here so you can look back at past days.</div>
    </div>
  );
}

export default function RootFor({ user, initialData = null, viewAs = "" }) {
  const vaH = viewAs ? { "x-view-as": viewAs } : {};
  // Always starts hidden on every page load (no remembered open state).
  const [open, setOpen] = useState(false);
  const [view, setViewState] = useState(readView);
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  const [st, setSt] = useState({ loading: false, error: null, data: initialData });
  const signedIn = !!(user && user.id);
  // cheap lock count so users with no open locks never see the sheet
  const [lockCount, setLockCount] = useState(initialData ? (initialData.locksTotal || (initialData.sweat && initialData.sweat.dayRow ? 0 : 1)) : null);
  const [dayCount, setDayCount] = useState(initialData && initialData.sweat && initialData.sweat.history ? initialData.sweat.history.length : 0);
  useEffect(() => {
    if (!signedIn || initialData) return undefined; let dead = false;
    (async () => {
      try {
        const c = supabase(); if (!c) return;
        const { data: { session } } = await c.auth.getSession(); if (!session) return;
        const r = await fetch("/api/root-for?check=1", { headers: { accept: "application/json", authorization: "Bearer " + session.access_token, ...vaH } });
        const j = await r.json().catch(() => null);
        if (!dead && r.ok && j && j.ok) { setLockCount(j.locks || 0); setDayCount(j.days || 0); }
      } catch { /* stay hidden */ }
    })();
    return () => { dead = true; };
  }, [signedIn, initialData]);
  // shown with open locks, or (owner) with saved sheet days so today's/past results stay visible after everything settles
  const can = signedIn && (lockCount > 0 || dayCount > 0);
  const load = useCallback(async () => {
    const c = supabase();
    if (!c) return setSt({ loading: false, error: "Not configured", data: null });
    setSt((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const r = await fetch("/api/root-for", { headers: { accept: "application/json", authorization: "Bearer " + session.access_token, ...vaH } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `Request failed (${r.status})`);
      setSt({ loading: false, error: null, data: j });
    } catch (e) { setSt((s) => ({ loading: false, error: String((e && e.message) || e), data: s.data })); }
  }, []);
  // fetch only once the sheet is shown
  useEffect(() => { if (open && can && !initialData && !st.data && !st.loading) load(); }, [open, can]); // eslint-disable-line react-hooks/exhaustive-deps
  // live: reprice every 10 minutes (2 min on Oct 18, 2026 ET) while the tab is visible (in-game prices included). No alerts.
  useEffect(() => {
    if (!open || !can || initialData) return undefined;
    // tick every 15s and reload once refreshMs() has passed, so the cadence flips back to 10 min at midnight ET without a remount
    let last = Date.now();
    const id = setInterval(() => { if (Date.now() - last >= refreshMs() - 1000 && (typeof document === "undefined" || document.visibilityState !== "hidden")) { last = Date.now(); load(); } }, 15000);
    return () => clearInterval(id);
  }, [open, can, initialData, load]);
  const [dayRows, setDayRows] = useState({});
  const loadDay = useCallback(async (day) => {
    try {
      const c = supabase(); if (!c) return; const { data: { session } } = await c.auth.getSession(); if (!session) return;
      const r = await fetch(`/api/root-for?day=${day}`, { headers: { accept: "application/json", authorization: "Bearer " + session.access_token, ...vaH } });
      const j = await r.json().catch(() => null); setDayRows((m) => ({ ...m, [day]: j && j.ok ? (j.dayRow || false) : false }));
    } catch { setDayRows((m) => ({ ...m, [day]: false })); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [picks, setPicks] = useState({});
  const base = st.data;
  const whatIf = useMemo(() => {
    if (!base || !base.model || !Object.keys(picks).length) return null;
    try {
      const r = rootFor(base.model.positions, conditioned(base.model, picks), { mcSamples: 50000, histBins: 32 });
      return r;
    } catch (e) { return { error: String(e.message || e) }; }
  }, [base, picks]);
  const toggle = (ev, team) => setPicks((p) => {
    const cur = p[ev]; const n = { ...p };
    if (!cur || cur.team !== team) n[ev] = { team, won: true };
    else if (cur.won) n[ev] = { team, won: false };
    else delete n[ev];
    return n;
  });
  const tv = useMemo(() => todayView(base && !base.empty ? base : null, base ? Date.parse(base.asOf) || Date.now() : Date.now()), [base]);
  const fv = useMemo(() => (tv ? null : finalTodayView(base && !base.empty ? base : null, base ? Date.parse(base.asOf) || Date.now() : Date.now())), [base, tv]);
  // Day filter (Kevin, Oct 20 2026: Today / All; "Today & beyond" dropped, it was nearly the same as All):
  // "today" = today's sheet-day games only (day switches at 2 AM ET), "all" (default) = every open lock + finished
  // games for 12h after they end, "day:YYYY-MM-DD" = a past day. "beyond" stays internal: All's numbers when the
  // server didn't send the 12h set.
  // null = automatic: Today when it has games, otherwise All.
  const [scopeSel0, setScope] = useState(null);
  const hasAll = !!(base && base.sweat && !base.sweat.error && base.sweat.allKeptIds);
  const nowMsS = base ? Date.parse(base.asOf) || Date.now() : Date.now();
  const past = pastDays(base, nowMsS);
  const scopeSel = scopeSel0 || (tv || fv ? "today" : "all");
  const scope = scopeSel === "all" && !hasAll ? "beyond" : scopeSel.startsWith("day:") && !past.includes(scopeSel.slice(4)) ? (hasAll ? "all" : "beyond") : scopeSel;
  // Today picked but no games today: show All's content with a note instead of an empty card.
  const noToday = scope === "today" && !tv && !fv;
  const scopeShown = noToday ? (hasAll ? "all" : "beyond") : scope;
  const pv = scope.startsWith("day:") ? pastDayView(base, scope.slice(4)) : null;
  const showFinal = scope === "today" && !tv && !!fv;
  const pickedDay = scope.startsWith("day:") ? scope.slice(4) : null;
  useEffect(() => { if (open && pickedDay && !initialData && !(pickedDay in dayRows)) loadDay(pickedDay); }, [open, pickedDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedRow = pickedDay ? (initialData && initialData.sweat && initialData.sweat.dayRow && String(initialData.sweat.dayRow.day).slice(0, 10) === pickedDay ? initialData.sweat.dayRow : dayRows[pickedDay]) : null;
  const todayRow = base && base.sweat && base.sweat.dayRow && base.sweat.dayRow.snap ? base.sweat.dayRow : null;
  // Combo Locks user with no open locks and no saved days yet: a small empty state instead of nothing.
  if (signedIn && ((lockCount === 0 && dayCount === 0) || (base && base.empty && !(base.sweat && base.sweat.dayRow)))) return <RootForEmpty />;
  if (!can) return null;
  const d = base && whatIf && !whatIf.error ? { ...base, ...whatIf, top: base.top, perEvent: base.perEvent } : base;
  const slots = [];
  if (base) for (const e of base.perEvent || []) { const k = (e.slot && e.slot.key) || "9"; let g = slots.find((x) => x.key === k); if (!g) slots.push((g = { key: k, label: (e.slot && e.slot.label) || "Other days", rows: [] })); g.rows.push(e); }
  slots.sort((a, b) => a.key.localeCompare(b.key));
  const teamBtns = (e) => {
    const g = base.model && base.model.groups[e.event]; if (!g) return null;
    return Object.keys(g).map((t) => { const pk = picks[e.event]; const on = pk && pk.team === t; return (
      <button key={t} type="button" className={"wi" + (on ? (pk.won ? " won" : " lost") : "")} onClick={() => toggle(e.event, t)} title="Tap: won → lost → clear">
        {e.kind === "game" ? t : t.toUpperCase()}{on ? (pk.won ? " ✓" : " ✗") : ""}
      </button>); });
  };
  return (
    <PillLoading.Provider value={st.loading}>
    <div className="rootfor" style={{ cursor: "pointer" }} title={open ? undefined : "Click to show"} onClick={(e) => {
      // Click anywhere on the card toggles it (like Promo Builder cards), except on controls / charts / text selection.
      if (e.target.closest && e.target.closest("button,a,input,select,textarea,label,summary,details,svg,table,[role=button],[role=group],[data-noclick]")) return;
      if (typeof window !== "undefined" && String(window.getSelection && window.getSelection()).length) return;
      setOpen((o) => !o);
    }}>
      <style>{`
        .rootfor{border:1px solid #374151;border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#0b1220;color:#e5e7eb;font-size:13px}
        .rootfor h3{margin:0;font-size:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .rootfor .sub{color:#9ca3af;font-size:12px}.rootfor .tag{font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(16,185,129,.15);color:#6ee7b7}
        .rootfor .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
        .rootfor .tile{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
        .rootfor .tile b{display:block;font-size:18px;margin:2px 0}.rootfor .tile span{color:#9ca3af;font-size:12px}
        .rootfor .pos{color:#6ee7b7}.rootfor .neg{color:#fca5a5}
        .rootfor table{width:100%;border-collapse:collapse;margin-top:6px}.rootfor th,.rootfor td{padding:6px;border-bottom:1px solid #1f2937;text-align:left}
        .rootfor th{color:#9ca3af;font-weight:500;font-size:12px}.rootfor .num{text-align:right;font-variant-numeric:tabular-nums}
        .rootfor h4{margin:14px 0 4px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
        .rootfor button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}
        .rootfor .note{color:#9ca3af;font-size:12px;margin-top:6px}
        .rootfor .wi{padding:2px 7px;margin-right:4px;font-size:11px}.rootfor .wi.won{background:#065f46;border-color:#10b981}.rootfor .wi.lost{background:#7f1d1d;border-color:#ef4444}
        .rootfor .banner{background:#1e293b;border:1px solid #f59e0b;border-radius:8px;padding:6px 10px;margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .rootfor .slot td{background:#111827;color:#93c5fd;font-weight:600;font-size:12px}
        .rootfor .seg{display:inline-flex;border:1px solid #374151;border-radius:8px;overflow:hidden}.rootfor .seg button{border:0;border-radius:0;background:transparent;color:#9ca3af}.rootfor .seg button.on{background:#f59e0b;color:#111827;font-weight:600}
        .rootfor .lead{font-size:18px;font-weight:600;line-height:1.35;margin:12px 0 2px}.rootfor .lead2{color:#cbd5e1;font-size:14px;margin:0 0 12px}
        .rootfor .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:6px 0 14px}
        .rootfor .card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
        .rootfor .card .rk{color:#f59e0b;font-weight:700;font-size:12px}.rootfor .card .tm{font-size:16px;font-weight:700;margin:2px 0}.rootfor .card .gm{color:#9ca3af;font-size:12px}
        .rootfor .card .od{font-size:14px;margin-top:6px}.rootfor .card .sw{font-size:14px;margin-top:4px}
        .rootfor .box{border-radius:10px;padding:12px 14px;margin:0 0 12px}.rootfor .box.bad{background:rgba(127,29,29,.25);border:1px solid #7f1d1d}.rootfor .box.good{background:rgba(6,95,70,.22);border:1px solid #065f46}
        .rootfor .box h5{margin:0 0 6px;font-size:14px}.rootfor .box ol{margin:6px 0 0 18px;padding:0}.rootfor .box li{margin:3px 0}
        .rootfor .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
        .rootfor .big{font-size:20px;font-weight:700}
        .rootfor .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 12px}
        .rootfor .panel{border-radius:10px;padding:12px 14px;background:#111827;border:1px solid #1f2937}.rootfor .panel.good{border-color:#065f46}.rootfor .panel.bad{border-color:#7f1d1d}
        .rootfor .panel h5{margin:0 0 8px;font-size:15px}
        .rootfor .bar{margin:8px 0}.rootfor .bl{font-size:13px;margin-bottom:3px}
        .rootfor .bt{display:flex;align-items:center;gap:8px}.rootfor .bf{height:14px;border-radius:4px;min-width:4px;flex:0 0 auto}
        .rootfor .bf.pos{background:#34d399}.rootfor .bf.negb{background:#f87171}.rootfor .bv{font-weight:700;font-size:13px;white-space:nowrap}
        .rootfor .touched{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:8px 12px;margin:0 0 10px}.rootfor .touched summary{cursor:pointer;color:#cbd5e1}.rootfor .touched ul{margin:6px 0 0 18px;padding:0;columns:2}.rootfor .touched li{margin:2px 0;break-inside:avoid}
        @media (max-width:700px){.rootfor .touched ul{columns:1}}
        @media (max-width:700px){.rootfor .pair{grid-template-columns:1fr}}
        @media (max-width:600px){.rootfor .hide-sm{display:none}}
        .rootfor .upd-pill{display:inline-flex;align-items:center;gap:7px;padding:4px 12px;border-radius:999px;font-size:15px;font-weight:800;background:#000;color:#f5c542;border:2px solid #f5c542;white-space:nowrap;font-variant-numeric:tabular-nums}
        .rootfor .upd-pill .dot{width:9px;height:9px;border-radius:50%;background:#f5c542;animation:updpulse 1.6s infinite}
        .rootfor .upd-pill.amber{color:#f59e0b;border-color:#f59e0b}.rootfor .upd-pill.amber .dot{background:#f59e0b}
        .rootfor .upd-pill.red{color:#fff;background:#7f1d1d;border-color:#ef4444}.rootfor .upd-pill.red .dot{background:#ef4444}
        @keyframes updpulse{0%,100%{opacity:1}50%{opacity:.25}}
      `}</style>
      <h3>
        What to root for
        <span className="sub">{d ? (d.empty ? `No open locks · showing saved days · checked ${etStamp(d.asOf)}` : `Last updated ${etStamp(d.asOf)} · auto-updates every ${refreshMs() / 60000} min · ${d.locksPriced} of ${d.locksTotal} open locks · ${d.events} games`) : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {open && <>
          <span className="seg" role="group" aria-label="Games">
            <button type="button" className={scope === "today" ? "on" : ""} aria-pressed={scope === "today"} onClick={() => setScope("today")} title="Only today's games (switches to the next day at 2 AM ET)">Today</button>
            <button type="button" className={scope === "all" || scope === "beyond" ? "on" : ""} aria-pressed={scope === "all" || scope === "beyond"} onClick={() => setScope("all")} title="Every open lock; finished games count for 12 hours after they end">All</button>
          </span>
          {past.length > 0 && <select aria-label="Past day" value={pv ? scope.slice(4) : ""} onChange={(e) => setScope(e.target.value ? `day:${e.target.value}` : "all")}
            style={{ background: pv ? "#f59e0b" : "#1f2937", color: pv ? "#111827" : "#e5e7eb", border: "1px solid #374151", borderRadius: 8, padding: "3px 6px", fontSize: 12 }}>
            <option value="">Past day…</option>
            {past.map((x) => <option key={x} value={x}>{new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${x}T12:00:00Z`))}</option>)}
          </select>}
          <span className="seg" role="group" aria-label="View">
            <button type="button" className={view === "simple" ? "on" : ""} aria-pressed={view === "simple"} onClick={() => setView("simple")}>Simple</button>
            <button type="button" className={view === "detailed" ? "on" : ""} aria-pressed={view === "detailed"} onClick={() => setView("detailed")}>Detailed</button>
          </span>
          <button type="button" onClick={load} disabled={st.loading}>{st.loading ? "Updating…" : "Refresh"}</button>
          </>}
          <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </span>
      </h3>
      {st.error && <div className="note neg">{st.error}</div>}
      {open && d && pickedDay && (pickedRow ? <DaySheet row={pickedRow} past /> : pickedRow === false ? (pv ? <FinalToday f={pv} d={base} past /> : <div className="note">No saved numbers for that day.</div>) : <div className="note">Loading that day…</div>)}
      {open && d && !pickedDay && base.empty && <DaySheet row={base.sweat.dayRow} past={String(base.sweat.dayRow.day).slice(0, 10) !== sheetDay(nowMsS)} />}
      {open && d && !pickedDay && !base.empty && noToday && <div className="note" style={{ fontSize: 13, margin: "10px 0 0", color: "#fbbf24" }}>No games today ({todayDayLabel(nowMsS)}), showing all open locks. Today switches to the next day at 2 AM ET.</div>}
      {open && d && !pickedDay && !base.empty && showFinal && (todayRow ? <DaySheet row={todayRow} /> : <FinalToday f={fv} d={base} />)}
      {open && d && !pickedDay && !base.empty && !showFinal && view === "simple" && (scope === "today" && tv ? <Simple d={tv.d} today={tv.info} />
        : <Simple d={{ ...base, sweat: scopeShown === "all" ? allSweat(base.sweat) : beyondSweat(base.sweat) }} />)}
      {open && d && !pickedDay && !base.empty && !showFinal && view === "detailed" && (
        <>
          {Object.keys(picks).length > 0 && (
            <div className="banner">
              <b>What-if:</b> {Object.entries(picks).map(([ev, pk]) => `${(base.model.teamNames || {})[`${ev}:${pk.team}`] || pk.team} ${pk.won ? "won" : "lost"}`).join(" · ")}
              {whatIf && whatIf.error ? <span className="neg">{whatIf.error}</span> : <span className="sub">numbers below are conditional (simulated)</span>}
              <button type="button" onClick={() => setPicks({})} style={{ marginLeft: "auto" }}>Reset</button>
            </div>
          )}
          <h4>Top 5 to root for (biggest boost to expected profit if they win)</h4>
          <table>
            <thead><tr><th>#</th><th>Root for</th><th className="hide-sm">Game</th><th className="num">Chance now</th><th className="num">Fair</th><th className="num">Adds to exp. profit</th><th className="num">Swing</th><th className="num hide-sm">If it hits / misses</th></tr></thead>
            <tbody>
              {topByGain(scope === "today" && tv ? tv.d : base).map((t, i) => (
                <tr key={t.event}>
                  <td>{i + 1}</td><td><b>{t.name}</b></td><td className="hide-sm">{t.game}</td>
                  <td className="num">{pct(t.p)}</td><td className="num">{am(t.american)}</td>
                  <td className="num pos">{sUsd(t.gain)}</td>
                  <td className="num">{usd(t.swing)}</td>
                  <td className="num hide-sm">{sUsd(t.ifHit)} / {sUsd(t.ifMiss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid">
            <div className="tile"><span>Best outcome</span><b className="pos">{sUsd(d.best && d.best.pnl)}</b><span>{d.best && d.best.p != null ? (d.best.p < 1e-4 ? `${pct(d.best.p, 3)} chance (${oneIn(d.best.p)})` : `${pct(d.best.p, 3)} chance (${am(amFromP(d.best.p))})`) : "chance not computed"}</span></div>
            <div className="tile"><span>Worst outcome</span><b className={d.worst && d.worst.pnl < 0 ? "neg" : "pos"}>{sUsd(d.worst && d.worst.pnl)}</b><span>{d.worst && d.worst.p != null ? `${pct(d.worst.p, 3)} chance (${am(amFromP(d.worst.p))})` : "chance not computed"}</span></div>
            <div className="tile"><span>Total EV</span><b className={d.ev >= 0 ? "pos" : "neg"}>{sUsd(d.ev)}</b><span>±2 SD: {sUsd(d.lo2)} to {sUsd(d.hi2)}</span></div>
            <div className="tile"><span>Chance of a profit</span><b>{pct(d.pProfit, 1)}</b><span>{d.exact && d.exact.pProfit === false ? "simulated" : "exact"}</span></div>
          </div>
          <div className="note">±2 SD is correlation-aware (same team across locks moves together). With long shots the real range is lopsided: most slates land near the downside, and a rare all-hit slate makes the upside tail much longer than the ±2 SD band suggests.</div>
          {(() => { const x = scope === "today" && tv && !whatIf ? tv.d : d; return <EvBars hist={x.hist} ev={x.ev} pProfit={x.pProfit} worst={x.worst} />; })()}
          {scope === "today" && tv && !whatIf
            ? <><h4>How likely each result is (today’s locks)</h4><TouchedLocks today={tv.info} /><Curve d={tv.d} today={tv.info} /></>
            : <><h4>How likely each result is{whatIf ? " (what-if)" : ""}</h4><Curve d={d} /></>}
          <h4>Per game, by time slot <span className="sub" style={{ textTransform: "none" }}>· tap a team: won → lost → clear</span></h4>
          <table>
            <thead><tr><th>Game</th><th className="hide-sm">Start</th><th>Root for</th><th className="num">Chance now</th><th className="num">Swing</th><th>What-if</th></tr></thead>
            <tbody>
              {slots.map((g) => (
                <React.Fragment key={g.key}>
                  <tr className="slot"><td colSpan={6}>{g.label}</td></tr>
                  {g.rows.map((e) => (
                    <tr key={e.event}>
                      <td>{e.game}</td><td className="hide-sm sub">{tStart(e.start)}</td><td>{e.swing != null && Math.abs(e.swing) >= 0.5 ? e.rootForName : "Doesn't matter"}</td>
                      <td className="num">{pct(e.p)}</td><td className="num">{e.swing != null ? usd(Math.abs(e.swing)) : "—"}</td><td>{teamBtns(e)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <div className="note">
            Chances come from the live inverse bet method: each leg is 1 minus the best opposing price with $500 of depth (fees included) across {Object.entries((d.legs || []).reduce((a, l) => { if (l.best) a[l.best] = (a[l.best] || 0) + 1; return a; }, {})).map(([v, n]) => `${VENUE[v] || v} (${n} legs)`).join(", ") || "—"}; ProphetX is off until its key is set. Chances are the raw inverted prices, not scaled. A team in many locks is one outcome, and both sides of a game can't both win. When locks hold both sides, the two raw chances add to a bit under 100%; the gap is treated as a slate where neither side's leg wins. Different games are independent. Where a game has a spread lock, its spread is nested inside the moneyline (covering implies winning), so spread and moneyline legs move together; totals stay independent of the winner (no live joint price to correlate them). Prices update in-game.
            {" "}{d.method === "exact" ? "Exact enumeration." : d.note}
            {d.unpriced && d.unpriced.length ? ` ${d.unpriced.length} lock(s) left out: a leg had no live price with $500 depth (${d.unpriced.map((u) => u.leg).slice(0, 3).join(", ")}${d.unpriced.length > 3 ? "…" : ""}).` : ""}
            {d.resting ? ` Resting hedge orders (${Math.round(d.resting).toLocaleString()} contracts) count only once filled.` : ""}
          </div>
        </>
      )}
    </div>
    </PillLoading.Provider>
  );
}
