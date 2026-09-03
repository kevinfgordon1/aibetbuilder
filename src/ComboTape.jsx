// Combo miss-tape — fill closeness + missed RFQs + taped outbid beat.
// Same owner gate and polls as Combo Locks. Quote-watcher may be parked:
// open quotes and fills come from combo_submissions / combo_fills; beat
// amounts only when tape columns exist.
// Lock settlement copy is official kalshi_result via settlementFromStored.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { formatCents } from "./comboDesk";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  TAPE_VENUE_FILTERS,
  buildLockTape,
  buildTapeSummary,
  filterLockTapeByVenue,
  formatAmerican,
  formatBeat,
  formatBeatTitle,
  formatParlayAmerican,
  formatSkipReason,
  hasQuotingParlays,
  isSameLocalDay,
  lockInScope,
  skipFillSummary,
  skipLockLine,
  sortLockTapes,
  tapeWatcherState,
} from "./comboTape";
import { settlementFromStored } from "./comboSettlement";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const SCOPE = [
  { key: "active", label: "Active" },
  { key: "today", label: "Today" },
  { key: "all", label: "All" },
];
const VENUE_CHIPS = [
  { key: "all", label: "All" },
  { key: "kalshi", label: "Kalshi", cls: "venue-kalshi" },
  { key: "polymarket", label: "Polymarket", cls: "venue-poly" },
];
// Same newest-first caps as ComboLocks.jsx — do not page the firehose.
const MATCH_LIMIT = 400;
const OUTCOME_LIMIT = 200;
const SKIP_LIMIT = 400;
const QUOTE_LIMIT = 400;
const SUBMISSION_LIMIT = SKIP_LIMIT + QUOTE_LIMIT;

const fmtAm = (a) => formatAmerican(a) || "—";
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");

function reasonLabel(row) {
  if (row.bucket === "filled") return "filled";
  if (row.reason === "open" || row.bucket === "open") return "open";
  if (row.bucket === "awaiting") return "awaiting";
  if (row.bucket === "outbid") return row.tape ? "outbid" : "outbid · no tape";
  if (row.bucket === "too_slow") return "too slow";
  if (row.reason === "cancelled") return "cancelled";
  if (row.reason === "quoted · no take") return "quoted · no take";
  if (row.bucket === "no_taker") return "no taker";
  if (row.bucket === "oversized" || row.bucket === "skipped") return formatSkipReason(row);
  return row.reason || "lost";
}

function reasonColor(row) {
  const bucket = row && row.bucket;
  if (bucket === "filled" || (row && row.skipFill === "filled")) return "#6ee7b7";
  if (bucket === "outbid") return "#fca5a5";
  if (bucket === "too_slow" || bucket === "oversized") return "#fcd34d";
  if (bucket === "awaiting" || bucket === "open") return "#93c5fd";
  return "#9aa3b2";
}

