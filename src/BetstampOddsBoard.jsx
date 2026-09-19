import { useEffect, useMemo, useRef, useState } from "react";
import { formatAmericanOdds } from "./trueOddsLine.js";
import {
  fmtBoardSize,
  bookInitials,
  bestBooksTitle,
  formatDateGroup,
  getOddsBoardCell,
  getBestForGame,
  LIVE_BEST_ODDS_MAX_AGE_MS,
  LIVE_BEST_ODDS_BREAK_MAX_AGE_MS,
  oddsBoardHideKey,
  isHiddenOddsCell,
  isStackedBestMatch,
  oddsBoardSidePoint,
} from "./oddsBoard.js";
import {
  BETSTAMP_SPORTS,
  BETSTAMP_DEFAULT_SPORT,
  bookByKey,
  leagueForSport,
  visibleBetstampBooks,
} from "./betstampBooks.js";
import BookLabel from "./BookLabel.jsx";
import {
  gamesFromBetstampSnapshot,
  applyFixtureMeta,
  applyStreamMarkets,
  reconcileLiveGames,
  gameVisibleOnBoard,
  unwrapStreamPayload,
  emptyTickStats,
  recordTicks,
  summarizeTickStats,
  formatCompactAge,
  formatWinProb,
  cellShowsWinProb,
  cellLineFields,
  lineUpdatedAt,
  lineIsSuspended,
  bestLineUpdatedAt,
  fixtureAltLadders,
} from "./betstampNormalize.js";
import {
  betstampSnapshotUrl,
  betstampStreamUrl,
  consumeBetstampStream,
  nextBackoffMs,
  BETSTAMP_PREGAME_POLL_MS,
  BETSTAMP_LIVE_RECONCILE_MS,
} from "./betstampLive.js";

function BookMark({ book, extra = 0, title, size = 13 }) {
  const [logoError, setLogoError] = useState(false);
  if (!book) return null;
  const showLogo = book.logo && !logoError;
  const initials = bookInitials(book.label);
  return (
    <span
      title={title || book.label}
      data-book-mark={book.key}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle", flexShrink: 0 }}
    >
      {showLogo ? (
        <img
          src={book.logo}
          alt=""
          width={size}
          height={size}
          style={{
            borderRadius: 3,
            display: "block",
            objectFit: "contain",
            background: "rgba(255,255,255,0.92)",
          }}
          onError={() => setLogoError(true)}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            borderRadius: 3,
            background: book.bg,
            color: book.color,
            fontSize: Math.max(8, Math.round(size * 0.58)),
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            fontFamily: "'DM Sans', sans-serif",
            letterSpacing: -0.3,
          }}
        >
          {initials}
        </span>
      )}
      {extra > 0 && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>+{extra}</span>
      )}
    </span>
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

function OddsSide({ price, size, line, books, allBooks, showBestMark, updatedAt, nowMs, ageTitle, showWinProb, suspended }) {
  const primary = books?.[0];
  const book = primary ? bookByKey(primary.key) : null;
  const title = bestBooksTitle(books, (k) => bookByKey(k)?.label);
  const age = price == null || suspended ? null : formatCompactAge(updatedAt, nowMs);
  const clock = updatedAt ? fmtClock(updatedAt) : "";
  const winProb = showWinProb && price != null && !suspended ? formatWinProb(price) : null;
  return (
    <>
      {line && !suspended && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{line}</div>}
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, flexWrap: "nowrap" }}>
        <span>{price == null || suspended ? "—" : formatAmericanOdds(price)}</span>
        {showBestMark && price != null && !suspended && book && (
          <BookMark book={book} extra={Math.max(0, (books?.length || 0) - 1)} title={title} />
        )}
        {!suspended && <LiquidityCue size={size} inline />}
      </div>
      {winProb && (
        <div
          data-win-prob={winProb}
          title="Implied win probability"
          style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, marginTop: 1, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.15 }}
        >
          {winProb}
        </div>
      )}
      {suspended && (
        <div
          data-odds-suspended="1"
          title="Betstamp no longer lists this line live"
          style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, marginTop: 2, letterSpacing: 0.3, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.1 }}
        >
          OFF
        </div>
      )}
      {age && (
        <div
          data-line-age={age}
          title={ageTitle || (clock ? `Last update ${clock}` : "Last update")}
          style={{ fontSize: 9, color: "#6b7280", fontWeight: 500, marginTop: 2, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}
        >
          {age}
        </div>
      )}
    </>
  );
}

