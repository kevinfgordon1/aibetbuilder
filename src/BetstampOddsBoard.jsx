import { Fragment, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { formatAmericanOdds } from "./trueOddsLine.js";
import {
  fmtBoardSize,
  bestBooksTitle,
  formatDateGroup,
  getOddsBoardCell,
  getBestForGame,
  LIVE_BEST_ODDS_MAX_AGE_MS,
  LIVE_BEST_ODDS_BREAK_MAX_AGE_MS,
  oddsBoardHideKey,
  oddsBoardHideGameKey,
  isHiddenOddsCell,
  isHiddenOddsGame,
  toggleOddsBoardHideKey,
  clearHiddenOddsGames,
  filterHiddenOddsGames,
  isStackedBestMatch,
  oddsBoardSidePoint,
  oddsMoveDirection,
  sameAmericanPrice,
  ODDS_FLASH_MS,
  STACKED_BEST_MAX_LINES,
  OBB_TEAM_COL_WIDTH,
  OBB_ODDS_COL_WIDTH,
  OBB_BEST_COL_WIDTH,
  OBB_SIDE_CELL_HEIGHT,
  obbColWidth,
  obbTableWidth,
  padBestPointStacks,
  boardShowsPointLine,
} from "./oddsBoard.js";
import {
  applyBookColumnOrder,
  applyGameRowOrder,
  groupGamesPreservingOrder,
  loadOddsBoardOrder,
  moveKeyAmongVisible,
  moveKeyByOffset,
  oddsBoardSlateKey,
  saveOddsBoardOrder,
} from "./oddsBoardOrder.js";
import {
  BETSTAMP_SPORTS,
  BETSTAMP_DEFAULT_SPORT,
  bookByKey,
  leagueForSport,
} from "./betstampBooks.js";
import BookLabel from "./BookLabel.jsx";
import {
  liveBoardPaintKey,
  liveGamePaintKey,
  gameVisibleOnBoard,
  emptyTickStats,
  recordTicks,
  summarizeTickStats,
  formatCompactAge,
  compactAgeTone,
  staleLiveBookLabels,
  formatWinProb,
  cellShowsWinProb,
  cellLineFields,
  lineUpdatedAt,
  lineIsSuspended,
  bestLineUpdatedAt,
} from "./betstampNormalize.js";
import { fetchUnderdogPhone } from "./underdogPhoneClient.js";
import {
  firstPartyPmLiveEnabled,
  polymarketStreamUrl,
  kalshiStreamUrl,
  kalshiBoardUrl,
  novigStreamUrl,
  fourcastersStreamUrl,
} from "./venueLive.js";
import { consumeBetstampStream, nextBackoffMs } from "./betstampLive.js";
import {
  FREE_FEED_POLL_MS,
  FREE_FEED_LIVE_POLL_MS,
  freeFeedBooks,
  gamesFromFreeFeeds,
  kalshiQuotesFromBoardBody,
  mainLaddersFromGame,
  mergeVenueQuotes,
} from "./freeFeedBoard.js";

const BestBookName = memo(function BestBookName({ book, extra = 0, title, size = 13 }) {
  if (!book) return null;
  return (
    <span
      title={title || book.label}
      data-book-mark={book.key}
      data-book-full-name={book.label}
      className="obb-clip"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, verticalAlign: "middle", minWidth: 0, maxWidth: "100%", flexWrap: "nowrap", justifyContent: "center" }}
    >
      <BookLabel book={book} size={size} />
      {extra > 0 && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>+{extra}</span>
      )}
    </span>
  );
});

// 1s age clock and 5s Best-freshness clock live in these providers — not in
// BetstampOddsBoard state. A parent setState every second rebuilt every odds
// <td> (GAME is sticky/opaque so it visually survived; BEST + books blanked).
const AgeNowContext = createContext(0);
const BestNowContext = createContext(0);

function AgeNowProvider({ children }) {
  const [ageNowMs, setAgeNowMs] = useState(() => Math.floor(Date.now() / 1000) * 1000);
  useEffect(() => {
    const id = setInterval(() => setAgeNowMs(Math.floor(Date.now() / 1000) * 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return <AgeNowContext.Provider value={ageNowMs}>{children}</AgeNowContext.Provider>;
}

function BestNowProvider({ children }) {
  const [bestNowMs, setBestNowMs] = useState(() => Math.floor(Date.now() / 5000) * 5000);
  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.floor(Date.now() / 5000) * 5000;
      setBestNowMs((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <BestNowContext.Provider value={bestNowMs}>{children}</BestNowContext.Provider>;
}

const OddsFlashNumber = memo(function OddsFlashNumber({ price, suspended, flashKey }) {
  const prevRef = useRef({ key: flashKey, price, suspended: !!suspended });
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev.key !== flashKey) {
      prevRef.current = { key: flashKey, price, suspended: !!suspended };
      setFlash(null);
      return undefined;
    }
    if (suspended || price == null) {
      prevRef.current = { key: flashKey, price, suspended: !!suspended };
      setFlash(null);
      return undefined;
    }
    const dir = !prev.suspended && prev.price != null
      ? oddsMoveDirection(prev.price, price)
      : null;
    prevRef.current = { key: flashKey, price, suspended: false };
    if (!dir) return undefined;
    setFlash(dir);
    const t = setTimeout(() => setFlash(null), ODDS_FLASH_MS);
    return () => clearTimeout(t);
  }, [flashKey, price, suspended]);

  if (suspended) return null;
  return (
    <span
      data-odds-flash={flash || "none"}
      className={flash ? `obb-flash obb-flash-${flash}` : undefined}
      style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
    >
      {price == null ? "—" : formatAmericanOdds(price)}
    </span>
  );
}, (prev, next) => (
  prev.flashKey === next.flashKey
  && !!prev.suspended === !!next.suspended
  && sameAmericanPrice(prev.price, next.price)
));

function LineAge({ updatedAt, ageTitle }) {
  const nowMs = useContext(AgeNowContext);
  const age = formatCompactAge(updatedAt, nowMs);
  if (!age) return null;
  const clock = updatedAt ? fmtClock(updatedAt) : "";
  return (
    <div
      data-line-age={age}
      title={ageTitle || (clock ? `Last update ${clock}` : "Last update")}
      className="obb-clip"
      style={{ fontSize: 9, color: compactAgeTone(updatedAt, nowMs), fontWeight: 500, marginTop: 0, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}
    >
      {age}
    </div>
  );
}

function LiquidityCue({ size, inline = false }) {
  const label = fmtBoardSize(size);
  if (!label) return null;
  return (
    <span data-liq={label} style={{ fontSize: 9, color: "#6b7280", fontWeight: 500, lineHeight: 1.15, display: inline ? "inline" : "block" }}>
      {label}
    </span>
  );
}

const OddsSide = memo(function OddsSide({ price, size, line, books, allBooks, showBestMark, updatedAt, ageTitle, showWinProb, suspended, flashKey }) {
  const primary = books?.[0];
  const book = primary ? bookByKey(primary.key) : null;
  const title = bestBooksTitle(books, (k) => bookByKey(k)?.label);
  const winProb = showWinProb && price != null && !suspended ? formatWinProb(price) : null;
  if (suspended) {
    return (
      <>
        {line && (
          <div className="obb-clip" data-odds-line={line} style={{ fontSize: 10, color: "#78716c", fontWeight: 500, marginBottom: 2, lineHeight: 1.15, textDecoration: "line-through", opacity: 0.7 }}>
            {line}
          </div>
        )}
        <div
          className="obb-off"
          data-odds-suspended="1"
          data-odds-off="1"
          title="Off the board — this feed no longer lists this line"
        >
          <span>OFF</span>
          <span className="obb-off-sub">the board</span>
        </div>
      </>
    );
  }
  return (
    <>
      {line && <div className="obb-clip" data-odds-line={line} style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 0, lineHeight: 1.15 }}>{line}</div>}
      <div className="obb-clip" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, flexWrap: "nowrap", lineHeight: 1.15, maxWidth: "100%" }}>
        <OddsFlashNumber price={price} suspended={false} flashKey={flashKey} />
        {showBestMark && price != null && book && (
          <BestBookName book={book} extra={Math.max(0, (books?.length || 0) - 1)} title={title} />
        )}
        <LiquidityCue size={size} inline />
      </div>
      {winProb && (
        <div
          data-win-prob={winProb}
          title="Implied win probability"
          className="obb-clip"
          style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, marginTop: 1, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.15 }}
        >
          {winProb}
        </div>
      )}
      {price != null && (
        <LineAge updatedAt={updatedAt} ageTitle={ageTitle} />
      )}
    </>
  );
}, (prev, next) => (
  prev.flashKey === next.flashKey
  && !!prev.suspended === !!next.suspended
  && !!prev.showBestMark === !!next.showBestMark
  && !!prev.showWinProb === !!next.showWinProb
  && prev.line === next.line
  && prev.size === next.size
  && prev.updatedAt === next.updatedAt
  && prev.ageTitle === next.ageTitle
  && sameAmericanPrice(prev.price, next.price)
  && (prev.books?.[0]?.key || "") === (next.books?.[0]?.key || "")
  && (prev.books?.length || 0) === (next.books?.length || 0)
));

