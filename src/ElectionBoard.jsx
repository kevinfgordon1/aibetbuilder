import { useEffect, useMemo, useRef, useState } from "react";
import { formatAmericanOdds } from "./trueOddsLine.js";
import { ODDS_FLASH_MS } from "./oddsBoard.js";

const POLL_MS = 1500;

const VENUE_LABEL = {
  polymarket: "Polymarket US",
  kalshi: "Kalshi",
  prophetx: "ProphetX",
};

function formatDollars(n) {
  const v = Number(n);
  if (!(v > 0)) return "";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function shortName(name) {
  const clean = String(name || "").replace(/\s*\([DRIL]\)\s*$/i, "").trim();
  if (/^democratic/i.test(clean)) return "Dem";
  if (/^republican/i.test(clean)) return "GOP";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

function quoteTitle(quote) {
  if (!quote) return "";
  const raw = formatAmericanOdds(quote.rawAmerican);
  const contracts = quote.depthContracts > 0 ? `${Math.round(quote.depthContracts).toLocaleString("en-US")} contracts` : "size not on the feed";
  const fee = quote.fee > 0 ? `fee $${quote.fee.toFixed(4)}` : "no fee";
  return `Before fee ${raw} · ${fee} · ${contracts}`;
}

function ageLabel(updatedAt, nowMs) {
  const t = Date.parse(updatedAt || "");
  if (!Number.isFinite(t)) return "waiting";
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 2) return "just now";
  return `${sec}s ago`;
}

function QuoteCell({ quote, flash, way }) {
  const empty = !quote;
  const best = !!(quote && quote.isBest);
  return (
    <td
      data-quote-way={way}
      data-best={best ? "1" : "0"}
      title={quoteTitle(quote)}
      style={{
        padding: "8px 6px",
        textAlign: "center",
        borderBottom: "1px solid var(--nob-divider)",
        borderLeft: "1px solid var(--nob-divider)",
        background: best ? "rgba(var(--nob-good-rgb),0.10)" : "transparent",
        color: empty ? "var(--nob-empty)" : best ? "var(--nob-good)" : "var(--nob-text)",
        verticalAlign: "middle",
        minWidth: 92,
      }}
    >
      {empty ? (
        "—"
      ) : (
        <>
          <span className={flash ? `obb-flash obb-flash-${flash}` : "obb-flash"} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700 }}>
            {formatAmericanOdds(quote.american)}
          </span>
          {quote.depthDollars > 0 && (
            <div style={{ marginTop: 2, fontSize: 10, fontWeight: 650, color: "var(--nob-muted)", fontFamily: "'DM Sans', sans-serif" }}>
              {formatDollars(quote.depthDollars)}
            </div>
          )}
          {way === "no" && quote.via && (
            <div style={{ marginTop: 1, fontSize: 10, color: "var(--nob-faint)", fontWeight: 600 }}>
              on {shortName(quote.via)}
            </div>
          )}
        </>
      )}
    </td>
  );
}