function boardHideSide(marketKey, which) {
  if (marketKey === "tot") return which === "top" ? "over" : "under";
  return which === "top" ? "away" : "home";
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
      style={{
        ...sideStyle(isBestCol, isBestCell && !hidden, empty),
        ...(last ? { borderBottom: "none" } : {}),
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
        data-odds-price={empty ? "empty" : "set"}
        style={hidden ? { textDecoration: "line-through", opacity: 0.72 } : undefined}
      >
        {children}
      </div>
      {hidden && (
        <div data-odds-hidden-label="true" style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", marginTop: 2, letterSpacing: 0.3, textTransform: "uppercase" }}>
          hidden
        </div>
      )}
    </div>
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

export default function BetstampOddsBoard({ user = null } = {}) {
  const books = useMemo(() => visibleBetstampBooks(user), [user]);
  const bookIds = useMemo(() => books.map((b) => b.id), [books]);
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(() => new Set(books.map((b) => b.key)));
  const [boardSport, setBoardSport] = useState(BETSTAMP_DEFAULT_SPORT);
  const [liveOnly, setLiveOnly] = useState(false); // Pregame default. Never auto-enable LIVE.
  const [games, setGames] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [missingKey, setMissingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [tickStats, setTickStats] = useState(() => emptyTickStats());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [snapshotAt, setSnapshotAt] = useState(null);
  const gamesRef = useRef([]);
  const fetchGen = useRef(0);
  const altCacheRef = useRef(new Map());
  const altFetchGen = useRef(0);
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const [bestView, setBestView] = useState("single"); // default = today's single Best
  const [openGame, setOpenGame] = useState(null);
  const [altLadders, setAltLadders] = useState(null);
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState(null);

  useEffect(() => { gamesRef.current = games; }, [games]);

  useEffect(() => {
    setSelectedBooks(new Set(books.map((b) => b.key)));
  }, [books]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const gen = ++fetchGen.current;
    const league = leagueForSport(boardSport);
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    setMissingKey(false);
    setTickStats(emptyTickStats());
    setSnapshotAt(null);
    setStreamStatus(liveOnly ? "connecting" : "idle");

    const applySnapshot = async ({ showLoading }) => {
      try {
        const res = await fetch(betstampSnapshotUrl({ league, live: liveOnly, bookIds }), {
          signal: ctrl.signal,
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (gen !== fetchGen.current) return false;
        if (body.missingKey || res.status === 503) {
          setMissingKey(true);
          setLoadError(body.error || "BETSTAMP_API_KEY is not set");
          if (showLoading) {
            setGames([]);
            setLoading(false);
          }
          return false;
        }
        if (!res.ok || body.ok === false) {
          if (showLoading) {
            setLoadError(body.error || `Snapshot failed (${res.status})`);
            setGames([]);
            setLoading(false);
          }
          return false;
        }
        const fetchedAt = Date.now();
        const next = gamesFromBetstampSnapshot({
          markets: body.markets,
          fixtures: body.fixtures,
          teams: body.teams,
          nowMs: fetchedAt,
        });
        setGames(next);
        gamesRef.current = next;
        setSnapshotAt(fetchedAt);
        setLoadError(null);
        if (showLoading) setLoading(false);
        return true;
      } catch (err) {
        if (ctrl.signal.aborted || gen !== fetchGen.current) return false;
        if (showLoading) {
          setLoadError(err.message || "Could not load snapshot");
          setLoading(false);
        }
        return false;
      }
    };

    let cancelled = false;
    let attempt = 0;
    let timer;
    let pollTimer;
    let pollInFlight = false;

    // Pregame: always run the interval while liveOnly is false. Do not wait
    // for the first snapshot — a hung first GET must not freeze ages.
    // LIVE: SSE owns prices; REST reconcile (~10s) is availability truth
    // (clear books Betstamp no longer lists) and still refreshes fixture
    // halt/halftime so the 60s Best gate can relax at the break.
    applySnapshot({ showLoading: true });
    if (!liveOnly) {
      pollTimer = setInterval(() => {
        if (pollInFlight || cancelled) return;
        pollInFlight = true;
        applySnapshot({ showLoading: false }).finally(() => { pollInFlight = false; });
      }, BETSTAMP_PREGAME_POLL_MS);
    } else {
      pollTimer = setInterval(() => {
        if (pollInFlight || cancelled) return;
        pollInFlight = true;
        fetch(betstampSnapshotUrl({ league, live: true, bookIds }), {
          signal: ctrl.signal,
          cache: "no-store",
        })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            return { res, body };
          })
          .then(({ res, body }) => {
            if (cancelled || gen !== fetchGen.current) return;
            if (!body || body.ok === false || body.missingKey || (res && !res.ok)) return;
            if (body.markets == null) return;
            const fetchedAt = Date.now();
            const withMeta = applyFixtureMeta(gamesRef.current, body.fixtures || []);
            const next = reconcileLiveGames(withMeta, {
              markets: body.markets,
              fixtures: body.fixtures,
              teams: body.teams,
              nowMs: fetchedAt,
            });
            gamesRef.current = next;
            setGames(next);
            setSnapshotAt(fetchedAt);
          })
          .catch(() => {})
          .finally(() => { pollInFlight = false; });
      }, BETSTAMP_LIVE_RECONCILE_MS);
    }

    const runStream = async () => {
      if (!liveOnly || cancelled) return;
      const streamCtrl = new AbortController();
      const onAbort = () => streamCtrl.abort();
      ctrl.signal.addEventListener("abort", onAbort);
      try {
        await consumeBetstampStream({
          url: betstampStreamUrl({ league, live: true, bookIds }),
          signal: streamCtrl.signal,
          onStatus: (s) => { if (!cancelled && gen === fetchGen.current) setStreamStatus(s); },
          onEvent: (ev) => {
            if (cancelled || gen !== fetchGen.current) return;
            const receivedAt = Date.now();
            const { markets, ingestTs } = unwrapStreamPayload(ev.data);
            if (!markets.length) return;
            const recv = typeof ingestTs === "number" ? ingestTs : receivedAt;
            const { games: next, applied } = applyStreamMarkets(gamesRef.current, markets, {
              receivedAt: recv,
              nowMs: receivedAt,
            });
            if (!applied.length) return;
            gamesRef.current = next;
            setGames(next);
            setTickStats((prev) => recordTicks(prev, applied, { receivedAt: recv }));
          },
        });
      } catch (err) {
        if (cancelled || streamCtrl.signal.aborted) return;
        if (err && err.status === 503) {
          setMissingKey(true);
          setLoadError(err.message || "BETSTAMP_API_KEY is not set");
          setStreamStatus("error");
          return;
        }
        setStreamStatus("reconnect");
      } finally {
        ctrl.signal.removeEventListener("abort", onAbort);
      }
      if (cancelled || !liveOnly) return;
      const wait = nextBackoffMs(attempt);
      attempt += 1;
      timer = setTimeout(runStream, wait);
    };

    if (liveOnly) runStream();

    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
      clearInterval(pollTimer);
    };
  }, [boardSport, liveOnly, bookIds]);

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

  const toggleHiddenCell = (gameId, marketKey, side, bookKey) => {
    const key = oddsBoardHideKey({ gameId, market: marketKey, side, bookKey });
    if (!key) return;
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
    return games.filter((g) => {
      if (g.sport !== boardSport) return false;
      if (!gameVisibleOnBoard(g, { liveOnly, now: nowMs })) return false;
      if (!q) return true;
      return (
        g.away.toLowerCase().includes(q) ||
        g.home.toLowerCase().includes(q) ||
        (g.awayAbbr || "").toLowerCase().includes(q) ||
        (g.homeAbbr || "").toLowerCase().includes(q)
      );
    });
  }, [games, boardSport, liveOnly, search, nowMs]);

  const grouped = {};
  filteredGames.forEach((g) => {
    const dateKey = g.is_live ? "Live now" : formatDateGroup(g.commence_time || Date.now());
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(g);
  });

  const visibleBooks = [{ key: "best", label: "Best Odds" }, ...books.filter((b) => selectedBooks.has(b.key))];
  const teamColWidth = 186;
  const oddsColWidth = 108;
  const metrics = summarizeTickStats(tickStats, nowMs);

  const stackedBest = bestView === "stacked";
  const liveBestOpts = { nowMs, hiddenKeys, stackedBest };

  const getCell = (game, bookKey) => getOddsBoardCell({
    game,
    bookKey,
    market,
    selectedBookKeys: selectedBooks,
    allBooks: books,
    ...liveBestOpts,
  });

  const sideStyle = (isBestCol, isBestCell, empty) => ({
    padding: "7px 5px",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 700,
    color: empty ? "#2d3748" : (isBestCol || isBestCell) ? "#10b981" : "#e8eaed",
    background: isBestCell ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent",
  });

  const isBestHighlight = (rowGame, marketKey, b, cell, which, singleBest, stacks) => {
    if (b.key === "best") return false;
    const price = which === "top" ? cell.top : cell.bot;
    if (price == null) return false;
    if (stackedBest && marketKey !== "ml") {
      return isStackedBestMatch(stacks, price, oddsBoardSidePoint(rowGame, b.key, marketKey, which));
    }
    return price === singleBest;
  };

  const renderStackedSide = (rowGame, field, stack) => (
    <OddsSide
      price={stack?.price ?? null}
      size={stack?.size ?? null}
      line={stack?.lineLabel ?? null}
      books={stack?.books ?? []}
      allBooks={books}
      showBestMark
      showWinProb={cellShowsWinProb("best", stack?.books)}
      updatedAt={bestLineUpdatedAt(rowGame, field, stack?.books)}
      nowMs={nowMs}
      ageTitle="Newest update among books offering this best price"
    />
  );

  const renderPairedPointBlocks = (rowGame, blocks, fields) => {
    if (!blocks?.length) {
      return (
        <div data-best-point-pairs="0" data-best-stacks="0">
          <OddsSide price={null} size={null} line={null} books={[]} allBooks={books} showBestMark nowMs={nowMs} />
        </div>
      );
    }
    return (
      <div data-best-point-pairs={blocks.length} data-best-stacks={blocks.length} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        {blocks.map((block, i) => (
          <div
            key={block.point}
            data-best-point={block.point}
            data-best-point-count={block.count}
            style={i > 0 ? {
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid rgba(16,185,129,0.28)",
              width: "100%",
            } : { width: "100%" }}
          >
            <div data-best-stack={block.top?.line} data-best-stack-price={block.top?.price} data-best-stack-side="top" style={{ width: "100%" }}>
              {renderStackedSide(rowGame, fields.top, block.top)}
            </div>
            <div
              data-best-stack={block.bot?.line}
              data-best-stack-price={block.bot?.price}
              data-best-stack-side="bot"
              style={{
                width: "100%",
                marginTop: 4,
                paddingTop: 4,
                borderTop: "1px solid rgba(16,185,129,0.12)",
              }}
            >
              {renderStackedSide(rowGame, fields.bot, block.bot)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderBookColumn = (rowGame, marketKey, b, cell, bests, { includeLine = true } = {}) => {
    const fields = cellLineFields(marketKey);
    const isBestCol = b.key === "best";
    const topHidden = !isBestCol && isHiddenOddsCell(hiddenKeys, {
      gameId: rowGame.id, market: marketKey, side: boardHideSide(marketKey, "top"), bookKey: b.key,
    });
    const botHidden = !isBestCol && isHiddenOddsCell(hiddenKeys, {
      gameId: rowGame.id, market: marketKey, side: boardHideSide(marketKey, "bot"), bookKey: b.key,
    });
    const isBestAway = !topHidden && isBestHighlight(rowGame, marketKey, b, cell, "top", bests.bestAway, bests.awayStacks);
    const isBestHome = !botHidden && isBestHighlight(rowGame, marketKey, b, cell, "bot", bests.bestHome, bests.homeStacks);
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
      nowMs,
      ageTitle: isBestCol ? "Newest update among books offering this best price" : undefined,
      suspended: !isBestCol && lineIsSuspended(rowGame, b.key, which === "top" ? fields.top : fields.bot),
    });
    if (pairBlocks) {
      const emptyPairs = !cell.pointStacks.length || cell.pointStacks.every((block) => block.top?.price == null && block.bot?.price == null);
      return (
        <td key={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
          <div
            className="obb-side"
            data-odds-side="paired"
            style={{
              ...sideStyle(true, false, emptyPairs),
              borderBottom: "none",
            }}
          >
            {renderPairedPointBlocks(rowGame, cell.pointStacks, fields)}
          </div>
        </td>
      );
    }

    return (
      <td key={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <BookSideCell
            gameId={rowGame.id}
            marketKey={marketKey}
            which="top"
            bookKey={b.key}
            bookLabel={b.label}
            isBestCol={isBestCol}
            isBestCell={isBestAway}
            empty={cell.top === null}
            hidden={topHidden}
            onToggleHide={toggleHiddenCell}
            sideStyle={sideStyle}
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
            last
            hidden={botHidden}
            onToggleHide={toggleHiddenCell}
            sideStyle={sideStyle}
          >
            <OddsSide {...sideProps("bot")} />
          </BookSideCell>
        </div>
      </td>
    );
  };

  const renderOddsPair = (rowGame, marketKey) => {
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
      return renderBookColumn(rowGame, marketKey, b, cell, bests, { includeLine: marketKey === "ml" });
    });
  };

  const renderAltSection = (title, section, rows, marketKey, labelFor) => {
    if (!rows.length) return null;
    return (
      <div data-alt-section={section} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
        <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + visibleBooks.length * oddsColWidth }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#12131a", zIndex: 2 }}>Line</th>
                {visibleBooks.map((b) => (
                  <th key={b.key} data-book-header={b.key} style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                    {b.key === "best" ? b.label : <BookLabel book={b} size={16} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${section}-${row.line ?? "ml"}`} data-alt-line={row.line ?? "ml"} data-alt-main={row.isMain ? "1" : "0"} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: row.isMain ? "rgba(59,130,246,0.04)" : "transparent" }}>
                  <td style={{ padding: "8px 16px", width: teamColWidth, position: "sticky", left: 0, background: row.isMain ? "#101624" : "#0f1016", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>
                    <div>{labelFor(row)}</div>
                    {row.isMain && <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginTop: 3 }}>MAIN</div>}
                    {marketKey === "ml" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, fontWeight: 500 }}>
                        <div>{openGame?.away}</div>
                        <div style={{ marginTop: 4 }}>{openGame?.home}</div>
                      </div>
                    )}
                    {marketKey === "spr" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, fontWeight: 500 }}>
                        <div>{openGame?.awayAbbr || openGame?.away} {fmtSignedLine(row.line)}</div>
                        <div style={{ marginTop: 4 }}>{openGame?.homeAbbr || openGame?.home} {fmtSignedLine(row.line == null ? null : -row.line)}</div>
                      </div>
                    )}
                    {marketKey === "tot" && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, fontWeight: 500 }}>
                        <div>Over {row.line}</div>
                        <div style={{ marginTop: 4 }}>Under {row.line}</div>
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
    <div
      data-betstamp-board="true"
      data-guard-allow="true"
      data-best-view={bestView}
      data-live-best-age-ms={LIVE_BEST_ODDS_MAX_AGE_MS}
      data-live-best-break-age-ms={LIVE_BEST_ODDS_BREAK_MAX_AGE_MS}
      data-live-reconcile-ms={BETSTAMP_LIVE_RECONCILE_MS}
    >
      <style>{`
        .obb-side { position: relative; }
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
        .obb-side:focus-within .obb-hide {
          opacity: 0.4;
          pointer-events: auto;
        }
        .obb-side:hover .obb-hide:hover,
        .obb-side:focus-within .obb-hide:focus {
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
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaed" }}>New Odds Board</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Parallel live feed — the Odds Board tab is unchanged.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        {books.map((b) => (
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
      </div>

      {missingKey && (
        <div data-betstamp-missing-key="true" style={{ padding: "28px 20px", borderRadius: 12, border: "1px dashed rgba(234,179,8,0.35)", color: "#e8eaed", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Set <code>BETSTAMP_API_KEY</code> to load this board</div>
          <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.5 }}>
            Add the trial key as a server-only env var in Vercel (Production + Preview + Development) and in local <code>.env.local</code>. Never prefix it with <code>VITE_</code> — the browser talks to <code>/api/betstamp-markets</code> and <code>/api/betstamp-stream</code> only.
          </div>
        </div>
      )}

      {loadError && !missingKey && (
        <div style={{ padding: "20px", borderRadius: 12, border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", marginBottom: 16, fontSize: 13 }}>
          {loadError}
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>Loading snapshot…</div>
      )}

      {!loading && (
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + visibleBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>Game</th>
              {visibleBooks.map((b) => (
                <th key={b.key} data-book-header={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                  {b.key === "best" ? b.label : <BookLabel book={b} size={16} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(grouped).length === 0 && (
              <tr>
                <td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>
                  {missingKey
                    ? "Waiting on BETSTAMP_API_KEY"
                    : `No ${liveOnly ? "live" : ""} games found${search ? ` for "${search}"` : ""}`}
                </td>
              </tr>
            )}
            {Object.entries(grouped).map(([dateKey, dateGames]) => (
              <>
                <tr key={dateKey + "_h"} style={{ background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>{dateKey}</td>
                </tr>
                {dateGames.map((game) => {
                  const bests = getBestForGame(game, market, selectedBooks, books, liveBestOpts);
                  return (
                    <tr
                      key={game.id}
                      data-fixture={game.id}
                      data-open-alts={openGame?.id === game.id ? "1" : "0"}
                      onClick={() => openAlts(game)}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" }}
                    >
                      <td style={{ padding: 0, width: teamColWidth, position: "sticky", left: 0, background: "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ padding: "8px 16px 4px" }}>
                          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>
                            {game.is_live ? (
                              <span style={{ color: "#34d399", fontWeight: 700 }}>LIVE</span>
                            ) : (
                              new Date(game.commence_time || Date.now()).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }) + " ET"
                            )}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", marginBottom: 6 }}>
                            {game.away}{game.away_score != null ? ` ${game.away_score}` : ""}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>
                            {game.home}{game.home_score != null ? ` ${game.home_score}` : ""}
                          </div>
                          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, margin: "6px 0 4px" }}>Alts →</div>
                        </div>
                      </td>
                      {visibleBooks.map((b) => renderBookColumn(game, market, b, getCell(game, b.key), bests))}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 12 }}>
        Trial books only · mains (moneyline / spread / total, period FT) · decimal odds converted to American
        {" · "}Pregame re-polls the REST snapshot every 20s so line ages stay honest and books that disappeared clear
        {" · "}LIVE uses SSE for ticks plus a 10s REST presence reconcile — cells show — / OFF when Betstamp no longer lists that book/side live (silence alone is not a suspend)
        {" · "}Click a game for that fixture's full alt ladder (fetched only then)
        {" · "}Kalshi / Polymarket / ProphetX / Underdog Predict also show implied win probability (same American → % as the public board)
        {" · "}Green = best available odds across selected books (LIVE: while the game is moving, a number older than 60s cannot win Best; at halftime / intermission the allowance is 4 minutes)}
        {" · "}Best view default is Single (today's juice compare). Top 2 lines groups the two most popular spread/total points (unique books quoting that |point| on either side) and pairs both sides for each point; moneyline stays single}
        {" · "}× on a book square hides that game / market / side from Best (session only; Show to unhide)}
        {" · "}Live mode is SSE after one REST snapshot — last-tick age and p50/p95 inter-arrival prove the ~400ms claim. Availability comes from the reconcile snapshot, not from SSE silence
        {" · "}$ under a price is that book's size / limit when the feed sends it
        {" · "}muted age under a price is that line's last update (Best = newest contributing book)}
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
                  Alternate lines · moneyline / spread / total FT · this fixture only
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
                    No FT moneyline / spread / total alts for this fixture.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
