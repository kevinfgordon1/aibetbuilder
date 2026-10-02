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
  betstampOddsBoardRequestIds,
} from "./betstampBooks.js";
import BookLabel from "./BookLabel.jsx";
import {
  gamesFromBetstampSnapshot,
  applyFixtureMeta,
  applyStreamMarkets,
  reconcileLiveGames,
  liveBoardPaintKey,
  liveGamePaintKey,
  gameVisibleOnBoard,
  unwrapStreamPayload,
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
  fixtureAltLadders,
} from "./betstampNormalize.js";
import {
  firstPartyPmLiveEnabled,
  polymarketStreamUrl,
  kalshiStreamUrl,
  novigStreamUrl,
  venueQuotesToMarkets,
  betstampRelayStreamUrl,
} from "./venueLive.js";
import {
  RELAY_SILENT_MS,
  RELAY_TICK_APPLY_MS,
  relayFeedFresh,
  createRelayBook,
} from "./betstampRelayStream.js";
import { quotesAfterVenueEvent } from "./freeFeedBoard.js";
// consumeBetstampStream is only used for the first-party Polymarket / Kalshi
// / Novig relays below. This board never opens /api/betstamp-stream (see header).
import {
  betstampSnapshotUrl,
  consumeBetstampStream,
  nextBackoffMs,
} from "./betstampLive.js";
import {
  BETSTAMP_BOARD_PREGAME_POLL_MS,
  BETSTAMP_BOARD_LIVE_POLL_MS,
  betstampBoardSnapshotUrl,
  betstampBoardRequestsPerPoll,
  booksWithBoardData,
  wrapNamespacedStorage,
  betstampOddsBoardColumns,
  withUnderdogPhone,
  BETSTAMP_BOARD_UNDERDOG_POLL_MS,
  BETSTAMP_BOARD_UNDERDOG_LIVE_POLL_MS,
  holdPolymarketOtbCells,
  withNovigQuotes,
  BETSTAMP_BOARD_PINNED_BOOK_KEYS,
} from "./betstampProBoard.js";
import { fetchUnderdogPhone } from "./underdogPhoneClient.js";
import { maskStaleOdds, maskedOddsReason } from "./oddsFreshness.js";
import { nflGameModeFor } from "./nflGameState.js";
import { GameStateLine, useNflGameStatePoll } from "./GameStateLine.jsx";

// Newest committed slate (one board instance per tab). Read by row masking.
const latestBoardGames = { current: [] };

// Betstamp Odds Board (Kevin only, #betstamp-odds-board).
//
// Restored from the Betstamp-powered New Odds Board before the free-feed
// cutover (#214, BetstampOddsBoard.jsx at 6ad2b04^) with the #233 black/gold
// .nob-theme applied. Differences from that board:
//   - Book columns are Kevin's core list (betstampOddsBoardBooks, BetMGM
//     next to DraftKings / FanDuel / Caesars), plus ProphetX / Polymarket /
//     Kalshi from Betstamp, then Novig, then Underdog Predict. Novig is not a
//     Betstamp provider: it reads the same public Novig feed as the New Odds
//     Board (odds relay /stream?venue=novig) and joins games the same way as
//     the Underdog column (withNovigQuotes → findUnderdogPhoneGame).
//     Underdog comes from its phone feed (/api/underdog-predict), polled and
//     matched exactly like the New Odds Board (applyUnderdogPhoneQuotes), so
//     both boards show the same Underdog prices. Never Betstamp Underdog
//     (196), Fliff, or Courtside. Columns with no prices are hidden.
//   - LIVE reads one shared Betstamp poll from the Railway odds relay over SSE
//     (GET <relay>/betstamp, about 2s; src/betstampRelayStream.js) when
//     VITE_ODDS_RELAY_URL is set. The relay is the only caller that talks to
//     Betstamp for live ticks, so browsers do not spend Betstamp requests.
//     If the relay stream is down, refused, or silent for 10s the board falls
//     back, with no action needed, to the REST poll below until it returns.
//   - Live updates poll /api/betstamp-markets?refresh=1 (5s LIVE, 15s pregame)
//     instead of opening /api/betstamp-stream. The Betstamp trial key allows
//     ONE upstream SSE connection, and /api/betstamp-stream opens a fresh
//     upstream per browser (no fan-out), so a second client gets "connection
//     limit reached" or knocks out whoever holds the slot. Polling is REST
//     only (3 upstream GETs per poll) and pauses while the tab is hidden.
//   - First-party Polymarket / Kalshi relay streams still overlay LIVE
//     (unchanged; they never touch Betstamp).

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
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--nob-muted)", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>+{extra}</span>
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

const OddsFlashNumber = memo(function OddsFlashNumber({ price, suspended, flashKey, title }) {
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
      title={title}
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
    <span data-liq={label} style={{ fontSize: 9, color: "var(--nob-muted)", fontWeight: 500, lineHeight: 1.15, display: inline ? "inline" : "block" }}>
      {label}
    </span>
  );
}

