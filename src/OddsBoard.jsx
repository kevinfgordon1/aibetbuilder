import { useState } from "react";
import { formatAmericanOdds } from "./trueOddsLine.js";
import { isSoccerSport } from "./soccerPairing.js";
import { boardSportMatches, isSoccerChipId } from "./sportChips.js";
import {
  fmtBoardSize,
  bookInitials,
  bestBooksTitle,
  formatDateGroup,
  getOddsBoardCell,
  getBestForGame,
  pickBestFromPriceMap,
} from "./oddsBoard.js";

function impliedProb(odds) {
  if (!odds) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function bookByKey(books, key) {
  return (books || []).find((b) => b.key === key) || null;
}

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
          style={{ borderRadius: 2, display: "block" }}
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

function LiquidityCue({ size }) {
  const label = fmtBoardSize(size);
  if (!label) return null;
  return (
    <div data-liq={label} style={{ fontSize: 9, color: "#6b7280", fontWeight: 500, marginTop: 1, lineHeight: 1.15 }}>
      {label}
    </div>
  );
}

function OddsSide({
  price,
  size,
  line,
  noPrice,
  noSize,
  books,
  allBooks,
  showBestMark,
}) {
  const primary = books?.[0];
  const book = primary ? bookByKey(allBooks, primary.key) : null;
  const title = bestBooksTitle(books, (k) => bookByKey(allBooks, k)?.label);
  return (
    <>
      {line && <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 500, marginBottom: 1 }}>{line}</div>}
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, flexWrap: "nowrap" }}>
        <span>{price == null ? "—" : formatAmericanOdds(price)}</span>
        {showBestMark && price != null && book && (
          <BookMark book={book} extra={Math.max(0, (books?.length || 0) - 1)} title={title} />
        )}
      </div>
      <LiquidityCue size={size} />
      {noPrice != null && (
        <>
          <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
            NO {formatAmericanOdds(noPrice)}
          </div>
          <LiquidityCue size={noSize} />
        </>
      )}
    </>
  );
}