function boardHideSide(marketKey, which) {
  if (marketKey === "tot") return which === "top" ? "over" : "under";
  return which === "top" ? "away" : "home";
}

function matchesBoardSearch(g, q) {
  if (!q) return true;
  return (
    g.away.toLowerCase().includes(q) ||
    g.home.toLowerCase().includes(q) ||
    (g.awayAbbr || "").toLowerCase().includes(q) ||
    (g.homeAbbr || "").toLowerCase().includes(q)
  );
}

function gameMatchupLabel(game) {
  const away = game?.awayAbbr || game?.away || "Away";
  const home = game?.homeAbbr || game?.home || "Home";
  return `${away} @ ${home}`;
}

function BookSideCell({
  gameId,
  marketKey,
  which,
  bookKey,
  bookLabel,
  isBestCol,
  isBestCell,
  empty,
  off,
  last,
  hidden,
  onToggleHide,
  sideStyle,
  children,
}) {
  const side = boardHideSide(marketKey, which);
  const canHide = bookKey !== "best" && (!empty || hidden);
  return (
    <div
      className="obb-side"
      data-odds-side={side}
      data-hidden={hidden ? "1" : "0"}
      data-odds-off={off ? "1" : "0"}
      style={{
        ...sideStyle(isBestCol, isBestCell && !hidden && !off, empty && !off),
        ...(last ? { borderBottom: "none" } : {}),
        ...(off ? {
          color: "#a8a29e",
          background: "rgba(68, 45, 12, 0.38)",
          boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.28)",
        } : {}),
        ...(hidden ? {
          color: "#6b7280",
          background: "rgba(255,255,255,0.03)",
        } : {}),
        position: "relative",
      }}
    >
      {canHide && (
        <button
          type="button"
          className="obb-hide"
          data-hide-odds={hidden ? "show" : "hide"}
          data-hide-key={oddsBoardHideKey({ gameId, market: marketKey, side, bookKey })}
          aria-label={hidden
            ? `Unhide ${bookLabel || bookKey} ${side} in Best odds`
            : `Hide ${bookLabel || bookKey} ${side} from Best odds`}
          aria-pressed={hidden}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleHide?.(gameId, marketKey, side, bookKey);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {hidden ? "Show" : "×"}
        </button>
      )}
      <div
        data-odds-price={off ? "off" : empty ? "empty" : "set"}
        className="obb-clip"
        style={hidden ? { textDecoration: "line-through", opacity: 0.72, maxWidth: "100%" } : { maxWidth: "100%" }}
      >
        {children}
      </div>
      {hidden && (
        <div data-odds-hidden-label="true" style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", marginTop: 1, letterSpacing: 0.3, textTransform: "uppercase", lineHeight: 1.1 }}>
          hidden
        </div>
      )}
    </div>
  );
}

function parseBoardDrag(dt) {
  if (!dt) return null;
  const game = dt.getData("application/x-obb-game");
  if (game) return { kind: "game", key: game };
  const book = dt.getData("application/x-obb-book");
  if (book) return { kind: "book", key: book };
  const plain = dt.getData("text/plain") || "";
  const m = /^(game|book):(.+)$/.exec(plain);
  return m ? { kind: m[1], key: m[2] } : null;
}

function BoardGrip({ kind, itemKey, label, onMove, onDragBegin, onDragEnd }) {
  return (
    <button
      type="button"
      className="obb-grip"
      data-drag-game={kind === "game" ? itemKey : undefined}
      data-drag-book={kind === "book" ? itemKey : undefined}
      draggable
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", `${kind}:${itemKey}`);
        e.dataTransfer.setData(`application/x-obb-${kind}`, String(itemKey));
        e.dataTransfer.effectAllowed = "move";
        onDragBegin?.(kind, itemKey);
      }}
      onDragEnd={() => onDragEnd?.()}
      onKeyDown={(e) => {
        const delta = kind === "game"
          ? (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0)
          : (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0);
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation();
        onMove?.(itemKey, delta);
      }}
    >
      ⋮⋮
    </button>
  );
}