const OddsSide = memo(function OddsSide({ price, rawPrice, size, line, books, allBooks, showBestMark, updatedAt, ageTitle, showWinProb, suspended, maskedReason, flashKey }) {
  if (maskedReason) {
    // Frozen / suspended price (oddsFreshness.js): muted dash, reason on hover.
    return (
      <span data-odds-masked={maskedReason} title={`Hidden: ${maskedReason}`} style={{ color: "var(--nob-faint)", opacity: 0.6, cursor: "help", fontVariantNumeric: "tabular-nums" }}>
        —
      </span>
    );
  }
  const primary = books?.[0];
  const book = primary ? bookByKey(primary.key) : null;
  const title = bestBooksTitle(books, (k) => bookByKey(k)?.label);
  const winProb = showWinProb && price != null && !suspended ? formatWinProb(price) : null;
  // Fee-adjusted cells (Poly / Kalshi taker fee, Novig live fee): hover shows the raw ask.
  const feeTip = rawPrice != null ? `After taker fee. Raw ask ${formatAmericanOdds(rawPrice)}` : undefined;
  if (suspended) {
    return (
      <>
        {line && (
          <div className="obb-clip" data-odds-line={line} style={{ fontSize: 10, color: "var(--nob-faint)", fontWeight: 500, marginBottom: 2, lineHeight: 1.15, textDecoration: "line-through", opacity: 0.7 }}>
            {line}
          </div>
        )}
        <div
          className="obb-off"
          data-odds-suspended="1"
          data-odds-off="1"
          title="Off the board — Betstamp no longer lists this line live"
        >
          <span>OFF</span>
          <span className="obb-off-sub">the board</span>
        </div>
      </>
    );
  }
  return (
    <>
      {line && <div className="obb-clip" data-odds-line={line} style={{ fontSize: 10, color: "var(--nob-muted)", fontWeight: 500, marginBottom: 0, lineHeight: 1.15 }}>{line}</div>}
      <div className="obb-clip" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, flexWrap: "nowrap", lineHeight: 1.15, maxWidth: "100%" }}>
        <OddsFlashNumber price={price} suspended={false} flashKey={flashKey} title={feeTip} />
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
          style={{ fontSize: 10, color: "var(--nob-muted)", fontWeight: 600, marginTop: 1, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.15 }}
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
  && prev.maskedReason === next.maskedReason
  && !!prev.suspended === !!next.suspended
  && !!prev.showBestMark === !!next.showBestMark
  && !!prev.showWinProb === !!next.showWinProb
  && prev.line === next.line
  && prev.size === next.size
  && prev.updatedAt === next.updatedAt
  && prev.ageTitle === next.ageTitle
  && sameAmericanPrice(prev.price, next.price)
  && sameAmericanPrice(prev.rawPrice, next.rawPrice)
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
          color: "var(--nob-text-2)",
          background: "rgba(64,42,18,0.38)",
          boxShadow: "inset 0 0 0 1px rgba(var(--nob-warn-rgb),0.28)",
        } : {}),
        ...(hidden ? {
          color: "var(--nob-muted)",
          background: "var(--nob-chip)",
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
        <div data-odds-hidden-label="true" style={{ fontSize: 9, fontWeight: 700, color: "var(--nob-text-2)", marginTop: 1, letterSpacing: 0.3, textTransform: "uppercase", lineHeight: 1.1 }}>
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
  if (ms == null) return "var(--nob-muted)";
  if (ms <= 500) return "var(--nob-good)";
  if (ms <= 1200) return "var(--nob-warn-bright)";
  return "var(--nob-warn)";
}

// Scoped "Masterclass" dark/gold palette for the New Odds Board only. Every
// color in this tab reads from these CSS variables on the board root, so no
// other tab changes. Sampled from Kevin's reference screenshots.
const NOB_THEME_VARS = {
  "--nob-bg": "#141414",
  "--nob-surface": "#181818",
  "--nob-head": "#1f1f1f",
  "--nob-warm": "#221d1a",
  "--nob-chip": "#1f1f1f",
  "--nob-chip-hover": "#262626",
  "--nob-border": "#2a2a2a",
  "--nob-border-strong": "#333333",
  "--nob-divider": "#222222",
  "--nob-gold": "#bc9e66",
  "--nob-gold-rgb": "188,158,102",
  "--nob-on-gold": "#17140f",
  "--nob-text": "#e4e0d8",
  "--nob-text-2": "#a8a49c",
  "--nob-muted": "#8a8a8a",
  "--nob-faint": "#5e5e5e",
  "--nob-empty": "#3a3a3a",
  "--nob-good": "#7cc49a",
  "--nob-good-rgb": "124,196,154",
  "--nob-good-bright": "#a6dcbb",
  "--nob-bad": "#d88c84",
  "--nob-bad-rgb": "216,140,132",
  "--nob-bad-bright": "#eab3ac",
  "--nob-warn": "#e0a04a",
  "--nob-warn-rgb": "224,160,74",
  "--nob-warn-bright": "#edc07e",
};

const NOB_ROOT_STYLE = {
  ...NOB_THEME_VARS,
  background: "var(--nob-bg)",
  color: "var(--nob-text)",
  border: "1px solid #1c1c1c",
  borderRadius: 14,
};

const BOARD_SIDE_STYLE = (isBestCol, isBestCell, empty) => ({
  padding: "3px 4px",
  lineHeight: 1.15,
  borderBottom: "1px solid var(--nob-divider)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  fontWeight: 700,
  color: empty ? "var(--nob-empty)" : (isBestCol || isBestCell) ? "var(--nob-good)" : "var(--nob-text)",
  background: isBestCell ? "rgba(var(--nob-good-rgb),0.08)" : isBestCol ? "rgba(var(--nob-good-rgb),0.04)" : "transparent",
});

const LiveTickStrip = memo(function LiveTickStrip({
  liveOnly,
  books,
  games,
  snapshotAt,
  streamStatus,
  pollMs,
  pollStats,
  requestsPerPoll,
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
  // Betstamp soft books print slower than the 10s venue threshold; keep the
  // pre-#214 2-minute window for this board.
  const staleSoft = liveOnly ? staleLiveBookLabels(games, books, nowMs, { staleMs: 120_000 }) : [];

  return (
    <div
      data-tick-metrics="true"
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--nob-border)",
        background: "var(--nob-surface)",
      }}
    >
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Feed</div>
          <div data-feed-mode={streamStatus} title={streamStatus === "relay" ? "Betstamp live feed from the odds relay (one shared Betstamp poll, pushed over SSE). Falls back to the REST poll through /api/betstamp-markets if the relay goes quiet for 10s." : "REST snapshot poll through /api/betstamp-markets. No Betstamp SSE connection (the trial key allows one)."} style={{ fontSize: 14, fontWeight: 700, color: streamStatus === "polling" || streamStatus === "relay" ? "var(--nob-good)" : "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>
            {streamStatus === "polling" ? `poll ${Math.round(pollMs / 1000)}s` : streamStatus === "relay" ? "relay ~2s" : streamStatus}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Last updated
          </div>
          <div
            data-last-updated={snapshotAt || ""}
            data-snapshot-age
            title={snapshotAt ? new Date(snapshotAt).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : ""}
            style={{ fontSize: 16, fontWeight: 700, color: snapshotAt && nowMs - snapshotAt > pollMs * 3 ? "var(--nob-warn)" : "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}
          >
            {snapshotAt
              ? `${new Date(snapshotAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" })} ET · ${formatCompactAge(snapshotAt, nowMs) || "0s"} ago`
              : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Betstamp calls</div>
          <div data-betstamp-calls={(pollStats.polls + pollStats.errors) * requestsPerPoll} title={`${pollStats.polls} snapshots × ${requestsPerPoll} upstream GETs this session${pollStats.errors ? ` · ${pollStats.errors} failed` : ""}`} style={{ fontSize: 16, fontWeight: 700, color: pollStats.lastError ? "var(--nob-warn)" : "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>
            {(pollStats.polls + pollStats.errors) * requestsPerPoll}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }} title="Polymarket / Kalshi first-party relay ticks (LIVE only)">Last PM tick</div>
          <div data-last-tick-age style={{ fontSize: 20, fontWeight: 800, color: ageTone(metrics.lastTickAgeMs), fontFamily: "'JetBrains Mono', monospace" }}>
            {liveOnly ? fmtMs(metrics.lastTickAgeMs) : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>p50 inter-arrival</div>
          <div data-p50 style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.p50InterArrivalMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>p95 inter-arrival</div>
          <div data-p95 style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.p95InterArrivalMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Tick lag</div>
          <div data-tick-lag style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>{fmtMs(metrics.lastLagMs)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Ticks</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-text)", fontFamily: "'JetBrains Mono', monospace" }}>{metrics.eventCount}</div>
        </div>
      </div>
      {staleSoft.length > 0 && (
        <div
          data-soft-book-stale={staleSoft.map((b) => b.key).join(",")}
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(var(--nob-warn-rgb),0.35)",
            background: "rgba(64,42,18,0.35)",
            color: "var(--nob-warn)",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {staleSoft.map((b) => `${b.label} ${b.age}`).join(" · ")}
          {" — last Betstamp print (updated_at), not a frozen poll. Soft books often do not move live."}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {books.map((b) => {
          const row = metrics.perBook[b.key];
          return (
            <span key={b.key} data-book-age={b.key} style={{ fontSize: 10, color: "var(--nob-text-2)", fontFamily: "'JetBrains Mono', monospace" }}>
              {b.label} {row ? fmtMs(nowMs - row.lastAt) : "—"}
            </span>
          );
        })}
      </div>
      {!!metrics.ticks.length && (
        <div data-tick-log="true" style={{ marginTop: 10, maxHeight: 92, overflow: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--nob-text-2)" }}>
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
            borderTop: "1px solid rgba(var(--nob-good-rgb),0.28)",
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
              borderTop: "1px solid rgba(var(--nob-good-rgb),0.12)",
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
    rawPrice: which === "top" ? cell.topRaw : cell.botRaw,
    size: which === "top" ? cell.topSize : cell.botSize,
    line: includeLine ? (which === "top" ? cell.topLine : cell.botLine) : null,
    books: which === "top" ? cell.topBooks : cell.botBooks,
    allBooks: books,
    showBestMark: isBestCol,
    showWinProb: cellShowsWinProb(b.key, which === "top" ? cell.topBooks : cell.botBooks),
    updatedAt: which === "top" ? topUpdatedAt : botUpdatedAt,
    ageTitle: isBestCol ? "Newest update among books offering this best price" : undefined,
    suspended: !isBestCol && lineIsSuspended(rowGame, b.key, which === "top" ? fields.top : fields.bot),
    maskedReason: isBestCol ? null : maskedOddsReason(rowGame, b.key, which === "top" ? fields.top : fields.bot),
    flashKey: `${rowGame.id}:${marketKey}:${b.key}:${which}`,
  });
  const topOff = sideProps("top").suspended;
  const botOff = sideProps("bot").suspended;
  const colW = obbColWidth(b.key);
  if (pairBlocks) {
    const emptyPairs = !cell.pointStacks.length || cell.pointStacks.every((block) => block.top?.price == null && block.bot?.price == null);
    return (
      <td key={b.key} data-obb-cell={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", width: colW, maxWidth: colW, overflow: "hidden", borderLeft: b.key === "draftkings" ? "2px solid var(--nob-border)" : "none" }}>
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
    <td key={b.key} data-obb-cell={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", width: colW, maxWidth: colW, overflow: "hidden", borderLeft: b.key === "draftkings" ? "2px solid var(--nob-border)" : "none" }}>
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
  // Frozen / suspended prices drop out before Best is picked.
  // The row only repaints on price / line / OFF changes; flags and same-price
  // restamps land in latestBoardGames first, so mask the newest copy.
  const rowGame = useMemo(() => {
    const latest = latestBoardGames.current.find((g) => g && g.id === game.id) || game;
    return maskStaleOdds(latest, { nowMs: bestNowMs, gameMode: nflGameModeFor(latest, bestNowMs) });
  }, [game, bestNowMs]);
  return renderOddsColumns({
    rowGame,
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
      style={{ borderBottom: "1px solid var(--nob-divider)", cursor: "pointer" }}
    >
      <td
        className="obb-game"
        data-hide-game-cell="true"
        style={{ padding: 0, width: OBB_TEAM_COL_WIDTH, maxWidth: OBB_TEAM_COL_WIDTH, overflow: "hidden", position: "sticky", left: 0, background: "var(--nob-surface)", zIndex: 1, borderRight: "1px solid var(--nob-border)" }}
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--nob-faint)", marginBottom: 1, lineHeight: 1.15 }}>
            <BoardGrip
              kind="game"
              itemKey={String(game.id)}
              label={`Reorder ${game.away} @ ${game.home}`}
              onMove={onNudgeGame}
              onDragBegin={onDragBegin}
              onDragEnd={onDragEnd}
            />
            {game.is_live ? (
              <span style={{ color: "var(--nob-good)", fontWeight: 700 }}>LIVE</span>
            ) : (
              new Date(game.commence_time || Date.now()).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }) + " ET"
            )}
          </div>
          <GameStateLine game={game} />
          <div className="obb-game-name" title={game.away} style={{ fontSize: 13, fontWeight: 600, color: "var(--nob-gold)", textDecoration: "underline", textDecorationColor: "rgba(var(--nob-gold-rgb),0.35)", textUnderlineOffset: 2, marginBottom: 2, lineHeight: 1.15 }}>
            {game.away}{game.is_live && game.away_score != null ? ` ${game.away_score}` : ""}
          </div>
          <div className="obb-game-name" title={game.home} style={{ fontSize: 13, fontWeight: 600, color: "var(--nob-gold)", textDecoration: "underline", textDecorationColor: "rgba(var(--nob-gold-rgb),0.35)", textUnderlineOffset: 2, lineHeight: 1.15 }}>
            {game.home}{game.is_live && game.home_score != null ? ` ${game.home_score}` : ""}
          </div>
          <div style={{ fontSize: 10, color: "var(--nob-gold)", fontWeight: 700, margin: "2px 0 0", lineHeight: 1.15 }}>Alts →</div>
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

export default function BetstampProOddsBoard({ user = null, refreshKey = 0 } = {}) {
  const allBooks = useMemo(() => betstampOddsBoardColumns(), []);
  const bookIds = useMemo(() => betstampOddsBoardRequestIds(), []);
  const bookIdsKey = bookIds.join(",");
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(() => new Set(allBooks.map((b) => b.key)));
  const [boardSport, setBoardSport] = useState(BETSTAMP_DEFAULT_SPORT);
  const [liveOnly, setLiveOnly] = useState(false); // Pregame default. Never auto-enable LIVE.
  const [games, setGames] = useState([]);
  const anyLiveGame = games.some((g) => g && g.is_live);
  // Game state (ESPN; PM US fallback) for the LIVE row line and frozen gates.
  useNflGameStatePoll(boardSport === "americanfootball_nfl" && (liveOnly || anyLiveGame));
  const [loadError, setLoadError] = useState(null);
  const [missingKey, setMissingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [snapshotAt, setSnapshotAt] = useState(null);
  const [pollStats, setPollStats] = useState({ polls: 0, errors: 0, lastError: null });
  const gamesRef = useRef([]);
  // Latest Underdog phone slate (null until the first poll returns).
  const phoneRef = useRef(null);
  // Latest Novig relay quotes (null until the stream sends its book).
  const novigRef = useRef(null);
  const tickSinkRef = useRef(null);
  const moveGameRef = useRef(null);
  const moveBookRef = useRef(null);
  const openAltsRef = useRef(null);
  const nudgeGameRef = useRef(null);
  const registerTickSink = useCallback((fn) => { tickSinkRef.current = fn; }, []);
  const fetchGen = useRef(0);
  const altCacheRef = useRef(new Map());
  const altFetchGen = useRef(0);
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const orderStorage = useMemo(() => wrapNamespacedStorage("betstampOddsBoard"), []);
  const [boardOrder, setBoardOrder] = useState(() => loadOddsBoardOrder(user, orderStorage));
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
    latestBoardGames.current = next || [];
    if (!force && liveBoardPaintKey(prev) === liveBoardPaintKey(next)) return false;
    setGames(next);
    return true;
  };

  // Hide book columns that returned no prices on this slate. Keep the full
  // catalog until the first snapshot lands so the header does not flash.
  const dataBookKeys = useMemo(() => booksWithBoardData(games), [games]);
  const dataBookKeysKey = [...dataBookKeys].sort().join(",");
  const books = useMemo(() => {
    if (!games.length) return allBooks;
    return allBooks.filter((b) => dataBookKeys.has(b.key) || BETSTAMP_BOARD_PINNED_BOOK_KEYS.includes(b.key));
  }, [allBooks, dataBookKeysKey, games.length ? 1 : 0]);

  useEffect(() => {
    setBoardOrder(loadOddsBoardOrder(user, orderStorage));
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
    setLoading(true);
    setLoadError(null);
    setMissingKey(false);
    setSnapshotAt(null);
    setStreamStatus(liveOnly ? "connecting" : "idle");

    const pollMs = liveOnly ? BETSTAMP_BOARD_LIVE_POLL_MS : BETSTAMP_BOARD_PREGAME_POLL_MS;
    const snapUrl = () => betstampBoardSnapshotUrl({ league, live: liveOnly, bookIds });
    // Last good Polymarket (193) cells, per board session (sport / LIVE toggle).
    const pmOtbHold = new Map();

    // Paint one Betstamp-shaped body ({ markets, fixtures, teams }). Shared by
    // the REST poll and the relay stream so both land the same way.
    const paintBody = (body, { showLoading }) => {
      const fetchedAt = Date.now();
      const payload = {
        markets: body.markets,
        fixtures: body.fixtures,
        teams: body.teams,
        nowMs: fetchedAt,
      };
      if (showLoading || !liveOnly || !gamesRef.current.length) {
        const rebuilt = holdPolymarketOtbCells(gamesFromBetstampSnapshot(payload), body.markets, pmOtbHold, { nowMs: fetchedAt });
        commitGames(withNovigQuotes(withUnderdogPhone(rebuilt, phoneRef.current, league), novigRef.current, league), { force: true });
      } else {
        const withMeta = applyFixtureMeta(gamesRef.current, body.fixtures || []);
        commitGames(withNovigQuotes(withUnderdogPhone(reconcileLiveGames(withMeta, payload), phoneRef.current, league), novigRef.current, league));
      }
      setSnapshotAt(fetchedAt);
      setLoadError(null);
    };

    // First load and every poll: one REST snapshot through the shared proxy.
    // Pregame rebuilds the slate; LIVE reconciles into the painted rows so
    // venue ticks and flash state survive.
    const applySnapshot = async ({ showLoading }) => {
      try {
        const res = await fetch(snapUrl(), { signal: ctrl.signal, cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (gen !== fetchGen.current) return false;
        if (body.missingKey || res.status === 503) {
          setMissingKey(true);
          setLoadError(body.error || "BETSTAMP_API_KEY is not set");
          if (showLoading) {
            commitGames([], { force: true });
            setLoading(false);
          }
          return false;
        }
        if (!res.ok || body.ok === false || body.markets == null) {
          const msg = body.error || `Snapshot failed (${res.status})`;
          setPollStats((p) => ({ ...p, errors: p.errors + 1, lastError: msg }));
          if (showLoading) {
            setLoadError(msg);
            commitGames([], { force: true });
            setLoading(false);
          }
          return false;
        }
        paintBody(body, { showLoading });
        setPollStats((p) => ({ ...p, polls: p.polls + 1, lastError: null }));
        if (showLoading) setLoading(false);
        return true;
      } catch (err) {
        if (ctrl.signal.aborted || gen !== fetchGen.current) return false;
        setPollStats((p) => ({ ...p, errors: p.errors + 1, lastError: err.message || "network" }));
        if (showLoading) {
          setLoadError(err.message || "Could not load snapshot");
          setLoading(false);
        }
        return false;
      }
    };

    let cancelled = false;
    let pollTimer;
    let pollInFlight = false;
    const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    applySnapshot({ showLoading: true });
    setStreamStatus("polling");
    // Relay stream (LIVE only). While it is fresh the REST poll stands down;
    // the moment it is down or silent for RELAY_SILENT_MS the poll resumes.
    const relayUrl = liveOnly ? betstampRelayStreamUrl({ league, bookIds }) : null;
    let relayLastAt = 0;
    let relayLastApplyAt = 0;
    let relayDirty = false;
    let relayBook = null;
    let relayConn = null;
    const relayFresh = () => !!relayUrl && relayFeedFresh(relayLastAt, Date.now(), RELAY_SILENT_MS);

    const pollNow = () => {
      if (pollInFlight || cancelled) return;
      pollInFlight = true;
      applySnapshot({ showLoading: false }).finally(() => { pollInFlight = false; });
    };
    pollTimer = setInterval(() => {
      // Hidden tab: skip. Saves Betstamp budget; the next visible tick catches up.
      if (pollInFlight || cancelled || pageHidden()) return;
      if (relayFresh()) return;
      pollNow();
    }, pollMs);

    const paintRelay = () => {
      if (!relayBook || cancelled || gen !== fetchGen.current) return;
      relayLastApplyAt = Date.now();
      relayDirty = false;
      paintBody(relayBook.payload(), { showLoading: false });
      setPollStats((p) => (p.lastError ? { ...p, lastError: null } : p));
    };

    const onVisible = () => {
      if (cancelled || pageHidden()) return;
      if (relayFresh()) {
        if (relayDirty) paintRelay();
        return;
      }
      pollNow();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

    const runVenue = async (url) => {
      // On for production builds. VITE_FIRST_PARTY_PM_LIVE=0 opts out. Betstamp SSE stays.
      if (!liveOnly || !firstPartyPmLiveEnabled() || cancelled) return;
      let venueAttempt = 0;
      while (!cancelled && !ctrl.signal.aborted) {
        try {
          await consumeBetstampStream({
            url,
            signal: ctrl.signal,
            onEvent: (ev) => {
              if (cancelled || gen !== fetchGen.current) return;
              const receivedAt = Date.now();
              const payload = ev && ev.data && ev.data.payload;
              const quotes = payload && payload.quotes;
              if (!quotes || !quotes.length) return;
              const ingestTs = ev.data.ingest_ts;
              const markets = venueQuotesToMarkets(gamesRef.current, quotes, { liveBoard: true });
              if (!markets.length) return;
              const recv = typeof ingestTs === "number" ? ingestTs : receivedAt;
              const { games: streamed, applied } = applyStreamMarkets(gamesRef.current, markets, {
                receivedAt: recv,
                nowMs: receivedAt,
                allowNewGames: false,
              });
              if (!applied.length) return;
              commitGames(streamed);
              tickSinkRef.current?.(applied, recv);
            },
          });
        } catch {
          if (cancelled || ctrl.signal.aborted) return;
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

    const venueTimers = [];
    if (liveOnly) {
      runVenue(polymarketStreamUrl({ league }));
      runVenue(kalshiStreamUrl({ league }));
    }

    // Betstamp via the relay. One connection per tab; reconnects with backoff.
    const runRelay = async () => {
      if (!relayUrl || cancelled) return;
      let attempt = 0;
      while (!cancelled && !ctrl.signal.aborted) {
        const conn = new AbortController();
        relayConn = conn;
        const onParentAbort = () => conn.abort();
        ctrl.signal.addEventListener("abort", onParentAbort, { once: true });
        relayBook = createRelayBook();
        let gotEvent = false;
        let refused = false;
        try {
          await consumeBetstampStream({
            url: relayUrl,
            signal: conn.signal,
            onEvent: (ev) => {
              if (cancelled || gen !== fetchGen.current || !ev || ev.event !== "bs") return;
              const out = relayBook.apply(ev.data);
              if (out.kind === "gap") { conn.abort(); return; }
              if (out.kind === "error") {
                setPollStats((p) => ({ ...p, lastError: `relay: ${out.error}` }));
                return;
              }
              if (out.kind === "ignore") return;
              const wasFresh = relayFresh();
              relayLastAt = Date.now();
              gotEvent = true;
              attempt = 0;
              if (!wasFresh) setStreamStatus("relay");
              if (pageHidden()) { relayDirty = true; return; }
              if (out.kind === "tick" && relayLastAt - relayLastApplyAt < RELAY_TICK_APPLY_MS) return;
              paintRelay();
            },
          });
        } catch (err) {
          if (cancelled || ctrl.signal.aborted) return;
          // 400 / 503: the relay has no Betstamp feed for this board. Try again slowly.
          refused = err && (err.status === 400 || err.status === 503);
        } finally {
          ctrl.signal.removeEventListener("abort", onParentAbort);
          if (relayConn === conn) relayConn = null;
        }
        if (cancelled || ctrl.signal.aborted) return;
        if (!relayFresh()) setStreamStatus("polling");
        const wait = refused ? 30_000 : (gotEvent ? 250 : nextBackoffMs(attempt, { max: 10_000 }));
        attempt += gotEvent ? 0 : 1;
        await new Promise((resolve) => {
          const t = setTimeout(resolve, wait);
          venueTimers.push(t);
        });
      }
    };
    let relayWatch = null;
    if (relayUrl) {
      runRelay();
      // A stream that stays open but says nothing is as bad as a closed one:
      // poll right away and drop the connection so it reconnects.
      relayWatch = setInterval(() => {
        if (cancelled || !relayLastAt) return;
        if (Date.now() - relayLastAt < RELAY_SILENT_MS) return;
        relayLastAt = 0;
        setStreamStatus("polling");
        if (relayConn) relayConn.abort();
        if (!pageHidden()) pollNow();
      }, 2_000);
    }

    return () => {
      cancelled = true;
      ctrl.abort();
      if (relayWatch) clearInterval(relayWatch);
      clearInterval(pollTimer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      venueTimers.forEach((t) => clearTimeout(t));
    };
  }, [boardSport, liveOnly, bookIdsKey, boardRefreshKey]);

  // Underdog Predict: same /api/underdog-predict poll as the New Odds Board
  // (20s pregame, 30s LIVE with ?live=1). Repaints only the Underdog cells.
  useEffect(() => {
    const league = leagueForSport(boardSport);
    phoneRef.current = null;
    const ctrl = new AbortController();
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden" && phoneRef.current) return;
      inFlight = true;
      try {
        const body = await fetchUnderdogPhone((url, init) => fetch(url, {
          ...(init || {}),
          signal: ctrl.signal,
          cache: "no-store",
        }), { live: liveOnly });
        if (cancelled || ctrl.signal.aborted) return;
        phoneRef.current = body && Array.isArray(body.games) ? body : { ok: false, games: [] };
      } catch {
        if (cancelled || ctrl.signal.aborted) return;
        phoneRef.current = { ok: false, games: [] };
      } finally {
        inFlight = false;
      }
      if (cancelled || !gamesRef.current.length) return;
      commitGames(withUnderdogPhone(gamesRef.current, phoneRef.current, league));
    };
    load();
    const timer = setInterval(load, liveOnly ? BETSTAMP_BOARD_UNDERDOG_LIVE_POLL_MS : BETSTAMP_BOARD_UNDERDOG_POLL_MS);
    // Tab visible again: refresh Underdog now instead of on the next tick.
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") load();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [boardSport, liveOnly, boardRefreshKey]);

  // Novig: same public feed as the New Odds Board (odds relay, about 9s
  // behind; /api/novig-stream without a relay). Pregame and LIVE share the
  // stream. Repaints only the Novig cells; the Betstamp poll re-applies them.
  useEffect(() => {
    const league = leagueForSport(boardSport);
    novigRef.current = null;
    if (!firstPartyPmLiveEnabled()) return undefined;
    const ctrl = new AbortController();
    const timers = [];
    let cancelled = false;
    let quotes = [];
    (async () => {
      let attempt = 0;
      while (!cancelled && !ctrl.signal.aborted) {
        let connected = false;
        try {
          await consumeBetstampStream({
            url: novigStreamUrl({ league }),
            signal: ctrl.signal,
            onStatus: (s) => { if (s === "live") connected = true; },
            onEvent: (ev) => {
              if (cancelled) return;
              const payload = ev && ev.data && ev.data.payload;
              if (!payload) return;
              if (payload.mode === "needs-credentials" || payload.note === "novig_needs_credentials") return;
              if (!Array.isArray(payload.quotes) || !payload.quotes.length) return;
              quotes = quotesAfterVenueEvent(quotes, payload);
              novigRef.current = quotes;
              if (!gamesRef.current.length) return;
              commitGames(withNovigQuotes(gamesRef.current, quotes, league));
            },
          });
        } catch {
          if (cancelled || ctrl.signal.aborted) return;
        }
        if (cancelled || ctrl.signal.aborted) return;
        // A clean end is the relay / function recycle: rejoin at once.
        const wait = connected ? 100 : nextBackoffMs(attempt);
        attempt = connected ? 0 : attempt + 1;
        await new Promise((resolve) => {
          timers.push(setTimeout(resolve, wait));
        });
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [boardSport, boardRefreshKey]);

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
    const gen = ++altFetchGen.current;
    setOpenGame(game);
    const cached = altCacheRef.current.get(String(game.id));
    if (cached) {
      setAltLadders(cached);
      setAltError(null);
      setAltLoading(false);
    } else {
      setAltLadders(null);
      setAltLoading(true);
      setAltError(null);
    }
    const league = game.league || leagueForSport(boardSport);
    (async () => {
      try {
        const res = await fetch(betstampSnapshotUrl({
          league,
          live: liveOnly,
          includeAlts: true,
          fixtureId: game.id,
          bookIds,
        }), { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (gen !== altFetchGen.current) return;
        if (body.missingKey || res.status === 503) {
          setAltError(body.error || "BETSTAMP_API_KEY is not set");
          setAltLoading(false);
          return;
        }
        if (!res.ok || body.ok === false) {
          setAltError(body.error || `Alt snapshot failed (${res.status})`);
          setAltLoading(false);
          return;
        }
        const ladders = fixtureAltLadders({
          markets: body.markets,
          game,
          nowMs: Date.now(),
        });
        altCacheRef.current.set(String(game.id), ladders);
        setAltLadders(ladders);
        setAltLoading(false);
        setAltError(null);
      } catch (err) {
        if (gen !== altFetchGen.current) return;
        setAltError(err.message || "Could not load alt lines");
        setAltLoading(false);
      }
    })();
  };
  openAltsRef.current = openAlts;

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
    setBoardOrder(saveOddsBoardOrder(user, next, orderStorage));
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--nob-text-2)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
        <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--nob-border)" }}>
          <table className="obb-grid" data-col-layout="fixed" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: tableWidth, minWidth: tableWidth, maxWidth: tableWidth }}>
            <colgroup>
              <col data-obb-col="game" style={{ width: teamColWidth }} />
              {visibleBooks.map((b) => (
                <col key={b.key} data-obb-col={b.key} style={{ width: colWidthFor(b.key) }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: "var(--nob-head)", borderBottom: "1px solid var(--nob-border)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--nob-head)", zIndex: 2 }}>Line</th>
                {visibleBooks.map((b) => (
                  <th key={b.key} data-book-header={b.key} style={{ padding: "10px 6px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "var(--nob-good)" : "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.5, width: colWidthFor(b.key), maxWidth: colWidthFor(b.key), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid var(--nob-border)" : "none" }}>
                    {b.key === "best" ? b.label : <BookLabel book={b} size={16} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${section}-${row.line ?? "ml"}`} data-alt-line={row.line ?? "ml"} data-alt-main={row.isMain ? "1" : "0"} style={{ borderBottom: "1px solid var(--nob-divider)", background: row.isMain ? "rgba(var(--nob-gold-rgb),0.05)" : "transparent" }}>
                  <td style={{ padding: "6px 12px", width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", position: "sticky", left: 0, background: row.isMain ? "var(--nob-warm)" : "var(--nob-surface)", zIndex: 1, borderRight: "1px solid var(--nob-border)", fontSize: 13, fontWeight: 600, color: "var(--nob-text)", lineHeight: 1.2 }}>
                    <div>{labelFor(row)}</div>
                    {row.isMain && <div style={{ fontSize: 10, color: "var(--nob-gold)", fontWeight: 700, marginTop: 2 }}>MAIN</div>}
                    {marketKey === "ml" && (
                      <div style={{ fontSize: 11, color: "var(--nob-muted)", marginTop: 4, fontWeight: 500 }}>
                        <div>{openGame?.away}</div>
                        <div style={{ marginTop: 3 }}>{openGame?.home}</div>
                      </div>
                    )}
                    {marketKey === "spr" && (
                      <div style={{ fontSize: 11, color: "var(--nob-muted)", marginTop: 4, fontWeight: 500 }}>
                        <div>{openGame?.awayAbbr || openGame?.away} {fmtSignedLine(row.line)}</div>
                        <div style={{ marginTop: 3 }}>{openGame?.homeAbbr || openGame?.home} {fmtSignedLine(row.line == null ? null : -row.line)}</div>
                      </div>
                    )}
                    {marketKey === "tot" && (
                      <div style={{ fontSize: 11, color: "var(--nob-muted)", marginTop: 4, fontWeight: 500 }}>
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
      data-betstamp-pro-board="true"
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
      data-live-poll-ms={BETSTAMP_BOARD_LIVE_POLL_MS}
      data-pregame-poll-ms={BETSTAMP_BOARD_PREGAME_POLL_MS}
      data-betstamp-sse="off"
      data-live-paint-key={liveBoardPaintKey(games) ? "1" : "0"}
      data-live-clock="isolated"
      data-nob-theme="masterclass"
      className="nob-theme"
      style={NOB_ROOT_STYLE}
    >
      <style>{`
        .nob-theme { padding: 18px 18px 14px; }
        @media (max-width: 600px) {
          .nob-theme { padding: 12px 10px 10px; border-radius: 10px !important; }
        }
        .nob-theme .obb-scroll { background: var(--nob-surface); }
        .nob-theme input::placeholder { color: var(--nob-faint); }
        .nob-theme input:focus { border-color: rgba(var(--nob-gold-rgb),0.55) !important; }
        .nob-theme button:focus-visible { outline: 1px solid rgba(var(--nob-gold-rgb),0.7); outline-offset: 1px; }
        .nob-theme [data-book-logo] { filter: brightness(0.9) saturate(0.9); }
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
          color: var(--nob-faint);
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
          color: var(--nob-text-2);
          background: rgba(20,20,20,0.75);
        }
        .obb-side[data-hidden="1"] .obb-hide {
          opacity: 1;
          pointer-events: auto;
          color: var(--nob-text);
          background: rgba(20,20,20,0.94);
          border-color: var(--nob-border-strong);
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
          color: var(--nob-muted);
          font-size: 11px;
          line-height: 1;
          letter-spacing: -1px;
          cursor: grab;
          flex-shrink: 0;
          font-family: 'DM Sans', sans-serif;
        }
        .obb-grip:hover, .obb-grip:focus {
          color: var(--nob-text);
          background: var(--nob-chip-hover);
          outline: none;
        }
        .obb-grip:active { cursor: grabbing; }
        tr[data-drag-over="1"], th[data-drag-over="1"] {
          box-shadow: inset 0 2px 0 var(--nob-gold);
        }
        tr[data-dragging="1"], th[data-dragging="1"] { opacity: 0.45; }
        .obb-flash {
          display: inline-block;
          padding: 0 3px;
          border-radius: 3px;
          font-variant-numeric: tabular-nums;
        }
        @keyframes obb-flash-up {
          0%, 20% { color: var(--nob-good-bright); background: rgba(var(--nob-good-rgb),0.38); text-shadow: 0 0 10px rgba(var(--nob-good-rgb),0.55); }
          100% { color: inherit; background: transparent; text-shadow: none; }
        }
        @keyframes obb-flash-down {
          0%, 20% { color: var(--nob-bad-bright); background: rgba(var(--nob-bad-rgb),0.38); text-shadow: 0 0 10px rgba(var(--nob-bad-rgb),0.5); }
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
          border: 1px dashed rgba(var(--nob-warn-rgb),0.55);
          background: rgba(64,42,18,0.55);
          color: var(--nob-warn);
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
          color: var(--nob-warn-bright);
          opacity: 0.9;
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-gold)", letterSpacing: 0.2 }}>Betstamp Odds Board</div>
          <div style={{ fontSize: 12, color: "var(--nob-muted)", marginTop: 4 }}>
            Betstamp sportsbooks, American odds, best price highlighted. Refreshes by polling Betstamp snapshots (no live stream slot used). Kevin only.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-board-refresh="1"
            onClick={() => setLocalRefresh((n) => n + 1)}
            title="Re-pull Betstamp (bypasses the 5-minute Promo cache on LIVE)"
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid rgba(var(--nob-gold-rgb),0.5)",
              background: "rgba(var(--nob-gold-rgb),0.10)",
              color: "var(--nob-gold)",
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
              border: liveOnly ? "1px solid rgba(var(--nob-good-rgb),0.45)" : "1px solid var(--nob-border-strong)",
              background: liveOnly ? "rgba(var(--nob-good-rgb),0.15)" : "var(--nob-chip)",
              color: liveOnly ? "var(--nob-good)" : "var(--nob-text-2)",
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
        pollMs={liveOnly ? BETSTAMP_BOARD_LIVE_POLL_MS : BETSTAMP_BOARD_PREGAME_POLL_MS}
        pollStats={pollStats}
        requestsPerPoll={betstampBoardRequestsPerPoll(leagueForSport(boardSport))}
        register={registerTickSink}
        resetKey={`${boardSport}:${bookIdsKey}:${boardRefreshKey}`}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {BETSTAMP_SPORTS.map((s) => (
          <button key={s.id} onClick={() => setBoardSport(s.id)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: boardSport === s.id ? "var(--nob-gold)" : "var(--nob-chip)", color: boardSport === s.id ? "var(--nob-on-gold)" : "var(--nob-text-2)", boxShadow: boardSport === s.id ? "none" : "inset 0 0 0 1px var(--nob-border)" }}>
            {s.label}
          </button>
        ))}
      </div>
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search team or matchup..." style={{ width: "100%", maxWidth: 400, background: "var(--nob-chip)", border: "1px solid var(--nob-border-strong)", borderRadius: 8, color: "var(--nob-text)", padding: "10px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["ml", "spr", "tot"].map((m) => (
          <button key={m} onClick={() => setMarket(m)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: market === m ? "var(--nob-gold)" : "var(--nob-chip)", color: market === m ? "var(--nob-on-gold)" : "var(--nob-text-2)", boxShadow: market === m ? "none" : "inset 0 0 0 1px var(--nob-border)" }}>
            {m === "ml" ? "Moneyline" : m === "spr" ? "Spread" : "Totals"}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: "var(--nob-border-strong)", margin: "0 4px" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Best</span>
        <div
          data-best-view-toggle="true"
          role="group"
          aria-label="Best odds view"
          style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--nob-border-strong)" }}
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
                background: bestView === opt.id ? "rgba(var(--nob-gold-rgb),0.16)" : "var(--nob-chip)",
                color: bestView === opt.id ? "var(--nob-gold)" : "var(--nob-muted)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: "var(--nob-border-strong)", margin: "0 4px" }} />
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
              background: selectedBooks.has(b.key) ? "rgba(var(--nob-gold-rgb),0.10)" : "var(--nob-chip)",
              color: selectedBooks.has(b.key) ? "var(--nob-gold)" : "var(--nob-faint)",
              border: selectedBooks.has(b.key) ? "1px solid rgba(var(--nob-gold-rgb),0.55)" : "1px solid var(--nob-border)",
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
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--nob-border-strong)", background: "var(--nob-chip)", color: "var(--nob-text-2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Reset books
          </button>
        )}
        {(boardOrder.gamesBySlate[slateKey] || []).length > 0 && (
          <button
            type="button"
            data-reset-game-order="true"
            onClick={resetGameOrder}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--nob-border-strong)", background: "var(--nob-chip)", color: "var(--nob-text-2)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
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
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--nob-text-2)" }}>
            {hiddenBoardGames.length} hidden
          </span>
          <span style={{ color: "var(--nob-faint)" }}>·</span>
          <button
            type="button"
            data-show-all-games="true"
            onClick={showAllHiddenGames}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--nob-border-strong)",
              background: "var(--nob-chip)",
              color: "var(--nob-text)",
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
                border: "1px solid var(--nob-border)",
                background: "var(--nob-chip)",
                color: "var(--nob-text-2)",
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

      {missingKey && (
        <div data-betstamp-missing-key="true" style={{ padding: "28px 20px", borderRadius: 12, border: "1px dashed rgba(var(--nob-gold-rgb),0.35)", color: "var(--nob-text)", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Set <code>BETSTAMP_API_KEY</code> to load this board</div>
          <div style={{ fontSize: 13, color: "var(--nob-text-2)", lineHeight: 1.5 }}>
            Add the trial key as a server-only env var in Vercel (Production + Preview + Development) and in local <code>.env.local</code>. Never prefix it with <code>VITE_</code> — this board talks to <code>/api/betstamp-markets</code> only.
          </div>
        </div>
      )}

      {loadError && !missingKey && (
        <div style={{ padding: "20px", borderRadius: 12, border: "1px solid rgba(var(--nob-bad-rgb),0.3)", color: "var(--nob-bad)", marginBottom: 16, fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--nob-faint)", fontSize: 14 }}>Loading Betstamp snapshot…</div>
      )}

      {!loading && (
      <div className="obb-scroll" style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--nob-border)" }}>
        <table className="obb-grid" data-col-layout="fixed" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: tableWidth, minWidth: tableWidth, maxWidth: tableWidth }}>
          <colgroup>
            <col data-obb-col="game" style={{ width: teamColWidth }} />
            {visibleBooks.map((b) => (
              <col key={b.key} data-obb-col={b.key} style={{ width: colWidthFor(b.key) }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ background: "var(--nob-head)", borderBottom: "1px solid var(--nob-border)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, maxWidth: teamColWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--nob-head)", zIndex: 2 }}>Game</th>
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
                  style={{ padding: "12px 6px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "var(--nob-good)" : "var(--nob-muted)", textTransform: "uppercase", letterSpacing: 0.5, width: colWidthFor(b.key), maxWidth: colWidthFor(b.key), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid var(--nob-border)" : "none" }}
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
                <td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "var(--nob-faint)", fontSize: 14 }}>
                  {hiddenBoardGames.length
                    ? "Hidden matchups are listed above — Show all to restore"
                    : missingKey
                      ? "Waiting on BETSTAMP_API_KEY"
                      : `No ${liveOnly ? "live" : ""} games found${search ? ` for "${search}"` : ""}`}
                </td>
              </tr>
            )}
            {grouped.map((block) => (
              <Fragment key={block.dateKey}>
                <tr style={{ background: "var(--nob-warm)", borderBottom: "1px solid var(--nob-divider)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "7px 16px", fontSize: 11, fontWeight: 700, color: "var(--nob-gold)", textTransform: "uppercase", letterSpacing: 0.8 }}>{block.dateKey}</td>
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
      <div style={{ fontSize: 11, color: "var(--nob-faint)", marginTop: 12 }}>
        Betstamp books: DraftKings, FanDuel, Caesars, BetMGM, Fanatics, bet365, BookMaker/BetCris, BetRivers (Kambi), Pinnacle, Bet105, BetOnline, BetUS, Circa, theScore Bet, Hard Rock, then ProphetX / Polymarket / Kalshi. Novig comes from Novig's free public prices (same feed as the New Odds Board, about 9s behind), not Betstamp, and joins games the same way as Underdog. Underdog Predict comes from Underdog's own phone prices (same feed and game matching as the New Odds Board, polled every 20s pregame / 30s LIVE), not Betstamp. Columns with no prices on this slate are hidden, except BetMGM, BetUS and Novig (Betstamp sends BetUS pregame only, no LIVE rows). BetMGM stays blank until the Betstamp key covers it (the server sends book 400 only with BETSTAMP_INCLUDE_BETMGM=1). Bet105 and Hard Rock are not on the current Betstamp key, so they are not requested yet. No Fliff or Courtside
        {" · "}Mains (moneyline / spread / total, period FT), American odds
        {" · "}Refresh: polls the Betstamp REST snapshot (refresh=1) every {Math.round(BETSTAMP_BOARD_PREGAME_POLL_MS / 1000)}s pregame and every {Math.round(BETSTAMP_BOARD_LIVE_POLL_MS / 1000)}s LIVE, paused while this browser tab is hidden. LIVE normally reads the odds relay's shared Betstamp feed (about 2s) and uses this poll only if the relay is down or quiet for 10s. This browser never opens a Betstamp live stream (the trial key allows one connection)
        {" · "}LIVE: a book/side missing from several polls (or an explicit suspend / taken_down) shows OFF. A blank means never offered / no quote. Polymarket and Kalshi also tick from the first-party relays
        {" · "}Click a game for that fixture's full alt ladder (fetched only then)
        {" · "}Kalshi / Polymarket / ProphetX / Novig also show implied win probability
        {" · "}Green = best price in the row across selected books (LIVE: a number older than 60s cannot win Best while the game is moving; 4 minutes at halftime)
        {" · "}Top 2 lines groups the two most popular spread/total points; moneyline stays single
        {" · "}× on a book square hides that cell from Best; × on the Game column hides the matchup (session only)
        {" · "}Prices flash green / red when they move for / against the bettor. $ under a price is size when the feed sends it; muted age is that line's last Betstamp update
        {" · "}⋮⋮ drags a game row or book column; order is saved for this board only
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
              background: "var(--nob-surface)",
              borderLeft: "1px solid var(--nob-border)",
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
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--nob-border-strong)", background: "var(--nob-chip)", color: "var(--nob-text)", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
                >
                  ← Board
                </button>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--nob-text)" }}>
                  {openGame.away} @ {openGame.home}
                </div>
                <div style={{ fontSize: 12, color: "var(--nob-muted)", marginTop: 4 }}>
                  Alternate lines · moneyline / spread / total FT · this fixture only
                </div>
              </div>
            </div>
            {altLoading && !altLadders && (
              <div style={{ padding: "36px 12px", textAlign: "center", color: "var(--nob-muted)", fontSize: 14 }}>Loading alt lines…</div>
            )}
            {altError && (
              <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(var(--nob-bad-rgb),0.3)", color: "var(--nob-bad)", marginBottom: 16, fontSize: 13 }}>
                {altError}
              </div>
            )}
            {altLadders && (
              <>
                {renderAltSection("Moneyline", "ml", altLadders.moneyline ? [{ line: null, ...altLadders.moneyline }] : [], "ml", () => "Moneyline")}
                {renderAltSection("Spreads", "spr", altLadders.spreads, "spr", (row) => `Away ${fmtSignedLine(row.line)}`)}
                {renderAltSection("Totals", "tot", altLadders.totals, "tot", (row) => `Total ${row.line}`)}
                {!altLadders.moneyline && !altLadders.spreads.length && !altLadders.totals.length && (
                  <div style={{ padding: "36px 12px", textAlign: "center", color: "var(--nob-muted)", fontSize: 14 }}>
                    No FT moneyline / spread / total alts for this fixture.
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
