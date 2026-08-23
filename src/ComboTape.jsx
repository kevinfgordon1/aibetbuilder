// Combo miss-tape — fill closeness + missed RFQs + taped outbid beat.
// Same owner gate and polls as Combo Locks. Quote-watcher may be parked:
// outbid counts still render; beat amounts only when tape columns exist.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { formatCents } from "./comboDesk";
import { OWNER_EMAIL } from "./ComboLocks";
import {
  buildLockTape,
  buildTapeSummary,
  formatAmerican,
  formatBeat,
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
// Same newest-first caps as ComboLocks.jsx — do not page the firehose.
const MATCH_LIMIT = 400;
const OUTCOME_LIMIT = 200;
const SKIP_LIMIT = 400;

const fmtAm = (a) => formatAmerican(a) || "—";
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");

function reasonLabel(row) {
  if (row.bucket === "filled") return "filled";
  if (row.bucket === "awaiting") return "awaiting";
  if (row.bucket === "outbid") return row.tape ? "outbid" : "outbid · no tape";
  if (row.bucket === "too_slow") return "too slow";
  if (row.bucket === "no_taker") return "no taker";
  if (row.bucket === "oversized" || row.bucket === "skipped") return formatSkipReason(row);
  return row.reason || "lost";
}

function reasonColor(row) {
  const bucket = row && row.bucket;
  if (bucket === "filled" || (row && row.skipFill === "filled")) return "#6ee7b7";
  if (bucket === "outbid") return "#fca5a5";
  if (bucket === "too_slow" || bucket === "oversized") return "#fcd34d";
  if (bucket === "awaiting") return "#93c5fd";
  return "#9aa3b2";
}

function Tile({ k, v, sub, tone }) {
  const color = tone === "pos" ? "#34d399" : tone === "neg" ? "#f87171" : tone === "warn" ? "#fcd34d" : "#e8eaed";
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v num" style={{ color }}>{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
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
  const list = [...(rows || [])].sort((a, b) => {
    if (a.missed !== b.missed) return a.missed ? -1 : 1;
    return Date.parse(b.at || 0) - Date.parse(a.at || 0);
  });
  if (!list.length) return <div className="empty">No matching RFQs before kickoff.</div>;
  const shown = list.slice(0, RFQ_CAP);
  const extra = list.length - shown.length;
  return (
    <>
    <table>
      <thead>
        <tr>
          <th>Time</th>
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
          const tape = r.tapeNo != null
            ? formatCents(r.tapeNo)
            : (r.bucket === "outbid" ? "no tape" : (r.skipFill === "none" ? "no print" : "—"));
          return (
            <tr key={r.rfqId || `${r.at}-${r.contracts}`}>
              <td>{r.at ? new Date(r.at).toLocaleTimeString() : "—"}</td>
              <td className="num">{r.contracts != null ? r.contracts : "—"}</td>
              <td className="num">{r.ourNo != null ? `NO $${Number(r.ourNo).toFixed(2)}` : "—"}</td>
              <td className="num">{tape}</td>
              <td className="num" style={{ color: r.bucket === "outbid" ? "#fca5a5" : "#8a8f98" }}>{beat}</td>
              <td style={{ color: reasonColor(r) }}>{reasonLabel(r)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {extra > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing {shown.length} of {list.length} (misses first). {extra} more omitted.</div>}
    </>
  );
}

export default function ComboTape({ user }) {
  const owner = user && user.email === OWNER_EMAIL;
  const [scope, setScope] = useState("active");
  const [parlays, setParlays] = useState([]);
  const [fills, setFills] = useState([]);
  const [matches, setMatches] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [skips, setSkips] = useState([]);
  const [open, setOpen] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [poll, setPoll] = useState(false);

  const reload = useCallback(async (mode = "full") => {
    if (!owner) return;
    if (mode === "tick") {
      const { data: peek } = await supabase
        .from("combo_parlays")
        .select("id,active,archived_at")
        .is("archived_at", null);
      if (!hasQuotingParlays(peek)) {
        setPoll(false);
        return;
      }
    }
    const [living, archived, fillRows, matchRows, outcomeRows, skipRows] = await Promise.all([
      supabase.from("combo_parlays").select("*").is("archived_at", null).order("created_at", { ascending: false }),
      supabase.from("combo_parlays").select("*").not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(100),
      supabase.from("combo_fills").select("parlay_id,count,is_combo,is_taker,ticker,raw,kalshi_created_time,recorded_at").eq("is_combo", true).eq("is_taker", false),
      supabase.from("combo_matches").select("*").order("matched_at", { ascending: false }).limit(MATCH_LIMIT),
      supabase.from("quote_outcomes").select("*").order("updated_at", { ascending: false }).limit(OUTCOME_LIMIT),
      supabase.from("combo_submissions").select("*").in("status", ["declined", "limitreached"]).order("created_at", { ascending: false }).limit(SKIP_LIMIT),
    ]);
    const livingRows = living.data || [];
    setParlays([...livingRows, ...(archived.data || [])]);
    setFills(fillRows.data || []);
    setMatches(matchRows.data || []);
    setOutcomes(outcomeRows.data || []);
    setSkips(skipRows.data || []);
    setLoaded(true);
    setPoll(hasQuotingParlays(livingRows));
  }, [owner]);

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

  const skipByRfq = useMemo(() => {
    const m = {};
    (skips || []).forEach((s) => { if (s.rfq_id && !m[s.rfq_id]) m[s.rfq_id] = s; });
    return m;
  }, [skips]);

  const skipsByParlay = useMemo(() => {
    const m = {};
    (skips || []).forEach((row) => {
      if (!row.parlay_id) return;
      (m[row.parlay_id] = m[row.parlay_id] || []).push(row);
    });
    return m;
  }, [skips]);

  const tapes = useMemo(() => {
    return (parlays || []).map((p) => buildLockTape({
      parlay: p,
      fills: fillsByParlay[p.id] || [],
      matches: matchesByParlay[p.id] || [],
      outcomes,
      outcomeByRfq,
      submissions: skipsByParlay[p.id] || [],
      submissionByRfq: skipByRfq,
    }));
  }, [parlays, fillsByParlay, matchesByParlay, outcomes, outcomeByRfq, skipsByParlay, skipByRfq]);

  const visible = useMemo(
    () => sortLockTapes(tapes).filter((t) => lockInScope(t, scope)),
    [tapes, scope],
  );

  const summary = useMemo(() => buildTapeSummary(tapes, { scope }), [tapes, scope]);
  const skipSum = skipFillSummary(summary.rfq);
  const watcher = useMemo(() => tapeWatcherState(outcomes), [outcomes]);
  const statsFor = (t) => (scope === "today" ? t.today : t.live);
  const beatFor = (t) => (scope === "today" ? t.todayBeat : t.typicalBeat);

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
      </div>
      {watcher.key === "off" && (
        <div className="note warn">Quote-watcher is parked. Outbid / skip counts still come from matches and declined submissions. Later-filled on skips stays unknown until skip-tape is written. Beat amounts stay blank until tape_no_price is written — we will not invent a delta.</div>
      )}
      {loaded && (matches.length >= MATCH_LIMIT || outcomes.length >= OUTCOME_LIMIT || skips.length >= SKIP_LIMIT) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Showing last {MATCH_LIMIT} matches / {OUTCOME_LIMIT} quote outcomes / {SKIP_LIMIT} declined skips (newest first). Older rows are not polled.
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
          const skipLine = skipLockLine(s);
          return (
            <div className="parlay" key={p.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} style={{ padding: "2px 9px" }} title="RFQs before kickoff">
                  {open[p.id] ? "▾" : "▸"}
                </button>
                <span style={{ fontWeight: 700 }}>{p.label}</span>
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
                  ? <span className="chip loss">{`typical beat · ${beat}`}</span>
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