function fmtMs(v) {
  if (v == null || !isFinite(v)) return "—";
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function fmtClock(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtSignedLine(line) {
  if (line == null || !isFinite(Number(line))) return "";
  const n = Number(line);
  return n > 0 ? `+${n}` : `${n}`;
}

function ageTone(ms) {
  if (ms == null) return "#6b7280";
  if (ms <= 500) return "#10b981";
  if (ms <= 1200) return "#eab308";
  return "#f97316";
}

const BOARD_SIDE_STYLE = (isBestCol, isBestCell, empty) => ({
  padding: "3px 4px",
  lineHeight: 1.15,
  borderBottom: "1px solid rgba(255,255,255,0.03)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  fontWeight: 700,
  color: empty ? "#2d3748" : (isBestCol || isBestCell) ? "#10b981" : "#e8eaed",
  background: isBestCell ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent",
});

const LiveTickStrip = memo(function LiveTickStrip({
  liveOnly,
  books,
  games,
  snapshotAt,
  streamStatus,
  register,
  resetKey,
}) {
  const [tickStats, setTickStats] = useState(() => emptyTickStats());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof register !== "function") return undefined;
    register((applied, receivedAt) => {
      setTickStats((prev) => recordTicks(prev, applied, { receivedAt }));
    });
    return () => register(null);
  }, [register]);

  useEffect(() => {
    setTickStats(emptyTickStats());
  }, [resetKey, liveOnly]);

  const metrics = summarizeTickStats(tickStats, nowMs);
  const staleSoft = liveOnly ? staleLiveBookLabels(games, books, nowMs) : [];

  return (
    <div
      data-tick-metrics="true"
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(16,185,129,0.18)",
        background: "rgba(16,185,129,0.05)",
      }}
    >
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>Stream</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: streamStatus === "live" ? "#34d399" : "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>
            {liveOnly ? streamStatus : "snapshot"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {liveOnly ? "Reconciled" : "Refreshed"}
          </div>
          <div data-snapshot-age style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>
            {snapshotAt ? `${formatCompactAge(snapshotAt, nowMs) || "0ms"} ago` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>Last tick age</div>
          <div data-last-tick-age style={{ fontSize: 20, fontWeight: 800, color: ageTone(metrics.lastTickAgeMs), fontFamily: "'JetBrains Mono', monospace" }}>
            {liveOnly ? fmtMs(metrics.lastTickAgeMs) : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>p50 inter-arrival</div>
          <div data-p50 style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.p50InterArrivalMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>p95 inter-arrival</div>
          <div data-p95 style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.p95InterArrivalMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>Tick lag</div>
          <div data-tick-lag style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.lastLagMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.6 }}>Ticks</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed", fontFamily: "'JetBrains Mono', monospace" }}>{metrics.eventCount}</div>
        </div>
      </div>
      {staleSoft.length > 0 && (
        <div
          data-soft-book-stale={staleSoft.map((b) => b.key).join(",")}
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(120,53,15,0.35)",
            color: "#fbbf24",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {staleSoft.map((b) => `${b.label} ${b.age}`).join(" · ")}
          {" — last Betstamp print, not a frozen Refresh. Last-tick in the header is SSE (Pinnacle / PMs). Soft books often do not tick live."}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {books.map((b) => {
          const row = metrics.perBook[b.key];
          return (
            <span key={b.key} data-book-age={b.key} style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'JetBrains Mono', monospace" }}>
              {b.label} {row ? fmtMs(nowMs - row.lastAt) : "—"}
            </span>
          );
        })}
      </div>
      {!!metrics.ticks.length && (
        <div data-tick-log="true" style={{ marginTop: 10, maxHeight: 92, overflow: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9ca3af" }}>
          {metrics.ticks.slice(0, 12).map((t, i) => (
            <div key={`${t.t}-${i}`}>
              {fmtClock(t.t)}  {(bookByKey(t.bookKey)?.label || t.bookKey || "").padEnd(10)}  {t.label}  {formatAmericanOdds(t.price)}
              {t.lagMs != null ? `  lag ${fmtMs(t.lagMs)}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function isBestHighlight(rowGame, marketKey, b, cell, which, singleBest, stacks, stackedBest) {
  if (b.key === "best") return false;
  const price = which === "top" ? cell.top : cell.bot;
  if (price == null) return false;
  if (stackedBest && marketKey !== "ml") {
    return isStackedBestMatch(stacks, price, oddsBoardSidePoint(rowGame, b.key, marketKey, which));
  }
  return price === singleBest;
}

function renderStackedSide(rowGame, field, stack, books) {
  return (
    <OddsSide
      price={stack?.price ?? null}
      size={stack?.size ?? null}
      line={stack?.lineLabel ?? null}
      books={stack?.books ?? []}
      allBooks={books}
      showBestMark
      showWinProb={cellShowsWinProb("best", stack?.books)}
      updatedAt={bestLineUpdatedAt(rowGame, field, stack?.books)}
      ageTitle="Newest update among books offering this best price"
      flashKey={`${rowGame.id}:best:${field}:${stack?.line ?? stack?.point ?? "none"}`}
    />
  );
}

function renderPairedPointBlocks(rowGame, blocks, fields, books) {
  const padded = padBestPointStacks(blocks, STACKED_BEST_MAX_LINES);
  return (
    <div data-best-point-pairs={padded.length} data-best-stacks={padded.length} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, width: "100%", overflow: "hidden" }}>
      {padded.map((block, i) => (
        <div
          key={block.padded ? `pad-${i}` : block.point}
          data-best-point={block.padded ? undefined : block.point}
          data-best-point-count={block.count}
          data-best-stack-pad={block.padded ? "1" : "0"}
          style={i > 0 ? {
            borderTop: "1px solid rgba(16,185,129,0.28)",
            width: "100%",
          } : { width: "100%" }}
        >
          <div className="obb-side" data-best-stack={block.top?.line} data-best-stack-price={block.top?.price} data-best-stack-side="top" style={{ width: "100%" }}>
            {renderStackedSide(rowGame, fields.top, block.top, books)}
          </div>
          <div
            className="obb-side"
            data-best-stack={block.bot?.line}
            data-best-stack-price={block.bot?.price}
            data-best-stack-side="bot"
            style={{
              width: "100%",
              borderTop: "1px solid rgba(16,185,129,0.12)",
            }}
          >
            {renderStackedSide(rowGame, fields.bot, block.bot, books)}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderBookColumn({
  rowGame,
  marketKey,
  b,
  cell,
  bests,
  includeLine = true,
  hiddenKeys,
  books,
  stackedBest,
  onToggleHide,
}) {
  const fields = cellLineFields(marketKey);
  const isBestCol = b.key === "best";
  const topHidden = !isBestCol && isHiddenOddsCell(hiddenKeys, {
    gameId: rowGame.id, market: marketKey, side: boardHideSide(marketKey, "top"), bookKey: b.key,
  });
  const botHidden = !isBestCol && isHiddenOddsCell(hiddenKeys, {
    gameId: rowGame.id, market: marketKey, side: boardHideSide(marketKey, "bot"), bookKey: b.key,
  });
  const isBestAway = !topHidden && isBestHighlight(rowGame, marketKey, b, cell, "top", bests.bestAway, bests.awayStacks, stackedBest);
  const isBestHome = !botHidden && isBestHighlight(rowGame, marketKey, b, cell, "bot", bests.bestHome, bests.homeStacks, stackedBest);
  const pairBlocks = isBestCol && stackedBest && marketKey !== "ml" && cell.pointStacks;
  const topUpdatedAt = isBestCol
    ? bestLineUpdatedAt(rowGame, fields.top, cell.topBooks)
    : lineUpdatedAt(rowGame, b.key, fields.top);
  const botUpdatedAt = isBestCol
    ? bestLineUpdatedAt(rowGame, fields.bot, cell.botBooks)
    : lineUpdatedAt(rowGame, b.key, fields.bot);
  const sideProps = (which) => ({
    price: which === "top" ? cell.top : cell.bot,
    size: which === "top" ? cell.topSize : cell.botSize,
    line: includeLine ? (which === "top" ? cell.topLine : cell.botLine) : null,
    books: which === "top" ? cell.topBooks : cell.botBooks,
    allBooks: books,
    showBestMark: isBestCol,
    showWinProb: cellShowsWinProb(b.key, which === "top" ? cell.topBooks : cell.botBooks),
    updatedAt: which === "top" ? topUpdatedAt : botUpdatedAt,
    ageTitle: isBestCol ? "Newest update among books offering this best price" : undefined,
    suspended: !isBestCol && lineIsSuspended(rowGame, b.key, which === "top" ? fields.top : fields.bot),
    flashKey: `${rowGame.id}:${marketKey}:${b.key}:${which}`,
  });
  const topOff = sideProps("top").suspended;
  const botOff = sideProps("bot").suspended;
  const colW = obbColWidth(b.key);
  if (pairBlocks) {
    const emptyPairs = !cell.pointStacks.length || cell.pointStacks.every((block) => block.top?.price == null && block.bot?.price == null);
    return (
      <td key={b.key} data-obb-cell={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", width: colW, maxWidth: colW, overflow: "hidden", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
        <div
          className="obb-side obb-side-paired"
          data-odds-side="paired"
          style={{
            ...BOARD_SIDE_STYLE(true, false, emptyPairs),
            borderBottom: "none",
          }}
        >
          {renderPairedPointBlocks(rowGame, cell.pointStacks, fields, books)}
        </div>
      </td>
    );
  }

  return (
    <td key={b.key} data-obb-cell={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", width: colW, maxWidth: colW, overflow: "hidden", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", overflow: "hidden" }}>
        <BookSideCell
          gameId={rowGame.id}
          marketKey={marketKey}
          which="top"
          bookKey={b.key}
          bookLabel={b.label}
          isBestCol={isBestCol}
          isBestCell={isBestAway}
          empty={cell.top === null}
          off={topOff}
          hidden={topHidden}
          onToggleHide={onToggleHide}
          sideStyle={BOARD_SIDE_STYLE}
        >
          <OddsSide {...sideProps("top")} />
        </BookSideCell>
        <BookSideCell
          gameId={rowGame.id}
          marketKey={marketKey}
          which="bot"
          bookKey={b.key}
          bookLabel={b.label}
          isBestCol={isBestCol}
          isBestCell={isBestHome}
          empty={cell.bot === null}
          off={botOff}
          last
          hidden={botHidden}
          onToggleHide={onToggleHide}
          sideStyle={BOARD_SIDE_STYLE}
        >
          <OddsSide {...sideProps("bot")} />
        </BookSideCell>
      </div>
    </td>
  );
}

function renderOddsColumns({
  rowGame,
  marketKey,
  books,
  visibleBooks,
  selectedBooks,
  hiddenKeys,
  stackedBest,
  nowMs,
  onToggleHide,
  includeLine,
}) {
  const liveBestOpts = { nowMs, hiddenKeys, stackedBest };
  const bests = getBestForGame(rowGame, marketKey, selectedBooks, books, liveBestOpts);
  return visibleBooks.map((b) => {
    const cell = getOddsBoardCell({
      game: rowGame,
      bookKey: b.key,
      market: marketKey,
      selectedBookKeys: selectedBooks,
      allBooks: books,
      ...liveBestOpts,
    });
    return renderBookColumn({
      rowGame,
      marketKey,
      b,
      cell,
      bests,
      includeLine: includeLine ?? boardShowsPointLine(marketKey),
      hiddenKeys,
      books,
      stackedBest,
      onToggleHide,
    });
  });
}

// Book cells only. GAME is a sibling <td> so the 1s age clock / 5s Best
// clock cannot remount the sticky matchup column.
const OddsBoardBookCells = memo(function OddsBoardBookCells({
  game,
  market,
  books,
  visibleBooks,
  selectedBooks,
  hiddenKeys,
  stackedBest,
  onToggleHide,
}) {
  const bestNowMs = useContext(BestNowContext);
  return renderOddsColumns({
    rowGame: game,
    marketKey: market,
    books,
    visibleBooks,
    selectedBooks,
    hiddenKeys,
    stackedBest,
    nowMs: bestNowMs,
    onToggleHide,
    includeLine: boardShowsPointLine(market),
  });
});

const OddsBoardGameRow = memo(function OddsBoardGameRow({
  game,
  market,
  books,
  visibleBooks,
  selectedBooks,
  hiddenKeys,
  stackedBest,
  open,
  dragging,
  dragOver,
  onOpenAlts,
  onToggleHideCell,
  onToggleHideGame,
  onNudgeGame,
  onDragBegin,
  onDragEnd,
  onBoardDragOver,
  onBoardDrop,
  onBoardDragLeave,
}) {
  return (
    <tr
      data-fixture={game.id}
      data-game-paint={liveGamePaintKey(game)}
      data-drop-game={game.id}
      data-open-alts={open ? "1" : "0"}
      data-drag-over={dragOver ? "1" : "0"}
      data-dragging={dragging ? "1" : "0"}
      onClick={() => onOpenAlts(game)}
      onDragOver={onBoardDragOver("game", game.id)}
      onDrop={onBoardDrop("game", game.id)}
      onDragLeave={() => onBoardDragLeave("game", game.id)}
      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" }}
    >
      <td
        className="obb-game"
        data-hide-game-cell="true"
        style={{ padding: 0, width: OBB_TEAM_COL_WIDTH, maxWidth: OBB_TEAM_COL_WIDTH, overflow: "hidden", position: "sticky", left: 0, background: "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        <button
          type="button"
          className="obb-hide"
          data-hide-game="hide"
          data-hide-game-key={oddsBoardHideGameKey(game.id)}
          aria-label={`Hide ${game.away} @ ${game.home}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleHideGame(game.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          ×
        </button>
        <div style={{ padding: "4px 10px 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#4b5563", marginBottom: 1, lineHeight: 1.15 }}>
            <BoardGrip
              kind="game"
              itemKey={String(game.id)}
              label={`Reorder ${game.away} @ ${game.home}`}
              onMove={onNudgeGame}
              onDragBegin={onDragBegin}
              onDragEnd={onDragEnd}
            />
            {game.is_live ? (
              <span style={{ color: "#34d399", fontWeight: 700 }}>LIVE</span>
            ) : (
              new Date(game.commence_time || Date.now()).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }) + " ET"
            )}
          </div>
          <div className="obb-game-name" title={game.away} style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", marginBottom: 2, lineHeight: 1.15 }}>
            {game.away}{game.away_score != null ? ` ${game.away_score}` : ""}
          </div>
          <div className="obb-game-name" title={game.home} style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", lineHeight: 1.15 }}>
            {game.home}{game.home_score != null ? ` ${game.home_score}` : ""}
          </div>
          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, margin: "2px 0 0", lineHeight: 1.15 }}>Alts →</div>
        </div>
      </td>
      <OddsBoardBookCells
        game={game}
        market={market}
        books={books}
        visibleBooks={visibleBooks}
        selectedBooks={selectedBooks}
        hiddenKeys={hiddenKeys}
        stackedBest={stackedBest}
        onToggleHide={onToggleHideCell}
      />
    </tr>
  );
}, (prev, next) => (
  liveGamePaintKey(prev.game) === liveGamePaintKey(next.game)
  && prev.market === next.market
  && prev.stackedBest === next.stackedBest
  && prev.open === next.open
  && prev.dragging === next.dragging
  && prev.dragOver === next.dragOver
  && prev.books === next.books
  && prev.visibleBooks === next.visibleBooks
  && prev.selectedBooks === next.selectedBooks
  && prev.hiddenKeys === next.hiddenKeys
  && prev.onOpenAlts === next.onOpenAlts
  && prev.onToggleHideCell === next.onToggleHideCell
  && prev.onToggleHideGame === next.onToggleHideGame
  && prev.onNudgeGame === next.onNudgeGame
  && prev.onDragBegin === next.onDragBegin
  && prev.onDragEnd === next.onDragEnd
  && prev.onBoardDragOver === next.onBoardDragOver
  && prev.onBoardDrop === next.onBoardDrop
  && prev.onBoardDragLeave === next.onBoardDragLeave
));

export default function BetstampOddsBoard({ user = null, refreshKey = 0 } = {}) {
  const venuesOn = firstPartyPmLiveEnabled();
  // Novig and 4Casters stay off until their streams say the server has
  // credentials. needs-credentials omits the column. A blank column means
  // the credential is set and this slate has no price.
  const [novigOn, setNovigOn] = useState(false);
  const [fourcastersOn, setFourcastersOn] = useState(false);
  const books = useMemo(() => {
    let catalog = freeFeedBooks(user);
    if (!venuesOn) catalog = catalog.filter((b) => b.key === "underdog_predict");
    if (!novigOn) catalog = catalog.filter((b) => b.key !== "novig");
    if (!fourcastersOn) catalog = catalog.filter((b) => b.key !== "fourcasters");
    return catalog;
  }, [user?.id, user?.email, venuesOn, novigOn, fourcastersOn]);
  const seeUnderdog = books.some((b) => b.key === "underdog_predict");
  const bookKeysKey = books.map((b) => b.key).join(",");
  const knownBookKeysRef = useRef(bookKeysKey);
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(() => new Set(books.map((b) => b.key)));
  const [boardSport, setBoardSport] = useState(BETSTAMP_DEFAULT_SPORT);
  const [liveOnly, setLiveOnly] = useState(false); // Pregame default. Never auto-enable LIVE.
  const [games, setGames] = useState([]);
  const [feedNote, setFeedNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [snapshotAt, setSnapshotAt] = useState(null);
  const gamesRef = useRef([]);
  const tickSinkRef = useRef(null);
  const moveGameRef = useRef(null);
  const moveBookRef = useRef(null);
  const openAltsRef = useRef(null);
  const nudgeGameRef = useRef(null);
  const registerTickSink = useCallback((fn) => { tickSinkRef.current = fn; }, []);
  const fetchGen = useRef(0);
  const altFetchGen = useRef(0);
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const [boardOrder, setBoardOrder] = useState(() => loadOddsBoardOrder(user));
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const draggingRef = useRef(null);
  const [bestView, setBestView] = useState("single"); // default = today's single Best
  const [openGame, setOpenGame] = useState(null);
  const [altLadders, setAltLadders] = useState(null);
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const boardRefreshKey = Number(refreshKey) + localRefresh;

  const commitGames = (next, { force = false } = {}) => {
    const prev = gamesRef.current;
    gamesRef.current = next;
    if (!force && liveBoardPaintKey(prev) === liveBoardPaintKey(next)) return false;
    setGames(next);
    return true;
  };

  useEffect(() => {
    setSelectedBooks(new Set(bookKeysKey ? bookKeysKey.split(",") : []));
  }, [user?.id, user?.email]);

  // Novig and 4Casters join after the stream reports credentials. Select the
  // new column without turning back on a book the user already unchecked.
  useEffect(() => {
    const nextKeys = bookKeysKey ? bookKeysKey.split(",") : [];
    const known = new Set((knownBookKeysRef.current || "").split(",").filter(Boolean));
    setSelectedBooks((selected) => {
      const next = new Set();
      for (const key of nextKeys) {
        if (!known.has(key) || selected.has(key)) next.add(key);
      }
      return next;
    });
    knownBookKeysRef.current = bookKeysKey;
  }, [bookKeysKey]);

  useEffect(() => {
    setBoardOrder(loadOddsBoardOrder(user));
  }, [user?.id, user?.email]);

  useEffect(() => {
    // LIVE ages/Best clocks are isolated (AgeNowProvider / BestNowProvider).
    // A 1s setState here remounted every odds cell — GAME survived because
    // it is sticky with an opaque background (Kevin's ~1s blank heartbeat).
    if (liveOnly) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [liveOnly]);

  useEffect(() => {
    const gen = ++fetchGen.current;
    const league = leagueForSport(boardSport);
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setFeedNote(null);
    setSnapshotAt(null);
    setStreamStatus(liveOnly && venuesOn ? "connecting" : "idle");

    const quoteRef = { polymarket: [], kalshi: [], novig: [], fourcasters: [] };
    let phone = null;
    let sawPhone = !seeUnderdog;
    let phoneFailed = false;
    let firstPaint = true;

    const publish = () => {
      if (cancelled || gen !== fetchGen.current) return;
      const next = gamesFromFreeFeeds({
        league,
        polymarket: venuesOn ? quoteRef.polymarket : [],
        kalshi: venuesOn ? quoteRef.kalshi : [],
        novig: venuesOn ? quoteRef.novig : [],
        fourcasters: venuesOn ? quoteRef.fourcasters : [],
        underdog: seeUnderdog && sawPhone ? phone : null,
        nowMs: Date.now(),
      });
      commitGames(next, { force: firstPaint });
      firstPaint = false;
      setSnapshotAt(Date.now());
      setLoading(false);
      setFeedNote(phoneFailed
        ? "Underdog phone didn't respond. Polymarket and Kalshi still show when they have a game. Novig and 4Casters show when the server has credentials."
        : null);
    };

    const loadPhone = async () => {
      if (!seeUnderdog) {
        sawPhone = true;
        phone = null;
        return;
      }
      try {
        const body = await fetchUnderdogPhone((url, init) => fetch(url, {
          ...(init || {}),
          signal: ctrl.signal,
          cache: "no-store",
        }), { live: liveOnly });
        if (cancelled || ctrl.signal.aborted) return;
        phone = body && Array.isArray(body.games) ? body : { ok: false, games: [] };
        sawPhone = true;
        phoneFailed = body && body.ok === false && !(body.games && body.games.length);
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return;
        phone = { ok: false, games: [] };
        sawPhone = true;
        phoneFailed = true;
      }
    };

    let pollTimer;
    let phoneInFlight = false;
    let kalshiInFlight = false;
    const venueTimers = [];

    // Full Kalshi book. SSE can replay only the last ticker that moved, and
    // snapshot mode does not wait on that socket — a one-contract tick left
    // every other Kalshi moneyline as "—".
    const loadKalshiBoard = async () => {
      if (!venuesOn) return;
      try {
        const res = await fetch(kalshiBoardUrl({ league }), {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (cancelled || ctrl.signal.aborted || !res.ok) return;
        const quotes = kalshiQuotesFromBoardBody(await res.json());
        if (!quotes) return;
        quoteRef.kalshi = quotes;
      } catch {
        if (cancelled || ctrl.signal.aborted) return;
      }
    };

    // Pregame and LIVE both poll the phone and the Kalshi book. Do not wait
    // on either GET — a hung request must not freeze the other feed.
    const kickPhone = () => {
      if (phoneInFlight || cancelled) return;
      phoneInFlight = true;
      loadPhone().then(() => { if (!cancelled) publish(); }).finally(() => { phoneInFlight = false; });
    };
    const kickKalshi = () => {
      if (!venuesOn || kalshiInFlight || cancelled) return;
      kalshiInFlight = true;
      loadKalshiBoard().then(() => { if (!cancelled) publish(); }).finally(() => { kalshiInFlight = false; });
    };
    kickPhone();
    kickKalshi();
    pollTimer = setInterval(() => {
      kickPhone();
      kickKalshi();
    }, liveOnly ? FREE_FEED_LIVE_POLL_MS : FREE_FEED_POLL_MS);

    const runVenue = async (book, url) => {
      // VITE_FIRST_PARTY_PM_LIVE=0 turns this venue off. Unset stays on.
      if (!venuesOn || cancelled) return;
      let venueAttempt = 0;
      while (!cancelled && !ctrl.signal.aborted) {
        try {
          await consumeBetstampStream({
            url,
            signal: ctrl.signal,
            onStatus: (s) => {
              if (cancelled || gen !== fetchGen.current || !liveOnly) return;
              if (s === "live" || s === "connecting" || s === "reconnect") setStreamStatus(s);
            },
            onEvent: (ev) => {
              if (cancelled || gen !== fetchGen.current) return;
              const payload = ev && ev.data && ev.data.payload;
              if (book === "novig") {
                const missing = payload && (
                  payload.mode === "needs-credentials"
                  || payload.note === "novig_needs_credentials"
                );
                setNovigOn(!missing);
                if (missing) return;
              }
              if (book === "fourcasters") {
                const missing = payload && (
                  payload.mode === "needs-credentials"
                  || payload.note === "fourcasters_needs_credentials"
                );
                setFourcastersOn(!missing);
                if (missing) return;
              }
              const quotes = payload && payload.quotes;
              if (!quotes || !quotes.length) return;
              quoteRef[book] = mergeVenueQuotes(quoteRef[book], quotes);
              publish();
            },
          });
        } catch {
          if (cancelled || ctrl.signal.aborted) return;
          if (liveOnly) setStreamStatus("reconnect");
        }
        if (cancelled || ctrl.signal.aborted) return;
        const wait = nextBackoffMs(venueAttempt);
        venueAttempt += 1;
        await new Promise((resolve) => {
          const t = setTimeout(resolve, wait);
          venueTimers.push(t);
        });
      }
    };

    if (venuesOn) {
      runVenue("polymarket", polymarketStreamUrl({ league }));
      runVenue("kalshi", kalshiStreamUrl({ league }));
      runVenue("novig", novigStreamUrl({ league }));
      runVenue("fourcasters", fourcastersStreamUrl({ league }));
    } else if (!seeUnderdog) {
      publish();
    }

    const loadGuard = setTimeout(() => {
      if (!cancelled && gen === fetchGen.current) setLoading(false);
    }, 12000);

    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(loadGuard);
      clearInterval(pollTimer);
      venueTimers.forEach((t) => clearTimeout(t));
    };
  }, [boardSport, liveOnly, boardRefreshKey, seeUnderdog, venuesOn]);

  useEffect(() => {
    altFetchGen.current += 1;
    setOpenGame(null);
    setAltLadders(null);
    setAltError(null);
    setAltLoading(false);
  }, [boardSport, liveOnly]);

  useEffect(() => {
    if (!openGame) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeAlts();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGame]);

  const closeAlts = () => {
    altFetchGen.current += 1;
    setOpenGame(null);
    setAltError(null);
  };

  const openAlts = (game) => {
    if (!game?.id) return;
    altFetchGen.current += 1;
    setOpenGame(game);
    setAltLadders(mainLaddersFromGame(game));
    setAltError(null);
    setAltLoading(false);
  };
  openAltsRef.current = openAlts;

  useEffect(() => {
    if (!openGame) return;
    const fresh = games.find((g) => String(g.id) === String(openGame.id));
    if (!fresh) return;
    setAltLadders(mainLaddersFromGame(fresh));
  }, [games, openGame]);

  const toggleHiddenCell = useCallback((gameId, marketKey, side, bookKey) => {
    const key = oddsBoardHideKey({ gameId, market: marketKey, side, bookKey });
    if (!key) return;
    setHiddenKeys((prev) => toggleOddsBoardHideKey(prev, key));
  }, []);

  const toggleHiddenGame = useCallback((gameId) => {
    const key = oddsBoardHideGameKey(gameId);
    if (!key) return;
    setHiddenKeys((prev) => toggleOddsBoardHideKey(prev, key));
    setOpenGame((cur) => {
      if (cur && String(cur.id) === String(gameId)) {
        altFetchGen.current += 1;
        setAltError(null);
        return null;
      }
      return cur;
    });
  }, []);

  const showAllHiddenGames = () => {
    setHiddenKeys((prev) => clearHiddenOddsGames(prev));
  };

  const persistBoardOrder = (next) => {
    setBoardOrder(saveOddsBoardOrder(user, next));
  };

  const focusGrip = (kind, key) => {
    const token = String(key ?? "");
    if (!token) return;
    requestAnimationFrame(() => {
      const sel = kind === "game"
        ? `[data-drag-game="${CSS.escape(token)}"]`
        : `[data-drag-book="${CSS.escape(token)}"]`;
      document.querySelector(sel)?.focus();
    });
  };

  const slateKey = oddsBoardSlateKey(boardSport, liveOnly);
  const catalogBooks = useMemo(
    () => applyBookColumnOrder(books, boardOrder.bookKeys),
    [books, boardOrder.bookKeys],
  );
  const visibleBookKeys = useMemo(
    () => catalogBooks.filter((b) => selectedBooks.has(b.key)).map((b) => b.key),
    [catalogBooks, selectedBooks],
  );

  const toggleBook = (bookKey) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookKey)) {
        if (next.size === 1) return prev;
        next.delete(bookKey);
      } else next.add(bookKey);
      return next;
    });
  };

  const filteredGames = useMemo(() => {
    const q = search.toLowerCase();
    const onBoard = games.filter((g) => {
      if (g.sport !== boardSport) return false;
      if (!gameVisibleOnBoard(g, { liveOnly, now: nowMs })) return false;
      return matchesBoardSearch(g, q);
    });
    return filterHiddenOddsGames(onBoard, hiddenKeys);
    // LIVE rows ignore `now` (is_live short-circuit). Do not rebuild the
    // slate on the age clock — that remounted every odds cell ~1s.
  }, [games, boardSport, liveOnly, search, hiddenKeys, liveOnly ? 0 : nowMs]);

  const orderedGames = useMemo(
    () => applyGameRowOrder(filteredGames, boardOrder.gamesBySlate[slateKey] || []),
    [filteredGames, boardOrder, slateKey],
  );
  const visibleGameIds = useMemo(() => orderedGames.map((g) => String(g.id)), [orderedGames]);

  const moveGame = (fromId, toId) => {
    const nextIds = moveKeyAmongVisible(visibleGameIds, fromId, toId, boardOrder.gamesBySlate[slateKey] || []);
    persistBoardOrder({
      ...boardOrder,
      gamesBySlate: { ...boardOrder.gamesBySlate, [slateKey]: nextIds },
    });
  };

  const nudgeGame = (gameId, delta) => {
    const nextIds = moveKeyByOffset(visibleGameIds, gameId, delta, boardOrder.gamesBySlate[slateKey] || []);
    persistBoardOrder({
      ...boardOrder,
      gamesBySlate: { ...boardOrder.gamesBySlate, [slateKey]: nextIds },
    });
    focusGrip("game", gameId);
  };

  const moveBook = (fromKey, toKey) => {
    if (fromKey === "best" || toKey === "best") return;
    const nextKeys = moveKeyAmongVisible(visibleBookKeys, fromKey, toKey, boardOrder.bookKeys);
    persistBoardOrder({ ...boardOrder, bookKeys: nextKeys });
  };

  const nudgeBook = (bookKey, delta) => {
    if (bookKey === "best") return;
    const nextKeys = moveKeyByOffset(visibleBookKeys, bookKey, delta, boardOrder.bookKeys);
    persistBoardOrder({ ...boardOrder, bookKeys: nextKeys });
    focusGrip("book", bookKey);
  };
  moveGameRef.current = moveGame;
  moveBookRef.current = moveBook;
  nudgeGameRef.current = nudgeGame;

  const resetGameOrder = () => {
    const gamesBySlate = { ...boardOrder.gamesBySlate };
    delete gamesBySlate[slateKey];
    persistBoardOrder({ ...boardOrder, gamesBySlate });
  };

  const resetBookOrder = () => {
    persistBoardOrder({ ...boardOrder, bookKeys: [] });
  };

  const beginDrag = useCallback((kind, key) => {
    const next = { kind, key };
    draggingRef.current = next;
    setDragging(next);
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
  }, []);

  const onBoardDragOver = useCallback((kind, key) => (e) => {
    const active = draggingRef.current;
    if (!active || active.kind !== kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver((cur) => (cur?.kind === kind && cur?.key === key ? cur : { kind, key }));
  }, []);

  const onBoardDrop = useCallback((kind, key) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const payload = parseBoardDrag(e.dataTransfer) || draggingRef.current;
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
    if (!payload || payload.kind !== kind) return;
    if (kind === "game") moveGameRef.current?.(payload.key, key);
    else moveBookRef.current?.(payload.key, key);
  }, []);

  const openAltsStable = useCallback((game) => openAltsRef.current?.(game), []);
  const nudgeGameStable = useCallback((id, delta) => nudgeGameRef.current?.(id, delta), []);

  const onBoardDragLeave = useCallback((kind, key) => {
    setDragOver((cur) => (cur?.kind === kind && String(cur.key) === String(key) ? null : cur));
  }, []);

  const hiddenBoardGames = useMemo(() => {
    return games.filter((g) => {
      if (g.sport !== boardSport) return false;
      if (!gameVisibleOnBoard(g, { liveOnly, now: nowMs })) return false;
      return isHiddenOddsGame(hiddenKeys, g.id);
    });
  }, [games, boardSport, liveOnly, hiddenKeys, liveOnly ? 0 : nowMs]);

  const grouped = useMemo(() => groupGamesPreservingOrder(orderedGames, (g) => (
    g.is_live ? "Live now" : formatDateGroup(g.commence_time || Date.now())
  )), [orderedGames]);

  const visibleBooks = useMemo(
    () => [{ key: "best", label: "Best Odds" }, ...catalogBooks.filter((b) => selectedBooks.has(b.key))],
    [catalogBooks, selectedBooks],
  );
  const teamColWidth = OBB_TEAM_COL_WIDTH;
  const oddsColWidth = OBB_ODDS_COL_WIDTH;
  const bestColWidth = OBB_BEST_COL_WIDTH;
  const tableWidth = obbTableWidth(visibleBooks);
  const colWidthFor = (bookKey) => obbColWidth(bookKey);

  const stackedBest = bestView === "stacked";

  const renderOddsPair = (rowGame, marketKey) => renderOddsColumns({
    rowGame,
    marketKey,
    books,
    visibleBooks,
    selectedBooks,
    hiddenKeys,
    stackedBest,
    nowMs: Date.now(),
    onToggleHide: toggleHiddenCell,
    // Alt rows already show the point in the first column.
    includeLine: false,
  });

  const renderAltSection = (title, section, rows, marketKey, labelFor) => {
    if (!rows.length) return null;
    return (
      <div data-alt-section={section} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
        <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
          <table className="obb-grid" data-col-layout="fixed" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: tableWidth, minWidth: tableWidth, maxWidth: tableWidth }}>
            <colgroup>
              <col data-obb-col="game" style={{ width: teamColWidth }} />
              {visibleBooks.map((b) => (
                <col key={b.key} data-obb-col={b.key} style={{ width: colWidthFor(b.key) }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#12131a", zIndex: 2 }}>Line</th>
                {visibleBooks.map((b) => (
                  <th key={b.key} data-book-header={b.key} style={{ padding: "10px 6px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: colWidthFor(b.key), maxWidth: colWidthFor(b.key), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                    {b.key === "best" ? b.label : <BookLabel book={b} size={16} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${section}-${row.line ?? "ml"}`} data-alt-line={row.line ?? "ml"} data-alt-main={row.isMain ? "1" : "0"} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: row.isMain ? "rgba(59,130,246,0.04)" : "transparent" }}>
                  <td style={{ padding: "6px 12px", width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", position: "sticky", left: 0, background: row.isMain ? "#101624" : "#0f1016", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "#e8eaed", lineHeight: 1.2 }}>
                    <div>{labelFor(row)}</div>
                    {row.isMain && <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginTop: 2 }}>MAIN</div>}
                    {marketKey === "ml" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontWeight: 500 }}>
                        <div>{openGame?.away}</div>
                        <div style={{ marginTop: 3 }}>{openGame?.home}</div>
                      </div>
                    )}
                    {marketKey === "spr" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontWeight: 500 }}>
                        <div>{openGame?.awayAbbr || openGame?.away} {fmtSignedLine(row.line)}</div>
                        <div style={{ marginTop: 3 }}>{openGame?.homeAbbr || openGame?.home} {fmtSignedLine(row.line == null ? null : -row.line)}</div>
                      </div>
                    )}
                    {marketKey === "tot" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontWeight: 500 }}>
                        <div>Over {row.line}</div>
                        <div style={{ marginTop: 3 }}>Under {row.line}</div>
                      </div>
                    )}
                  </td>
                  {renderOddsPair(row.game, marketKey)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <AgeNowProvider>
    <BestNowProvider>
    <div
      data-betstamp-board="true"
      data-free-feeds="polymarket,kalshi,novig,fourcasters,underdog"
      data-row-density="compact"
      data-col-layout="fixed"
      data-team-col-w={teamColWidth}
      data-odds-col-w={oddsColWidth}
      data-best-col-w={bestColWidth}
      data-side-h={OBB_SIDE_CELL_HEIGHT}
      data-book-order={visibleBookKeys.join(",")}
      data-game-order={visibleGameIds.join(",")}
      data-guard-allow="true"
      data-best-view={bestView}
      data-live-best-age-ms={LIVE_BEST_ODDS_MAX_AGE_MS}
      data-live-best-break-age-ms={LIVE_BEST_ODDS_BREAK_MAX_AGE_MS}
      data-live-reconcile-ms={liveOnly ? FREE_FEED_LIVE_POLL_MS : FREE_FEED_POLL_MS}
      data-live-paint-key={liveBoardPaintKey(games) ? "1" : "0"}
      data-live-clock="isolated"
    >
      <style>{`
        .obb-side, .obb-game { position: relative; }
        .obb-grid {
          table-layout: fixed;
          border-collapse: collapse;
        }
        .obb-grid th, .obb-grid td {
          box-sizing: border-box;
          overflow: hidden;
        }
        .obb-grid thead th {
          height: 44px;
          max-height: 44px;
        }
        .obb-side {
          box-sizing: border-box;
          width: 100%;
          height: ${OBB_SIDE_CELL_HEIGHT}px;
          max-height: ${OBB_SIDE_CELL_HEIGHT}px;
          overflow: hidden;
        }
        .obb-side-paired {
          height: auto;
          max-height: none;
          overflow: hidden;
        }
        .obb-clip {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .obb-game-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .obb-hide {
          position: absolute;
          top: 2px;
          right: 2px;
          z-index: 2;
          min-width: 16px;
          min-height: 16px;
          padding: 0 3px;
          border-radius: 3px;
          border: 1px solid transparent;
          background: transparent;
          color: #4b5563;
          font-size: 10px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          font-family: 'DM Sans', sans-serif;
        }
        .obb-side:hover .obb-hide,
        .obb-side:focus-within .obb-hide,
        .obb-game:hover .obb-hide,
        .obb-game:focus-within .obb-hide {
          opacity: 0.4;
          pointer-events: auto;
        }
        .obb-side:hover .obb-hide:hover,
        .obb-side:focus-within .obb-hide:focus,
        .obb-game:hover .obb-hide:hover,
        .obb-game:focus-within .obb-hide:focus {
          opacity: 0.85;
          color: #9ca3af;
          background: rgba(10,11,15,0.7);
        }
        .obb-side[data-hidden="1"] .obb-hide {
          opacity: 1;
          pointer-events: auto;
          color: #d1d5db;
          background: rgba(10,11,15,0.92);
          border-color: rgba(255,255,255,0.14);
          font-size: 11px;
          font-weight: 700;
          min-width: 24px;
          min-height: 20px;
          padding: 0 6px;
        }
        @media (hover: none) {
          .obb-hide { opacity: 0.2; pointer-events: auto; }
          .obb-side[data-hidden="1"] .obb-hide { opacity: 1; }
        }
        .obb-grip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          padding: 0;
          border: none;
          border-radius: 3px;
          background: transparent;
          color: #6b7280;
          font-size: 11px;
          line-height: 1;
          letter-spacing: -1px;
          cursor: grab;
          flex-shrink: 0;
          font-family: 'DM Sans', sans-serif;
        }
        .obb-grip:hover, .obb-grip:focus {
          color: #e8eaed;
          background: rgba(255,255,255,0.08);
          outline: none;
        }
        .obb-grip:active { cursor: grabbing; }
        tr[data-drag-over="1"], th[data-drag-over="1"] {
          box-shadow: inset 0 2px 0 #3b82f6;
        }
        tr[data-dragging="1"], th[data-dragging="1"] { opacity: 0.45; }
        .obb-flash {
          display: inline-block;
          padding: 0 3px;
          border-radius: 3px;
          font-variant-numeric: tabular-nums;
        }
        @keyframes obb-flash-up {
          0%, 20% { color: #86efac; background: rgba(16,185,129,0.38); text-shadow: 0 0 10px rgba(52,211,153,0.55); }
          100% { color: inherit; background: transparent; text-shadow: none; }
        }
        @keyframes obb-flash-down {
          0%, 20% { color: #fca5a5; background: rgba(239,68,68,0.38); text-shadow: 0 0 10px rgba(248,113,113,0.5); }
          100% { color: inherit; background: transparent; text-shadow: none; }
        }
        .obb-flash-up { animation: obb-flash-up 0.9s ease-out; }
        .obb-flash-down { animation: obb-flash-down 0.9s ease-out; }
        .obb-off {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          min-width: 0;
          max-width: 100%;
          width: 100%;
          padding: 2px 4px;
          border-radius: 5px;
          border: 1px dashed rgba(251,191,36,0.55);
          background: rgba(120,53,15,0.55);
          color: #fbbf24;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.7px;
          line-height: 1.1;
          text-transform: uppercase;
          font-family: 'DM Sans', sans-serif;
          overflow: hidden;
        }
        .obb-off-sub {
          display: block;
          margin-top: 1px;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.4px;
          color: #fcd34d;
          opacity: 0.9;
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed" }}>New Odds Board</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Polymarket, Kalshi, and Underdog Predict. Novig and 4Casters appear when the server has credentials. No sportsbook columns.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-board-refresh="1"
            onClick={() => setLocalRefresh((n) => n + 1)}
            title="Re-pull Polymarket, Kalshi, and Underdog"
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid rgba(59,130,246,0.35)",
              background: "rgba(59,130,246,0.12)",
              color: "#93c5fd",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setLiveOnly((v) => !v)}
            data-live-toggle={liveOnly ? "on" : "off"}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: liveOnly ? "1px solid rgba(16,185,129,0.45)" : "1px solid rgba(255,255,255,0.1)",
              background: liveOnly ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
              color: liveOnly ? "#34d399" : "#9ca3af",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {liveOnly ? "● LIVE" : "Pregame"}
          </button>
        </div>
      </div>

      <LiveTickStrip
        liveOnly={liveOnly}
        books={books}
        games={games}
        snapshotAt={snapshotAt}
        streamStatus={streamStatus}
        register={registerTickSink}
        resetKey={`${boardSport}:${liveOnly}:${boardRefreshKey}`}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {BETSTAMP_SPORTS.map((s) => (
          <button key={s.id} onClick={() => setBoardSport(s.id)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: boardSport === s.id ? "#3b82f6" : "rgba(255,255,255,0.05)", color: boardSport === s.id ? "#fff" : "#6b7280" }}>
            {s.label}
          </button>
        ))}
      </div>
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search team or matchup..." style={{ width: "100%", maxWidth: 400, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8eaed", padding: "10px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["ml", "spr", "tot"].map((m) => (
          <button key={m} onClick={() => setMarket(m)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: market === m ? "#3b82f6" : "rgba(255,255,255,0.05)", color: market === m ? "#fff" : "#6b7280" }}>
            {m === "ml" ? "Moneyline" : m === "spr" ? "Spread" : "Totals"}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Best</span>
        <div
          data-best-view-toggle="true"
          role="group"
          aria-label="Best odds view"
          style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {[
            { id: "single", label: "Single" },
            { id: "stacked", label: "Top 2 lines" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              data-best-view={opt.id}
              aria-pressed={bestView === opt.id}
              onClick={() => setBestView(opt.id)}
              style={{
                padding: "6px 12px",
                border: "none",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: bestView === opt.id ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.03)",
                color: bestView === opt.id ? "#34d399" : "#6b7280",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        {catalogBooks.map((b) => (
          <button
            key={b.key}
            type="button"
            data-book-chip={b.key}
            onClick={() => toggleBook(b.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: selectedBooks.has(b.key) ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)",
              color: selectedBooks.has(b.key) ? "#3b82f6" : "#4b5563",
              border: selectedBooks.has(b.key) ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <BookLabel book={b} size={14} />
          </button>
        ))}
        {boardOrder.bookKeys.length > 0 && (
          <button
            type="button"
            data-reset-book-order="true"
            onClick={resetBookOrder}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#9ca3af", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Reset books
          </button>
        )}
        {(boardOrder.gamesBySlate[slateKey] || []).length > 0 && (
          <button
            type="button"
            data-reset-game-order="true"
            onClick={resetGameOrder}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#9ca3af", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Reset games
          </button>
        )}
      </div>

      {hiddenBoardGames.length > 0 && (
        <div
          data-hidden-games="true"
          data-hidden-game-count={hiddenBoardGames.length}
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af" }}>
            {hiddenBoardGames.length} hidden
          </span>
          <span style={{ color: "#4b5563" }}>·</span>
          <button
            type="button"
            data-show-all-games="true"
            onClick={showAllHiddenGames}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#d1d5db",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Show all
          </button>
          {hiddenBoardGames.map((g) => (
            <button
              key={g.id}
              type="button"
              data-unhide-game={g.id}
              title={`Show ${g.away} @ ${g.home}`}
              onClick={() => toggleHiddenGame(g.id)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "#9ca3af",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {gameMatchupLabel(g)}
            </button>
          ))}
        </div>
      )}

      {feedNote && (
        <div data-feed-note="true" style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", marginBottom: 16, fontSize: 13 }}>
          {feedNote}
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>Loading Polymarket, Kalshi, and Underdog…</div>
      )}

      {!loading && (
      <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table className="obb-grid" data-col-layout="fixed" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: tableWidth, minWidth: tableWidth, maxWidth: tableWidth }}>
          <colgroup>
            <col data-obb-col="game" style={{ width: teamColWidth }} />
            {visibleBooks.map((b) => (
              <col key={b.key} data-obb-col={b.key} style={{ width: colWidthFor(b.key) }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>Game</th>
              {visibleBooks.map((b) => (
                <th
                  key={b.key}
                  data-book-header={b.key}
                  data-drop-book={b.key !== "best" ? b.key : undefined}
                  data-drag-over={dragOver?.kind === "book" && dragOver.key === b.key ? "1" : "0"}
                  data-dragging={dragging?.kind === "book" && dragging.key === b.key ? "1" : "0"}
                  onDragOver={b.key === "best" ? undefined : onBoardDragOver("book", b.key)}
                  onDrop={b.key === "best" ? undefined : onBoardDrop("book", b.key)}
                  onDragLeave={() => {
                    if (dragOver?.kind === "book" && dragOver.key === b.key) setDragOver(null);
                  }}
                  style={{ padding: "12px 6px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: colWidthFor(b.key), maxWidth: colWidthFor(b.key), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}
                >
                  <span className="obb-clip" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, maxWidth: "100%" }}>
                    {b.key !== "best" && (
                      <BoardGrip
                        kind="book"
                        itemKey={b.key}
                        label={`Reorder ${b.label} column`}
                        onMove={nudgeBook}
                        onDragBegin={beginDrag}
                        onDragEnd={endDrag}
                      />
                    )}
                    {b.key === "best" ? b.label : <BookLabel book={b} size={16} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && (
              <tr>
                <td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>
                  {hiddenBoardGames.length
                    ? "Hidden matchups are listed above — Show all to restore"
                    : `No ${liveOnly ? "live" : "pregame"} games on Polymarket, Kalshi, or Underdog${search ? ` for "${search}"` : ""}`}
                </td>
              </tr>
            )}
            {grouped.map((block) => (
              <Fragment key={block.dateKey}>
                <tr style={{ background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>{block.dateKey}</td>
                </tr>
                {block.games.map((game) => (
                  <OddsBoardGameRow
                    key={game.id}
                    game={game}
                    market={market}
                    books={books}
                    visibleBooks={visibleBooks}
                    selectedBooks={selectedBooks}
                    hiddenKeys={hiddenKeys}
                    stackedBest={stackedBest}
                    open={openGame?.id === game.id}
                    dragging={dragging?.kind === "game" && String(dragging.key) === String(game.id)}
                    dragOver={dragOver?.kind === "game" && String(dragOver.key) === String(game.id)}
                    onOpenAlts={openAltsStable}
                    onToggleHideCell={toggleHiddenCell}
                    onToggleHideGame={toggleHiddenGame}
                    onNudgeGame={nudgeGameStable}
                    onDragBegin={beginDrag}
                    onDragEnd={endDrag}
                    onBoardDragOver={onBoardDragOver}
                    onBoardDrop={onBoardDrop}
                    onBoardDragLeave={onBoardDragLeave}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 12 }}>
        Polymarket, Kalshi, and Underdog Predict. Novig and 4Casters only when the server has credentials. No DraftKings, FanDuel, or other sportsbook columns.
        {" · "}Moneyline from Polymarket, Kalshi, and Underdog. Novig and 4Casters also show moneyline when configured. Underdog, Novig, and 4Casters show the main spread and total; Polymarket and Kalshi cells stay blank there.
        {" · "}A blank — means this feed has no quote for that side. It is not an error.
        {" · "}Pregame polls Underdog and keeps the Polymarket, Kalshi, Novig, and 4Casters streams open. LIVE uses the same feeds, including in-game Underdog.
        {" · "}Click a game to see the main lines already on the board. These feeds do not publish an alternate ladder.
        {" · "}Kalshi, Polymarket, and Underdog Predict show implied win probability
        {" · "}Green = best available odds across selected books (LIVE: while the game is moving, a number older than 60s cannot win Best; at halftime / intermission the allowance is 4 minutes)}
        {" · "}Best view default is Single (today's juice compare). Top 2 lines groups the two most popular spread/total points (unique books quoting that |point| on either side) and pairs both sides for each point; moneyline stays single}
        {" · "}× on a book square hides that game / market / side from Best (session only; Show to unhide)}
        {" · "}× on the Game column hides the whole matchup for this session (Show all / chip to restore). Cell hides stay. Does not affect Promo or the public Odds Board}
        {" · "}LIVE keeps the Polymarket, Kalshi, Novig, and 4Casters streams open and refreshes Underdog on the phone interval. A feed with no price stays blank
        {" · "}Best names the winning book in full with its logo; +N if tied
        {" · "}The odds number flashes green when that cell improves for the bettor and red when it gets worse (~0.9s). Same-price ticks, age-only heartbeats, and the isolated 1s age clock do not flash or remount the grid. OFF / empty cells do not flash
        {" · "}$ under a price is that book's size / limit when the feed sends it
        {" · "}muted age under a price is that line's last update (Best = newest contributing book)}
        {" · "}⋮⋮ on a game or book header drags that row/column (arrow keys on the handle also nudge). Best Odds stays pinned. Order is saved for this user and survives refresh / live ticks — Reset games / Reset books restores the default}
        {" · "}Book / Best / Game cells stay a fixed size — live ticks, ages, logos, OFF THE BOARD, and Best names clip or ellipsis inside the box. Wide slates scroll sideways instead of stretching columns}
      </div>

      {openGame && (
        <div
          data-alt-drawer="true"
          role="dialog"
          aria-modal="true"
          aria-label={`Alternate lines · ${openGame.away} @ ${openGame.home}`}
          style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", justifyContent: "flex-end" }}
        >
          <button
            type="button"
            data-alt-backdrop="true"
            aria-label="Close alternate lines"
            onClick={closeAlts}
            style={{ position: "absolute", inset: 0, border: "none", background: "rgba(0,0,0,0.62)", cursor: "pointer" }}
          />
          <div
            data-alt-panel="true"
            style={{
              position: "relative",
              width: "min(1100px, 100%)",
              height: "100%",
              background: "#0a0b0f",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              overflow: "auto",
              padding: "18px 18px 28px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <div>
                <button
                  type="button"
                  data-alt-close="true"
                  onClick={closeAlts}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#e8eaed", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
                >
                  ← Board
                </button>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed" }}>
                  {openGame.away} @ {openGame.home}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  Main lines on this board. Polymarket and Kalshi are moneyline. Underdog, and Novig or 4Casters when configured, may also show the main spread and total. No alternate ladder.
                </div>
              </div>
            </div>
            {altLoading && !altLadders && (
              <div style={{ padding: "36px 12px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>Loading alt lines…</div>
            )}
            {altError && (
              <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", marginBottom: 16, fontSize: 13 }}>
                {altError}
              </div>
            )}
            {altLadders && (
              <>
                {renderAltSection("Moneyline", "ml", altLadders.moneyline ? [{ line: null, ...altLadders.moneyline }] : [], "ml", () => "Moneyline")}
                {renderAltSection("Spreads", "spr", altLadders.spreads, "spr", (row) => `Away ${fmtSignedLine(row.line)}`)}
                {renderAltSection("Totals", "tot", altLadders.totals, "tot", (row) => `Total ${row.line}`)}
                {!altLadders.moneyline && !altLadders.spreads.length && !altLadders.totals.length && (
                  <div style={{ padding: "36px 12px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>
                    No moneyline, spread, or total from these feeds for this game.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </BestNowProvider>
    </AgeNowProvider>
  );
}