export default function ElectionBoard({ refreshKey = 0 } = {}) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState("all");
  const [search, setSearch] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [flash, setFlash] = useState({});
  const prevRef = useRef(new Map());
  const boardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let busy = false;

    async function pull() {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch("/api/election-board", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) {
          setError("Election books did not answer.");
          setLoading(false);
          return;
        }
        setError("");
        setBoard(body);
        boardRef.current = body;
        setLoading(false);
      } catch (_) {
        if (!cancelled) {
          setError(boardRef.current ? "Feed stalled. Showing the last book." : "Election books did not answer.");
          setLoading(false);
        }
      } finally {
        busy = false;
      }
    }

    pull();
    timer = setInterval(pull, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshKey]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!board) return undefined;
    const next = new Map();
    const flashes = {};
    for (const race of board.races || []) {
      for (const side of race.sides || []) {
        for (const venue of Object.keys(side.venues || {})) {
          for (const way of ["yes", "no"]) {
            const quote = side.venues[venue] && side.venues[venue][way];
            if (!quote) continue;
            const key = `${race.id}|${side.key}|${venue}|${way}`;
            next.set(key, quote.effectivePrice);
            const prev = prevRef.current.get(key);
            if (prev != null && Math.abs(prev - quote.effectivePrice) > 1e-6) {
              flashes[key] = quote.effectivePrice < prev ? "up" : "down";
            }
          }
        }
      }
    }
    const first = prevRef.current.size === 0;
    prevRef.current = next;
    if (first || !Object.keys(flashes).length) return undefined;
    setFlash(flashes);
    const timer = setTimeout(() => setFlash({}), ODDS_FLASH_MS);
    return () => clearTimeout(timer);
  }, [board]);

  const showProphet = !!(board && board.venues && board.venues.prophetx && (board.venues.prophetx.races > 0 || board.venues.prophetx.status === "ok"));
  const venues = showProphet ? ["polymarket", "kalshi", "prophetx"] : ["polymarket", "kalshi"];

  const races = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (board && board.races || []).filter((race) => {
      if (office !== "all" && race.office !== office) return false;
      if (!q) return true;
      const blob = [
        race.title,
        race.state,
        ...(race.sides || []).map((s) => s.name),
      ].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [board, office, search]);

  const counts = useMemo(() => {
    const all = board && board.races || [];
    return {
      all: all.length,
      control: all.filter((r) => r.office === "control").length,
      senate: all.filter((r) => r.office === "senate").length,
      governor: all.filter((r) => r.office === "governor").length,
      arb: all.filter((r) => r.arb).length,
    };
  }, [board]);

  const prophetDetail = board && board.venues && board.venues.prophetx && board.venues.prophetx.detail;
  const robinhoodDetail = board && board.venues && board.venues.robinhood && board.venues.robinhood.detail;

  return (
    <div data-politics-board="1" data-race-count={counts.all}>
      <div style={{ fontSize: 12, color: "var(--nob-text-2)", marginBottom: 8, lineHeight: 1.45 }}>
        Fee-adjusted American odds. Kalshi taker fee is 0.07×P×(1−P), rounded up to the next cent on a 1-contract take. Polymarket US is 0.0695×P×(1−P). ProphetX is 2% of net winnings.
        {" "}YES buys that side. On a two-candidate race, NO buys the other side’s no, which pays if this side wins.
        {" "}Green is the best price for that candidate across venues.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 12, color: "var(--nob-muted)" }}>
        <span data-politics-age="1" style={{ color: "var(--nob-good)", fontWeight: 700 }}>
          ● {loading ? "Loading" : ageLabel(board && board.updatedAt, nowMs)}
        </span>
        {board && board.venues && board.venues.polymarket && (
          <span>Polymarket US {board.venues.polymarket.races || 0}</span>
        )}
        {board && board.venues && board.venues.kalshi && (
          <span>Kalshi {board.venues.kalshi.races || 0}{board.venues.kalshi.status === "down" ? " (down)" : ""}</span>
        )}
        {counts.arb > 0 && (
          <span data-arb-count={counts.arb} style={{ color: "var(--nob-gold)", fontWeight: 700 }}>{counts.arb} arb</span>
        )}
      </div>
      {(prophetDetail || robinhoodDetail) && (
        <div data-venue-notes="1" style={{ fontSize: 12, color: "var(--nob-muted)", marginBottom: 12, lineHeight: 1.45 }}>
          {prophetDetail ? `ProphetX: ${prophetDetail}` : ""}
          {prophetDetail && robinhoodDetail ? " " : ""}
          {robinhoodDetail ? `Robinhood: ${robinhoodDetail}` : ""}
        </div>
      )}
      {error && (
        <div data-politics-error="1" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(var(--nob-warn-rgb),0.45)", color: "var(--nob-warn)", marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ["all", `All ${counts.all}`],
          ["control", `Control ${counts.control}`],
          ["senate", `Senate ${counts.senate}`],
          ["governor", `Governor ${counts.governor}`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-politics-filter={id}
            onClick={() => setOffice(id)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              fontWeight: 650,
              cursor: "pointer",
              background: office === id ? "var(--nob-gold)" : "var(--nob-chip)",
              color: office === id ? "var(--nob-on-gold)" : "var(--nob-text-2)",
              boxShadow: office === id ? "none" : "inset 0 0 0 1px var(--nob-border)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search state or candidate"
        data-politics-search="1"
        style={{ width: "100%", maxWidth: 360, background: "var(--nob-chip)", border: "1px solid var(--nob-border-strong)", borderRadius: 8, color: "var(--nob-text)", padding: "10px 14px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 14, boxSizing: "border-box", outline: "none" }}
      />
      {loading && !board && (
        <div style={{ padding: 28, textAlign: "center", color: "var(--nob-faint)" }}>Loading Polymarket US and Kalshi election books…</div>
      )}
      {board && (
        <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--nob-border)" }}>
          <table data-politics-table="1" style={{ borderCollapse: "collapse", width: "100%", minWidth: showProphet ? 980 : 820 }}>
            <thead>
              <tr style={{ background: "var(--nob-head)" }}>
                <th style={headStyle(180, true)}>Race</th>
                <th style={headStyle(160, true)}>Candidate</th>
                {venues.map((venue) => (
                  <th key={venue} colSpan={2} style={{ ...headStyle(180), textAlign: "center", color: "var(--nob-gold)" }}>
                    {VENUE_LABEL[venue]}
                  </th>
                ))}
                <th style={{ ...headStyle(110), textAlign: "center", color: "var(--nob-good)" }}>Best</th>
              </tr>
              <tr style={{ background: "var(--nob-head)", borderBottom: "1px solid var(--nob-border)" }}>
                <th style={headStyle(180)} />
                <th style={headStyle(160)} />
                {venues.map((venue) => (
                  ["YES", "NO"].map((way) => (
                    <th key={`${venue}-${way}`} style={{ ...headStyle(90), textAlign: "center", fontSize: 10 }}>
                      {way}
                    </th>
                  ))
                ))}
                <th style={headStyle(110)} />
              </tr>
            </thead>
            <tbody>
              {races.length === 0 && (
                <tr>
                  <td colSpan={4 + venues.length * 2} style={{ padding: 28, textAlign: "center", color: "var(--nob-faint)" }}>
                    {search ? `No races for "${search}"` : "No election markets on these feeds."}
                  </td>
                </tr>
              )}
              {races.map((race) => race.sides.map((side, index) => {
                const flashKey = (venue, way) => flash[`${race.id}|${side.key}|${venue}|${way}`] || "";
                return (
                  <tr key={`${race.id}:${side.key}`} data-race-id={race.id} data-side={side.name} data-arb={race.arb && index === 0 ? "1" : "0"}>
                    {index === 0 && (
                      <td rowSpan={race.sides.length} style={{ padding: "10px 12px", borderBottom: "1px solid var(--nob-border)", verticalAlign: "top", background: "var(--nob-surface)", minWidth: 180 }}>
                        <div style={{ fontWeight: 750, color: "var(--nob-text)", fontSize: 14 }}>{race.title}</div>
                        {race.kalshiBasis === "party" && (
                          <div data-kalshi-basis="party" style={{ marginTop: 4, fontSize: 11, color: "var(--nob-warn)", fontWeight: 700 }}>Kalshi party contract</div>
                        )}
                        {race.kalshiBasis === "candidate" && (
                          <div data-kalshi-basis="candidate" style={{ marginTop: 4, fontSize: 11, color: "var(--nob-text-2)", fontWeight: 700 }}>Kalshi candidate contract</div>
                        )}
                        {race.kalshiBasis === "mixed" && (
                          <div data-kalshi-basis="mixed" style={{ marginTop: 4, fontSize: 11, color: "var(--nob-warn)", fontWeight: 700 }}>Kalshi party and candidate</div>
                        )}
                        {race.arb && (
                          <div data-arb-edge={race.arb.edge} style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: "var(--nob-gold)" }}>
                            Arb · ${race.arb.cost.toFixed(3)} per $1 · {(race.arb.edge * 100).toFixed(1)}¢
                          </div>
                        )}
                        {race.notes && race.notes[0] && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "var(--nob-faint)", lineHeight: 1.35, maxWidth: 220 }}>{race.notes[0]}</div>
                        )}
                      </td>
                    )}
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--nob-divider)", fontWeight: 700, fontSize: 13, color: "var(--nob-text)" }}>
                      {side.name}
                      {side.party ? <span style={{ marginLeft: 6, color: "var(--nob-faint)", fontWeight: 650 }}>{side.party}</span> : null}
                    </td>
                    {venues.map((venue) => (
                      ["yes", "no"].map((way) => (
                        <QuoteCell
                          key={`${venue}-${way}`}
                          way={way}
                          quote={side.venues && side.venues[venue] && side.venues[venue][way]}
                          flash={flashKey(venue, way)}
                        />
                      ))
                    ))}
                    <td style={{ padding: "8px 8px", textAlign: "center", borderBottom: "1px solid var(--nob-divider)", borderLeft: "1px solid var(--nob-border)", background: "rgba(var(--nob-good-rgb),0.05)" }}>
                      {side.best ? (
                        <>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: "var(--nob-good)", fontSize: 14 }}>
                            {formatAmericanOdds(side.best.american)}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: "var(--nob-text-2)" }}>
                            {VENUE_LABEL[side.best.venue] || side.best.venue} {side.best.way === "no" ? "NO" : "YES"}
                          </div>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function headStyle(minWidth, left) {
  return {
    padding: "8px 10px",
    textAlign: left ? "left" : "center",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--nob-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    minWidth,
  };
}