function Tile({ k, v, sub, tone, title }) {
  const color = tone === "pos" ? "#34d399" : tone === "neg" ? "#f87171" : tone === "warn" ? "#fcd34d" : "#e8eaed";
  return (
    <div className="tile" title={title}>
      <div className="k">{k}</div>
      <div className="v num" style={{ color }}>{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function VenueChip({ venue, venueKey }) {
  const cls = venueKey === "kalshi" ? "venue-kalshi" : venueKey === "polymarket" ? "venue-poly" : "";
  return <span className={"chip " + cls}>{venue || "—"}</span>;
}

function LockVenueChips({ rows }) {
  const keys = [];
  (rows || []).forEach((r) => {
    if (r && r.venueKey && !keys.includes(r.venueKey)) keys.push(r.venueKey);
  });
  if (!keys.length) return <VenueChip venue="Kalshi" venueKey="kalshi" />;
  return keys.map((k) => (
    <VenueChip key={k} venue={k === "polymarket" ? "Polymarket" : "Kalshi"} venueKey={k} />
  ));
}

function SettlementChip({ settlement }) {
  const title = "Official Kalshi combo-market result. We sold NO, so yes = parlay won (we lost) and no = parlay lost (we won).";
  if (settlement) {
    return <span className={"chip " + (settlement.weWon ? "settle-win" : "settle-lose")} title={title}>{settlement.text}</span>;
  }
  return <span className="chip settle-wait" title={title}>pending</span>;
}

function MissChips({ stats }) {
  if (!stats) return null;
  const bits = [
    stats.outbid ? `${stats.outbid} outbid` : null,
    stats.no_taker ? `${stats.no_taker} no taker` : null,
    stats.oversized ? `${stats.oversized} oversized` : null,
    stats.too_slow ? `${stats.too_slow} too slow` : null,
    stats.lost_other ? `${stats.lost_other} lost` : null,
  ].filter(Boolean);
  if (!bits.length) return <span className="muted">no misses</span>;
  return <span className="num">{bits.join(" · ")}</span>;
}

const RFQ_CAP = 60;

function RfqList({ rows }) {
  const list = [...(rows || [])].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
  if (!list.length) return <div className="empty">No matching RFQs before kickoff.</div>;
  const shown = list.slice(0, RFQ_CAP);
  const extra = list.length - shown.length;
  return (
    <>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Venue</th>
          <th>Size</th>
          <th>Our quote</th>
          <th>Tape</th>
          <th>Delta</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => {
          const beat = r.beat && r.beat.known ? formatBeat(r.beat) : (r.bucket === "outbid" ? "no tape" : "—");
          const beatTitle = r.beat && r.beat.known ? formatBeatTitle(r.beat) : undefined;
          const ourAm = formatParlayAmerican({ no: r.ourNo });
          const tapeAm = formatParlayAmerican({ no: r.tapeNo, yes: r.tapeYes });
          const tape = tapeAm
            || (r.bucket === "outbid" ? "no tape" : (r.skipFill === "none" ? "no print" : "—"));
          const ourTitle = r.ourNo != null ? `NO $${Number(r.ourNo).toFixed(2)}` : undefined;
          const tapeTitle = r.tapeNo != null
            ? formatCents(r.tapeNo)
            : (r.tapeYes != null ? formatCents(r.tapeYes) : undefined);
          return (
            <tr key={r.rfqId || r.fillId || `${r.at}-${r.contracts}`}>
              <td>{r.at ? new Date(r.at).toLocaleTimeString() : "—"}</td>
              <td><VenueChip venue={r.venue} venueKey={r.venueKey} /></td>
              <td className="num">{r.contracts != null ? r.contracts : "—"}</td>
              <td className="num" title={ourTitle}>{ourAm || "—"}</td>
              <td className="num" title={tapeTitle}>{tape}</td>
              <td className="num" style={{ color: r.bucket === "outbid" ? "#fca5a5" : "#8a8f98" }} title={beatTitle}>{beat}</td>
              <td style={{ color: reasonColor(r) }}>{reasonLabel(r)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {extra > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing {shown.length} of {list.length} (newest first). {extra} more omitted.</div>}
    </>
  );
}

export default function ComboTape({ user }) {
  const owner = user && user.email === OWNER_EMAIL;
  const [scope, setScope] = useState("active");
  const [venueFilter, setVenueFilter] = useState("all");
  const [parlays, setParlays] = useState([]);
  const [fills, setFills] = useState([]);
  const [matches, setMatches] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [open, setOpen] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [poll, setPoll] = useState(false);

  const reload = useCallback(async (mode = "full") => {
    if (!owner || !user?.id) return;
    if (mode === "tick") {
      const { data: peek } = await supabase
        .from("combo_parlays")
        .select("id,active,archived_at")
        .eq("user_id", user.id)
        .is("archived_at", null);
      if (!hasQuotingParlays(peek)) {
        setPoll(false);
        return;
      }
    }
    // combo_parlays + combo_submissions have user_id; fills/matches/outcomes
    // do not — scope those to his parlay ids after the owner-filtered load.
    // One submissions query: quoted + declined + filled (unfilled is how
    // combo-worker stores posted-and-lost / live quotes).
    const [living, archived, submissionRows] = await Promise.all([
      supabase.from("combo_parlays").select("*").eq("user_id", user.id).is("archived_at", null).order("created_at", { ascending: false }),
      supabase.from("combo_parlays").select("*").eq("user_id", user.id).not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100),
      supabase.from("combo_submissions").select("*").eq("user_id", user.id).in("status", ["quoted", "declined", "limitreached", "filled", "unfilled"]).order("created_at", { ascending: false }).limit(SUBMISSION_LIMIT),
    ]);
    const livingRows = living.data || [];
    const archivedRows = archived.data || [];
    const ids = [...livingRows, ...archivedRows].map((p) => p.id).filter(Boolean);
    const none = { data: [] };
    const [fillRows, matchRows, outcomeRows] = ids.length
      ? await Promise.all([
        supabase.from("combo_fills").select("id,fill_id,order_id,parlay_id,count,is_combo,is_taker,ticker,raw,kalshi_created_time,recorded_at,no_price,yes_price").eq("is_combo", true).eq("is_taker", false).in("parlay_id", ids),
        supabase.from("combo_matches").select("*").in("parlay_id", ids).order("matched_at", { ascending: false }).limit(MATCH_LIMIT),
        supabase.from("quote_outcomes").select("*").in("parlay_id", ids).order("updated_at", { ascending: false }).limit(OUTCOME_LIMIT),
      ])
      : [none, none, none];
    setParlays([...livingRows, ...archivedRows]);
    setFills(fillRows.data || []);
    setMatches(matchRows.data || []);
    setOutcomes(outcomeRows.data || []);
    setSubmissions(submissionRows.data || []);
    setLoaded(true);
    setPoll(hasQuotingParlays(livingRows));
  }, [owner, user]);

  useEffect(() => { reload("full"); }, [reload]);
  useEffect(() => {
    if (!poll) return undefined;
    const t = setInterval(() => { reload("tick"); }, 20000);
    return () => clearInterval(t);
  }, [reload, poll]);

  const outcomeByRfq = useMemo(() => {
    const m = {};
    (outcomes || []).forEach((o) => { if (o.rfq_id) m[o.rfq_id] = o; });
    return m;
  }, [outcomes]);

  const fillsByParlay = useMemo(() => {
    const m = {};
    (fills || []).forEach((f) => {
      if (!f.parlay_id) return;
      (m[f.parlay_id] = m[f.parlay_id] || []).push(f);
    });
    return m;
  }, [fills]);

  const matchesByParlay = useMemo(() => {
    const m = {};
    (matches || []).forEach((row) => {
      if (!row.parlay_id) return;
      (m[row.parlay_id] = m[row.parlay_id] || []).push(row);
    });
    return m;
  }, [matches]);

  const submissionByRfq = useMemo(() => {
    const m = {};
    (submissions || []).forEach((s) => { if (s.rfq_id && !m[s.rfq_id]) m[s.rfq_id] = s; });
    return m;
  }, [submissions]);

  const submissionsByParlay = useMemo(() => {
    const m = {};
    (submissions || []).forEach((row) => {
      if (!row.parlay_id) return;
      (m[row.parlay_id] = m[row.parlay_id] || []).push(row);
    });
    return m;
  }, [submissions]);

  const tapes = useMemo(() => {
    return (parlays || []).map((p) => buildLockTape({
      parlay: p,
      fills: fillsByParlay[p.id] || [],
      matches: matchesByParlay[p.id] || [],
      outcomes,
      outcomeByRfq,
      submissions: submissionsByParlay[p.id] || [],
      submissionByRfq,
    }));
  }, [parlays, fillsByParlay, matchesByParlay, outcomes, outcomeByRfq, submissionsByParlay, submissionByRfq]);

  const venueTapes = useMemo(
    () => tapes.map((t) => filterLockTapeByVenue(t, venueFilter)),
    [tapes, venueFilter],
  );

  const visible = useMemo(
    () => sortLockTapes(venueTapes).filter((t) => {
      if (!lockInScope(t, scope)) return false;
      if (venueFilter === "all") return true;
      const stats = scope === "today" ? t.today : t.live;
      return stats.matched > 0;
    }),
    [venueTapes, scope, venueFilter],
  );

  const summary = useMemo(() => buildTapeSummary(venueTapes, { scope }), [venueTapes, scope]);
  const skipSum = skipFillSummary(summary.rfq);
  const watcher = useMemo(() => tapeWatcherState(outcomes), [outcomes]);
  const statsFor = (t) => (scope === "today" ? t.today : t.live);
  const beatFor = (t) => (scope === "today" ? t.todayBeat : t.typicalBeat);
  const beatTitleFor = (t) => (scope === "today" ? t.todayBeatTitle : t.typicalBeatTitle);

  if (!owner) return <div style={{ color: "#6b7280", padding: 40 }}>This tab is private.</div>;

  return (
    <div className="cl">
      <style>{`
        .cl{color:#e8eaed}
        .cl .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px}
        .cl h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin:22px 2px 10px}
        .cl .num{font-variant-numeric:tabular-nums}
        .cl .parlay{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:10px;background:rgba(255,255,255,0.02)}
        .cl .chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:#c3c6cc}
        .cl .chip.fill{background:rgba(59,130,246,.15);color:#93c5fd}
        .cl .chip.warn{background:rgba(245,158,11,.15);color:#fcd34d}
        .cl .chip.ok{background:rgba(16,185,129,.15);color:#6ee7b7}
        .cl .chip.loss{background:rgba(248,113,113,.14);color:#fca5a5}
        .cl .chip.settle-win{background:rgba(16,185,129,.15);color:#6ee7b7}
        .cl .chip.settle-lose{background:rgba(248,113,113,.14);color:#fca5a5}
        .cl .chip.settle-wait{background:rgba(147,197,253,.18);color:#93c5fd}
        .cl .chip.venue-kalshi{background:rgba(6,182,212,.15);color:#67e8f9}
        .cl .chip.venue-poly{background:rgba(91,110,245,.15);color:#a5b4fc}
        .cl .chip.btn{cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);font:inherit;font-size:12px;font-weight:600}
        .cl .chip.btn.on{background:rgba(59,130,246,.2);color:#93c5fd;border-color:rgba(59,130,246,.35)}
        .cl .chip.btn.venue-kalshi.on{background:rgba(6,182,212,.2);color:#67e8f9;border-color:rgba(6,182,212,.35)}
        .cl .chip.btn.venue-poly.on{background:rgba(91,110,245,.2);color:#a5b4fc;border-color:rgba(91,110,245,.35)}
        .cl .leg{display:inline-block;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:2px 7px;margin:2px 4px 2px 0;font-size:13px}
        .cl .leg .ty{font-size:10px;font-weight:700;text-transform:uppercase;color:#7ea2e0;margin-right:5px}
        .cl .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:10px 0}
        .cl .tile{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px}
        .cl .tile .k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280}
        .cl .tile .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:3px}
        .cl .tile .sub{font-size:12px;color:#8a8f98;margin-top:4px;line-height:1.4}
        .cl .bar{height:7px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:6px}
        .cl .bar-fill{height:100%;background:#34d399;border-radius:999px}
        .cl .btn{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#e8eaed;font:inherit;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer}
        .cl .btn.on{background:#3b82f6;border-color:#3b82f6;color:#fff}
        .cl .empty{color:#6b7280;font-size:14px;padding:8px 2px}
        .cl .muted{color:#6b7280}
        .cl .note{font-size:13px;padding:8px 10px;border-radius:8px;margin-top:8px}
        .cl .note.warn{background:rgba(245,158,11,.12);color:#fcd34d}
        .cl table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
        .cl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.1)}
        .cl td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Miss tape</div>
        <span className={"chip " + (watcher.key === "on" ? "ok" : "warn")}>{watcher.label}</span>
        {summary.settlementText && (
          <span className="chip num" title="Official Kalshi combo results only. We sold NO, so Kalshi no = we won and Kalshi yes = we lost.">
            {summary.settlementText}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {SCOPE.map((s) => (
            <button key={s.key} className={"btn" + (scope === s.key ? " on" : "")} onClick={() => setScope(s.key)}>{s.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {VENUE_CHIPS.filter((c) => TAPE_VENUE_FILTERS.includes(c.key)).map((c) => (
            <button
              key={c.key}
              type="button"
              className={"chip btn" + (venueFilter === c.key ? " on" : "") + (c.cls ? " " + c.cls : "")}
              aria-pressed={venueFilter === c.key}
              title={c.key === "all" ? "All venues" : `${c.label} quotes, skips, and fills`}
              onClick={() => setVenueFilter(c.key)}
            >{c.label}</button>
          ))}
        </div>
      </div>
      {watcher.key === "off" && (
        <div className="note warn">Quote-watcher is parked. Open quotes, fills, and skips come from combo_submissions and combo_fills. Later-filled on skips stays unknown until skip-tape is written. Beat amounts stay blank until tape_no_price is written — we will not invent a delta.</div>
      )}
      {loaded && (matches.length >= MATCH_LIMIT || outcomes.length >= OUTCOME_LIMIT || submissions.length >= SUBMISSION_LIMIT) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Showing last {MATCH_LIMIT} matches / {OUTCOME_LIMIT} quote outcomes / {SUBMISSION_LIMIT} submissions ({SKIP_LIMIT} skips + {QUOTE_LIMIT} quoted, newest first). Older rows are not polled.
        </div>
      )}

      <h3>Summary — {scope === "active" ? "active locks" : scope === "today" ? "today, before kickoff" : "all locks, before kickoff"}</h3>
      <div className="card">
        {!loaded ? <div className="empty">Loading…</div> : (
          <>
            <div className="tiles">
              <Tile
                k="Filled vs cap"
                v={`${summary.fill.filled} / ${summary.fill.ceiling}`}
                sub={`${summary.fill.left} left · ${summary.fill.pct}% · ${summary.lockCount} lock${summary.lockCount === 1 ? "" : "s"}`}
                tone={summary.fill.pct >= 100 ? "pos" : undefined}
              />
              <Tile
                k="Matching RFQs"
                v={summary.rfq.matched}
                sub={`${summary.rfq.filled} filled · ${summary.rfq.lost} quoted-and-lost · ${summary.rfq.skipped} skipped`}
              />
              <Tile
                k="Skipped"
                v={skipSum.n}
                sub={skipSum.sub}
                tone={summary.rfq.skippedFilled ? "pos" : (summary.rfq.skipped ? "warn" : undefined)}
              />
              <Tile
                k="Taped outbids"
                v={summary.rfq.tapedOutbid || "—"}
                sub={summary.typicalBeat
                  ? `${summary.rfq.outbid} outbid · ${summary.typicalBeat}`
                  : (summary.rfq.outbid ? `${summary.rfq.outbid} outbid · no tape` : "no taped outbids")}
                tone={summary.rfq.tapedOutbid ? "neg" : "warn"}
                title={summary.typicalBeatTitle || undefined}
              />
            </div>
            <div className="bar"><div className="bar-fill" style={{ width: summary.fill.pct + "%" }} /></div>
          </>
        )}
      </div>

      <h3>Locks</h3>
      <div className="card">
        {!loaded ? <div className="empty">Loading…</div> : visible.length === 0 ? (
          <div className="empty">{scope === "active" ? "No active locks." : "Nothing in this view."}</div>
        ) : visible.map((t) => {
          const p = t.parlay;
          const s = statsFor(t);
          const beat = beatFor(t);
          const beatTitle = beatTitleFor(t);
          const skipLine = skipLockLine(s);
          return (
            <div className="parlay" key={p.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} style={{ padding: "2px 9px" }} title="RFQs before kickoff">
                  {open[p.id] ? "▾" : "▸"}
                </button>
                <span style={{ fontWeight: 700 }}>{p.label}</span>
                <LockVenueChips rows={t.rows} />
                <SettlementChip settlement={t.settlement || settlementFromStored(p)} />
                {t.archived && <span className="chip">archived</span>}
                <span className="chip fill num">fill {fmtAm(p.fill_american)}</span>
                {p.fair_american != null && <span className="chip num">fair {fmtAm(p.fair_american)}</span>}
                <span style={{ flex: 1 }} />
                <span className="muted num" style={{ fontSize: 12 }}>{p.starts_at ? `kickoff ${fmtTime(p.starts_at)}` : "no kickoff"}</span>
              </div>
              <div>{(p.legs || []).map((l, i) => <span className="leg" key={i}><span className="ty">{l.type}</span>{l.label}</span>)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 8 }}>
                <span className="muted">Fill</span>
                <span className="num" style={{ color: t.fill.filled > 0 ? "#34d399" : "#6b7280" }}>
                  {t.fill.filled} of {t.fill.ceiling} · {t.fill.left} left
                </span>
              </div>
              <div className="bar"><div className="bar-fill" style={{ width: t.fill.pct + "%" }} /></div>
              <div style={{ fontSize: 13, color: "#c3c6cc", marginTop: 8 }} className="num">
                {s.matched} matched · {s.quoted} quoted · {s.filled} filled · {s.skipped} skipped · {s.missed} missed
                <span style={{ color: "#8a8f98" }}> — </span>
                <MissChips stats={s} />
              </div>
              {skipLine && (
                <div style={{ fontSize: 13, marginTop: 4 }} className="num">
                  <span className={"chip " + (s.skippedFilled ? "ok" : "warn")}>{skipLine}</span>
                </div>
              )}
              <div style={{ fontSize: 13, marginTop: 4 }} className="num">
                {s.tapedOutbid && beat
                  ? <span className="chip loss" title={beatTitle || undefined}>{`typical beat · ${beat}`}</span>
                  : s.outbid
                    ? <span className="chip warn">outbid {s.outbid} · no tape</span>
                    : null}
                {t.afterKickoff > 0 && <span className="muted" style={{ marginLeft: 8 }}>{t.afterKickoff} after kickoff omitted</span>}
              </div>
              {open[p.id] && <RfqList rows={scope === "today" ? t.rows.filter((r) => isSameLocalDay(r.at)) : t.rows} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