export default function OddsBoard({ oddsData, futuresData, books, sportChips, futures }) {
  const [market, setMarket] = useState("ml");
  const [search, setSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(() => new Set((books || []).map((b) => b.key)));
  const [boardSport, setBoardSport] = useState("baseball_mlb");
  const now = new Date();
  const allBooks = books || [];

  const games = (oddsData.moneylines || []).filter((g) =>
    boardSportMatches(g.sport, boardSport) && new Date(g.commence_time) > now
  );

  const filteredGames = games.filter((g) => {
    const q = search.toLowerCase();
    return g.away.toLowerCase().includes(q) || g.home.toLowerCase().includes(q);
  });

  const grouped = {};
  filteredGames.forEach((g) => {
    const dateKey = formatDateGroup(g.commence_time);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(g);
  });

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

  const getCell = (game, bookKey) => getOddsBoardCell({
    game,
    bookKey,
    market,
    selectedBookKeys: selectedBooks,
    allBooks,
  });

  const visibleBooks = [{ key: "best", label: "Best Odds" }, ...allBooks.filter((b) => selectedBooks.has(b.key))];
  const teamColWidth = 170;
  const oddsColWidth = 92;

  const champMeta = (futures || []).find((f) => boardSportMatches(f.sport, boardSport));
  const champEntry = (futuresData || []).find((f) => f.key === champMeta?.key);
  const champBooks = [{ key: "best", label: "Best Odds" }, ...allBooks.filter((b) => selectedBooks.has(b.key))];
  const champTeams = (champEntry?.teams || [])
    .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    .map((t) => {
      const yes = pickBestFromPriceMap(t.books, t.bookSizes, selectedBooks, allBooks);
      const no = pickBestFromPriceMap(t.noBooks, t.noBookSizes, selectedBooks, allBooks);
      return {
        ...t,
        best: yes.price,
        bestBook: yes.primaryKey,
        bestBooks: yes.books,
        bestSize: yes.size,
        noBest: no.price,
        noBestBook: no.primaryKey,
        noBestBooks: no.books,
        noBestSize: no.size,
        hasNo: no.price !== null,
      };
    })
    .filter((t) => t.best !== null || t.hasNo)
    .sort((a, b) => impliedProb(b.best) - impliedProb(a.best));

  const champRow = (key, name, isNo, priceMap, rowBest, hideNameBorder, sizeMap, bestBooks, bestSize) => (
    <tr key={key} style={{ background: isNo ? "rgba(239,68,68,0.05)" : "transparent" }}>
      <td style={{ padding: "10px 16px", width: teamColWidth, position: "sticky", left: 0, background: isNo ? "#0f0a0b" : "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: hideNameBorder ? "none" : "1px solid rgba(255,255,255,0.03)", fontSize: 13, fontWeight: 600, color: isNo ? "#9ca3af" : "#e8eaed" }}>
        {name}{isNo && <span style={{ color: "#ef4444", fontWeight: 700, marginLeft: 8, fontSize: 11 }}>NO</span>}
      </td>
      {champBooks.map((b) => {
        const price = b.key === "best" ? rowBest : priceMap?.[b.key];
        const size = b.key === "best" ? bestSize : sizeMap?.[b.key];
        const isBestCol = b.key === "best";
        const isBestCell = b.key !== "best" && price != null && price === rowBest;
        const markBooks = isBestCol ? (bestBooks || []) : [];
        return (
          <td key={b.key} style={{ padding: "10px 6px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.03)", color: price == null ? "#2d3748" : (isBestCol || isBestCell) ? "#10b981" : "#e8eaed", background: isBestCell ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
            <OddsSide
              price={price}
              size={size}
              books={markBooks}
              allBooks={allBooks}
              showBestMark={isBestCol}
            />
          </td>
        );
      })}
    </tr>
  );

  const sideStyle = (isBestCol, isBestCell, empty) => ({
    padding: "7px 5px",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 700,
    color: empty ? "#2d3748" : (isBestCol || isBestCell) ? "#10b981" : "#e8eaed",
    background: isBestCell ? "rgba(16,185,129,0.08)" : isBestCol ? "rgba(16,185,129,0.04)" : "transparent",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(sportChips || []).map((s) => (
          <button key={s.id} onClick={() => setBoardSport(s.id)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: boardSport === s.id ? "#3b82f6" : "rgba(255,255,255,0.05)", color: boardSport === s.id ? "#fff" : "#6b7280" }}>
            {s.label}
          </button>
        ))}
      </div>
      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search team or matchup..." style={{ width: "100%", maxWidth: 400, background: "#12131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8eaed", padding: "10px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["ml", "spr", "tot", "champ"].map((m) => (
          <button key={m} onClick={() => setMarket(m)} style={{ padding: "6px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: market === m ? "#3b82f6" : "rgba(255,255,255,0.05)", color: market === m ? "#fff" : "#6b7280" }}>
            {m === "ml" ? "Moneyline" : m === "spr" ? "Spread" : m === "tot" ? "Totals" : "Championship"}
          </button>
        ))}
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        {allBooks.map((b) => (
          <button key={b.key} onClick={() => toggleBook(b.key)} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: selectedBooks.has(b.key) ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", color: selectedBooks.has(b.key) ? "#3b82f6" : "#4b5563", border: selectedBooks.has(b.key) ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>
            {b.label}
          </button>
        ))}
      </div>
      {market === "champ" && (
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + champBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>{champMeta?.label || "Champion"}</th>
              {champBooks.map((b) => (
                <th key={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {champTeams.length === 0 && (
              <tr><td colSpan={champBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>No championship odds posted yet{search ? ` for "${search}"` : ""}.</td></tr>
            )}
            {champTeams.flatMap((t, ti) => {
              const rows = [];
              if (t.best !== null) rows.push(champRow(`${ti}-yes`, t.name, false, t.books, t.best, t.hasNo, t.bookSizes, t.bestBooks, t.bestSize));
              if (t.hasNo) rows.push(champRow(`${ti}-no`, t.name, true, t.noBooks, t.noBest, false, t.noBookSizes, t.noBestBooks, t.noBestSize));
              return rows;
            })}
          </tbody>
        </table>
      </div>
      )}
      {market !== "champ" && (
      <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: teamColWidth + visibleBooks.length * oddsColWidth }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, width: teamColWidth, position: "sticky", left: 0, background: "#0d0e14", zIndex: 2 }}>Game</th>
              {visibleBooks.map((b) => (
                <th key={b.key} style={{ padding: "12px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: b.key === "best" ? "#10b981" : "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, width: oddsColWidth, whiteSpace: "nowrap", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(grouped).length === 0 && (
              <tr><td colSpan={visibleBooks.length + 1} style={{ padding: "40px", textAlign: "center", color: "#4b5563", fontSize: 14 }}>No games found{search ? ` for "${search}"` : ""}</td></tr>
            )}
            {Object.entries(grouped).map(([dateKey, dateGames]) => (
              <>
                <tr key={dateKey + "_h"} style={{ background: "rgba(59,130,246,0.06)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td colSpan={visibleBooks.length + 1} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "#3b82f6" }}>{dateKey}</td>
                </tr>
                {dateGames.map((game, gi) => {
                  const { bestAway, bestHome, bestDraw } = getBestForGame(game, market, selectedBooks, allBooks);
                  const threeWay = !!(game.is_three_way || isSoccerSport(game.sport));
                  return (
                    <tr key={gi} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: 0, width: teamColWidth, position: "sticky", left: 0, background: "#0a0b0f", zIndex: 1, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ padding: "8px 16px 4px" }}>
                          <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>{new Date(game.commence_time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })} ET</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed", marginBottom: 6 }}>{game.away}</div>
                          {threeWay && market === "ml" && <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 6 }}>Draw</div>}
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaed" }}>{game.home}</div>
                        </div>
                      </td>
                      {visibleBooks.map((b) => {
                        const cell = getCell(game, b.key);
                        const isBestAway = b.key !== "best" && cell.top !== null && cell.top === bestAway;
                        const isBestDraw = b.key !== "best" && cell.mid != null && cell.mid === bestDraw;
                        const isBestHome = b.key !== "best" && cell.bot !== null && cell.bot === bestHome;
                        const isBestCol = b.key === "best";
                        const showNo = market === "ml" && cell.threeWay;
                        return (
                          <td key={b.key} style={{ padding: 0, textAlign: "center", verticalAlign: "middle", borderLeft: b.key === "draftkings" ? "2px solid rgba(255,255,255,0.08)" : "none" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <div style={sideStyle(isBestCol, isBestAway, cell.top === null)}>
                                <OddsSide
                                  price={cell.top}
                                  size={cell.topSize}
                                  line={cell.topLine}
                                  noPrice={showNo ? cell.topNo : null}
                                  noSize={showNo ? cell.topNoSize : null}
                                  books={cell.topBooks}
                                  allBooks={allBooks}
                                  showBestMark={isBestCol}
                                />
                              </div>
                              {threeWay && market === "ml" && (
                                <div style={sideStyle(isBestCol, isBestDraw, cell.mid == null)}>
                                  <OddsSide
                                    price={cell.mid}
                                    size={cell.midSize}
                                    noPrice={showNo ? cell.midNo : null}
                                    noSize={showNo ? cell.midNoSize : null}
                                    books={cell.midBooks}
                                    allBooks={allBooks}
                                    showBestMark={isBestCol}
                                  />
                                </div>
                              )}
                              <div style={{ ...sideStyle(isBestCol, isBestHome, cell.bot === null), borderBottom: "none" }}>
                                <OddsSide
                                  price={cell.bot}
                                  size={cell.botSize}
                                  line={cell.botLine}
                                  noPrice={showNo ? cell.botNo : null}
                                  noSize={showNo ? cell.botNoSize : null}
                                  books={cell.botBooks}
                                  allBooks={allBooks}
                                  showBestMark={isBestCol}
                                />
                              </div>
                            </div>
                          </td>
                        );
                      })}
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
        ✅ Green = best available odds across selected books
        {market === "champ"
          ? " · top row = price to win the title (Yes); red NO row = exchange lay/\"won't win\" side"
          : isSoccerChipId(boardSport) && market === "ml"
            ? " · soccer is 3-way (home / draw / away); red NO = same-binary No (Kalshi / Poly / Novig / ProphetX; exchange lay last resort)"
            : " for that side"}
        {" · Best column shows the winning book's logo (hover for name; +N if tied)"}
        {" · $ under a price is that book's top-of-book size / bet limit when the cache has it"}
      </div>
    </div>
  );
}
