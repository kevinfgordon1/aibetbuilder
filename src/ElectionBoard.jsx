import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import BookLabel from "./BookLabel.jsx";
import { bookByKey } from "./betstampBooks.js";
import { formatCompactAge, formatWinProb, compactAgeTone, lineIsStale } from "./betstampNormalize.js";
import {
  OBB_BEST_COL_WIDTH,
  OBB_ODDS_COL_WIDTH,
  OBB_TEAM_COL_WIDTH,
  fmtBoardSize,
  ODDS_FLASH_MS,
  oddsMoveDirection,
  sameAmericanPrice,
} from "./oddsBoard.js";
import { formatAmericanOdds } from "./trueOddsLine.js";

// Same 5s cadence as BOARD_POLL_MS in lib/election-board.js.
const POLL_MS = 5000;
const SIDE_H = 72;

const VENUE_LABEL = {
  polymarket: "Polymarket US",
  kalshi: "Kalshi",
  prophetx: "ProphetX",
  robinhood: "Robinhood",
};

const VENUES = ["polymarket", "kalshi", "prophetx"];
const TEAM_W = OBB_TEAM_COL_WIDTH;
const BEST_W = 200;
const ODDS_W = 148;

const AgeNowContext = createContext(0);

function AgeNowProvider({ children }) {
  const [nowMs, setNowMs] = useState(() => Math.floor(Date.now() / 1000) * 1000);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Math.floor(Date.now() / 1000) * 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return <AgeNowContext.Provider value={nowMs}>{children}</AgeNowContext.Provider>;
}

const OddsFlashNumber = memo(function OddsFlashNumber({ price, title }) {
  const prevRef = useRef(price);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    const dir = oddsMoveDirection(prevRef.current, price);
    prevRef.current = price;
    if (!dir) return undefined;
    setFlash(dir);
    const t = setTimeout(() => setFlash(null), ODDS_FLASH_MS);
    return () => clearTimeout(t);
  }, [price]);
  return (
    <span
      data-odds-flash={flash || "none"}
      className={flash ? `obb-flash obb-flash-${flash}` : "obb-flash"}
      title={title || undefined}
      style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
    >
      {price == null ? "—" : formatAmericanOdds(price)}
    </span>
  );
}, (prev, next) => sameAmericanPrice(prev.price, next.price) && prev.title === next.title);

function CellAge({ updatedAt, title }) {
  const nowMs = useContext(AgeNowContext);
  const age = formatCompactAge(updatedAt, nowMs);
  if (!age) return null;
  const stale = lineIsStale(updatedAt, nowMs);
  return (
    <div
      data-line-age={age}
      data-stale={stale ? "1" : "0"}
      title={title || "Last read of this price"}
      className="obb-clip"
      style={{ fontSize: 9, color: stale ? "var(--nob-warn)" : compactAgeTone(updatedAt, nowMs), fontWeight: stale ? 700 : 500, marginTop: 0, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}
    >
      {stale ? `stale ${age}` : `${age} ago`}
    </div>
  );
}

function BoardAge({ updatedAt, loading }) {
  const nowMs = useContext(AgeNowContext);
  const stamp = Date.parse(updatedAt || "");
  const age = formatCompactAge(Number.isFinite(stamp) ? stamp : null, nowMs);
  return (
    <span data-politics-age="1" data-politics-live="1" style={{ color: "var(--nob-good)", fontWeight: 700 }}>
      ● {loading && !updatedAt ? "Loading" : (age ? `${age} ago` : "Live")}
    </span>
  );
}

function shortName(name) {
  const clean = String(name || "").replace(/\s*\([DRIL]\)\s*$/i, "").trim();
  if (/^democratic/i.test(clean)) return "Dem";
  if (/^republican/i.test(clean)) return "GOP";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

function sideNote(quote) {
  if (!quote) return "";
  if (quote.way === "no") {
    const who = shortName(quote.via);
    return who ? `NO on ${who}` : "NO";
  }
  return "YES";
}

function chosenQuote(slot) {
  if (!slot) return null;
  const yes = slot.yes || null;
  const no = slot.no || null;
  if (yes && no) return no.effectivePrice < yes.effectivePrice ? no : yes;
  return yes || no;
}

function quoteTitle(quote) {
  if (!quote) return "";
  const raw = formatAmericanOdds(quote.rawAmerican);
  const contracts = quote.depthContracts > 0 ? `${Math.round(quote.depthContracts).toLocaleString("en-US")} contracts` : "size not on the feed";
  const fee = quote.fee > 0 ? ` · fee $${quote.fee.toFixed(4)}` : "";
  const side = sideNote(quote);
  return `${side} · before fee ${raw}${fee} · ${contracts}`;
}

function venueBook(key) {
  const known = bookByKey(key);
  const label = VENUE_LABEL[key] || (known && known.label) || key;
  return { ...(known || { key, logo: null }), key, label };
}

function everySeconds(ms) {
  const n = Number(ms);
  if (!(n > 0)) return null;
  return Math.round(n / 1000);
}

function sideBox(isBestCol, isBestCell, empty) {
  return {
    padding: "3px 4px",
    lineHeight: 1.15,
    borderBottom: "1px solid var(--nob-divider)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 700,
    textAlign: "center",
    color: empty ? "var(--nob-empty)" : (isBestCol || isBestCell) ? "var(--nob-good)" : "var(--nob-text)",
    background: isBestCell ? "rgba(var(--nob-good-rgb),0.08)" : isBestCol ? "rgba(var(--nob-good-rgb),0.04)" : "transparent",
    boxSizing: "border-box",
    height: SIDE_H,
    maxHeight: SIDE_H,
    overflow: "hidden",
    width: "100%",
  };
}

function QuoteCell({ quote, isBestCol, venueLabel }) {
  const empty = !quote;
  const bestCell = !!(quote && quote.isBest);
  const depth = !empty && quote.depthDollars > 0 ? fmtBoardSize(quote.depthDollars) : null;
  const winProb = isBestCol && quote && quote.american != null ? formatWinProb(quote.american) : null;
  const showAsk = !isBestCol && quote && quote.rawAmerican != null;
  const stamp = quote && quote.quotedAt;
  return (
    <div
      className="obb-side"
      data-quote-way={quote ? quote.way : "empty"}
      data-best={bestCell ? "1" : "0"}
      style={sideBox(isBestCol, bestCell, empty)}
    >
      {empty ? "—" : (
        <>
          <div data-quote-side={quote.way} className="obb-clip" style={{ fontSize: 10, fontWeight: 650, color: "var(--nob-muted)", lineHeight: 1.15 }}>
            {sideNote(quote)}
          </div>
          <div className="obb-clip" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, flexWrap: "nowrap", lineHeight: 1.15, maxWidth: "100%" }}>
            <OddsFlashNumber price={quote.american} title={quoteTitle(quote)} />
            {isBestCol && venueLabel ? (
              <span className="obb-clip" data-best-venue={quote.venue} style={{ fontSize: 10, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>{venueLabel}</span>
            ) : null}
            {depth ? (
              <span data-liq={depth} style={{ fontSize: 9, color: "var(--nob-muted)", fontWeight: 500, lineHeight: 1.15 }}>{depth}</span>
            ) : null}
          </div>
          {showAsk ? (
            <div data-raw-ask={quote.rawAmerican} title={quoteTitle(quote)} className="obb-clip" style={{ fontSize: 10, color: "var(--nob-muted)", fontWeight: 600, marginTop: 1, lineHeight: 1.15 }}>
              ask {formatAmericanOdds(quote.rawAmerican)}
            </div>
          ) : null}
          {winProb ? (
            <div data-win-prob={winProb} title="Implied win probability, after the taker fee" className="obb-clip" style={{ fontSize: 10, color: "var(--nob-muted)", fontWeight: 600, marginTop: 1, lineHeight: 1.15 }}>
              {winProb}
            </div>
          ) : null}
          <CellAge updatedAt={stamp} title={quoteTitle(quote)} />
        </>
      )}
    </div>
  );
}

function headerCell(extra) {
  return {
    padding: "10px 6px",
    textAlign: "center",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--nob-muted)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ...extra,
  };
}

export default function ElectionBoard({ refreshKey = 0 } = {}) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState("all");
  const [search, setSearch] = useState("");
  const boardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let busy = false;

    async function pull(fresh) {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch(fresh ? "/api/election-board?fresh=1" : "/api/election-board", { cache: "no-store" });
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

    pull(true);
    timer = setInterval(() => pull(false), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshKey]);

  const races = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (board && board.races || []).filter((race) => {
      if (office === "arb") {
        if (!race.arb) return false;
      } else if (office !== "all" && race.office !== office) return false;
      if (!q) return true;
      const blob = [race.title, race.state, ...(race.sides || []).map((s) => s.name)].join(" ").toLowerCase();
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

  const prophet = board && board.venues && board.venues.prophetx;
  const robinhood = board && board.venues && board.venues.robinhood;
  const pollSec = everySeconds(board && board.pollMs) || everySeconds(POLL_MS);
  const catalogSec = everySeconds(board && board.catalogMs) || 60;
  const tableWidth = TEAM_W + BEST_W + VENUES.length * ODDS_W;
  const groups = office === "all" || office === "arb"
    ? [["control", "Control"], ["senate", "Senate"], ["governor", "Governor"]]
    : [[office, office === "control" ? "Control" : office === "senate" ? "Senate" : "Governor"]];

  return (
    <AgeNowProvider>
      <div data-politics-board="1" data-politics-layout="moneyline" data-race-count={counts.all} data-poll-ms={POLL_MS}>
        <div style={{ fontSize: 12, color: "var(--nob-text-2)", marginBottom: 8, lineHeight: 1.45 }}>
          Fee-adjusted American odds. Each cell is the best way to back that candidate at that venue: YES on them, or NO on the opponent in a two-candidate race.
          {" "}Kalshi taker fee is 0.07×P×(1−P), rounded up to the next cent on a 1-contract take. Polymarket US is 0.0695×P×(1−P). ProphetX is 2% of net winnings.
          {" "}Green is the best price for that candidate across venues.
        </div>
        <div data-politics-cadence="1" style={{ fontSize: 12, color: "var(--nob-muted)", marginBottom: 8, lineHeight: 1.45 }}>
          Polymarket US, Kalshi, and ProphetX each refresh every {pollSec} seconds. Event lists refresh every {catalogSec} seconds. A cell turns stale after 10 seconds without a new read.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 12, color: "var(--nob-muted)" }}>
          <BoardAge updatedAt={board && board.updatedAt} loading={loading} />
          {board && board.venues && board.venues.polymarket && (
            <span>Polymarket US {board.venues.polymarket.races || 0}</span>
          )}
          {board && board.venues && board.venues.kalshi && (
            <span>Kalshi {board.venues.kalshi.races || 0}{board.venues.kalshi.status === "down" ? " (down)" : ""}</span>
          )}
          {prophet && (
            <span>ProphetX {prophet.races || 0}{prophet.status === "ok" ? "" : " (down)"}</span>
          )}
          {counts.arb > 0 && (
            <span data-arb-count={counts.arb} style={{ color: "var(--nob-gold)", fontWeight: 700 }}>{counts.arb} arb</span>
          )}
        </div>
        {robinhood && robinhood.detail && (
          <div data-venue-notes="1" style={{ fontSize: 12, color: "var(--nob-muted)", marginBottom: 12, lineHeight: 1.45 }}>
            Robinhood: {robinhood.detail}
          </div>
        )}
        {prophet && prophet.status !== "ok" && prophet.detail && (
          <div data-prophet-note="1" style={{ fontSize: 12, color: "var(--nob-warn)", marginBottom: 12, lineHeight: 1.45 }}>
            ProphetX: {prophet.detail}
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
            ["arb", `Arbs ${counts.arb}`],
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
          <div style={{ padding: 28, textAlign: "center", color: "var(--nob-faint)" }}>Loading Polymarket US, Kalshi, and ProphetX…</div>
        )}
        {board && (
          <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--nob-border)" }}>
            <table className="obb-grid" data-politics-table="1" data-col-layout="fixed" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: tableWidth, minWidth: tableWidth }}>
              <colgroup>
                <col data-obb-col="race" style={{ width: TEAM_W }} />
                <col data-obb-col="best" style={{ width: BEST_W }} />
                {VENUES.map((venue) => (
                  <col key={venue} data-obb-col={venue} style={{ width: ODDS_W }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: "var(--nob-head)", borderBottom: "1px solid var(--nob-border)" }}>
                  <th style={{ ...headerCell({ textAlign: "left", padding: "10px 12px", letterSpacing: 1, width: TEAM_W, position: "sticky", left: 0, background: "var(--nob-head)", zIndex: 2 }) }}>Race</th>
                  <th data-book-header="best" style={{ ...headerCell({ color: "var(--nob-good)", width: BEST_W }) }}>Best Odds</th>
                  {VENUES.map((venue) => (
                    <th key={venue} data-book-header={venue} title={VENUE_LABEL[venue]} style={{ ...headerCell({ width: ODDS_W, textTransform: "none", letterSpacing: 0 }) }}>
                      <span className="obb-clip" style={{ display: "inline-flex", maxWidth: "100%", justifyContent: "center" }}>
                        <BookLabel book={venueBook(venue)} size={14} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {races.length === 0 && (
                  <tr>
                    <td colSpan={2 + VENUES.length} style={{ padding: 28, textAlign: "center", color: "var(--nob-faint)" }}>
                      {office === "arb" ? "No races priced under 100% after fees." : search ? `No races for "${search}"` : "No election markets on these feeds."}
                    </td>
                  </tr>
                )}
                {groups.map(([groupId, groupLabel]) => {
                  const rows = races.filter((race) => race.office === groupId);
                  if (!rows.length) return null;
                  return (
                    <GroupRows
                      key={groupId}
                      label={groupLabel}
                      races={rows}
                      colSpan={2 + VENUES.length}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AgeNowProvider>
  );
}

function GroupRows({ label, races, colSpan }) {
  return (
    <>
      <tr style={{ background: "var(--nob-warm)", borderBottom: "1px solid var(--nob-divider)" }}>
        <td colSpan={colSpan} style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "var(--nob-gold)", textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</td>
      </tr>
      {races.map((race) => (
        <RaceRows key={race.id} race={race} colSpan={colSpan} />
      ))}
    </>
  );
}

function RaceRows({ race, colSpan }) {
  const profit = race.arb ? (race.arb.edge * 100).toFixed(1) : null;
  return (
    <>
      <tr data-race-id={race.id} data-arb={race.arb ? "1" : "0"}>
        <td colSpan={colSpan} style={{ padding: "6px 10px", background: "var(--nob-surface)", borderBottom: "1px solid var(--nob-divider)" }}>
          <div style={{ position: "sticky", left: 0, width: "max-content", maxWidth: "100%", display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "baseline" }}>
            <div className="obb-game-name" style={{ fontWeight: 750, color: "var(--nob-text)", fontSize: 13 }}>{race.title}</div>
            {race.kalshiBasis === "party" && (
              <div data-kalshi-basis="party" style={{ fontSize: 10, color: "var(--nob-warn)", fontWeight: 700 }}>Kalshi party contract</div>
            )}
            {race.kalshiBasis === "candidate" && (
              <div data-kalshi-basis="candidate" style={{ fontSize: 10, color: "var(--nob-text-2)", fontWeight: 700 }}>Kalshi candidate contract</div>
            )}
            {race.kalshiBasis === "mixed" && (
              <div data-kalshi-basis="mixed" style={{ fontSize: 10, color: "var(--nob-warn)", fontWeight: 700 }}>Kalshi party and candidate</div>
            )}
            {race.arb && (
              <div data-arb-legs="1" data-arb-edge={race.arb.edge} style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 11, lineHeight: 1.35 }}>
                <span style={{ fontWeight: 800, color: "var(--nob-gold)" }}>Arb · {profit}%</span>
                {(race.arb.legs || []).map((leg) => (
                  <span key={`${leg.name}:${leg.venue}:${leg.way}`} data-arb-leg={`${leg.venue}:${leg.way}`} style={{ color: "var(--nob-text-2)", fontWeight: 650 }}>
                    {VENUE_LABEL[leg.venue] || leg.venue} · {leg.way === "no" ? "NO" : "YES"} · {formatAmericanOdds(leg.american)}
                    <span style={{ color: "var(--nob-faint)", fontWeight: 600 }}> {shortName(leg.name)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </td>
      </tr>
      {race.sides.map((side) => (
        <tr key={`${race.id}:${side.key}`} data-race-id={race.id} data-side={side.name}>
          <td style={{ padding: "0 10px", height: SIDE_H, width: TEAM_W, maxWidth: TEAM_W, overflow: "hidden", position: "sticky", left: 0, background: "var(--nob-surface)", zIndex: 1, borderRight: "1px solid var(--nob-border)", borderBottom: "1px solid var(--nob-divider)", verticalAlign: "middle" }}>
            <div className="obb-game-name" title={side.name} style={{ fontSize: 13, fontWeight: 650, color: "var(--nob-text)", lineHeight: 1.2 }}>
              {side.name}
              {side.party ? <span style={{ marginLeft: 6, color: "var(--nob-faint)", fontWeight: 650 }}>{side.party}</span> : null}
            </div>
          </td>
          <td data-obb-cell="best" style={{ padding: 0, width: BEST_W, maxWidth: BEST_W, overflow: "hidden", textAlign: "center", verticalAlign: "middle" }}>
            <QuoteCell
              quote={side.best ? {
                ...side.best,
                isBest: true,
                fee: null,
                depthContracts: null,
              } : null}
              isBestCol
              venueLabel={side.best ? (VENUE_LABEL[side.best.venue] || side.best.venue) : ""}
            />
          </td>
          {VENUES.map((venue) => {
            const quote = chosenQuote(side.venues && side.venues[venue]);
            return (
              <td key={venue} data-obb-cell={venue} style={{ padding: 0, width: ODDS_W, maxWidth: ODDS_W, overflow: "hidden", textAlign: "center", verticalAlign: "middle" }}>
                <QuoteCell quote={quote} isBestCol={false} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
