import { useEffect, useMemo, useState } from "react";
import { formatAmericanOdds } from "./trueOddsLine.js";

export const PLAYER_TD_POLL_MS = 45_000;

// Player Props sub-selector. The first entry is the default. Add another
// { id, label } here when a new prop type ships; the table already keys off id.
export const PLAYER_PROP_TYPES = [
  { id: "anytime", label: "Anytime TD" },
];

const BOOKS = [
  { key: "kalshi", label: "Kalshi" },
  { key: "polymarket", label: "Polymarket" },
  { key: "underdog_predict", label: "Underdog" },
];

function cellPrice(row, threshold, book) {
  const slot = row && row[threshold];
  if (!slot) return null;
  const price = slot[book];
  return price == null ? null : price;
}

export function playerTdBestBook(row, threshold) {
  const slot = row && row[threshold];
  if (!slot) return null;
  return slot.bestBook || null;
}

export default function PlayerTdBoard({ search = "", active = true } = {}) {
  const [threshold, setThreshold] = useState(PLAYER_PROP_TYPES[0].id);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/player-td-board");
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body || body.ok === false) {
          setError("Player TD prices are unavailable.");
          setGames([]);
        } else {
          setError("");
          setGames(Array.isArray(body.games) ? body.games : []);
          setFetchedAt(body.fetchedAt || null);
        }
      } catch (_) {
        if (!cancelled) setError("Player TD prices are unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, PLAYER_TD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const needle = String(search || "").trim().toLowerCase();
  const visible = useMemo(() => {
    return (games || []).map((game) => {
      const players = (game.players || []).filter((player) => {
        const slot = player[threshold];
        const hasPrice = slot && (slot.kalshi != null || slot.polymarket != null || slot.underdog_predict != null);
        if (!hasPrice) return false;
        if (!needle) return true;
        const blob = `${player.name} ${game.away} ${game.home} ${player.team || ""}`.toLowerCase();
        return blob.includes(needle);
      });
      return { ...game, players };
    }).filter((game) => game.players.length);
  }, [games, threshold, needle]);

  return (
    <div data-player-td-board="1" data-td-poll-ms={PLAYER_TD_POLL_MS}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label="Prop type" data-prop-type-selector="1">
        {PLAYER_PROP_TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            data-prop-type={item.id}
            aria-pressed={threshold === item.id}
            onClick={() => setThreshold(item.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: threshold === item.id ? "#10b981" : "rgba(255,255,255,0.05)",
              color: threshold === item.id ? "#fff" : "#9ca3af",
            }}
          >
            {item.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: "#6b7280" }} data-td-threshold="anytime">
          Anytime touchdown (1+). Yes prices in American odds for games kicking off within 72 hours. Kalshi and Polymarket include the taker fee.
        </span>
      </div>
      {loading && (
        <div style={{ padding: "28px 12px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>
          Loading player touchdowns…
        </div>
      )}
      {!loading && error && (
        <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !error && visible.length === 0 && (
        <div style={{ padding: "28px 12px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>
          No player touchdown prices{needle ? ` for "${search}"` : ""}.
        </div>
      )}
      {!loading && !error && visible.map((game) => (
        <div key={game.gameKey} data-td-game={game.gameKey} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaed", marginBottom: 8 }}>
            {game.away} @ {game.home}
          </div>
          <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "#6b7280", letterSpacing: 0.6 }}>Player</th>
                  {BOOKS.map((book) => (
                    <th key={book.key} style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#6b7280" }}>{book.label}</th>
                  ))}
                  <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "#10b981" }}>Best</th>
                </tr>
              </thead>
              <tbody>
                {game.players.map((player) => {
                  const bestBook = playerTdBestBook(player, threshold);
                  const best = cellPrice(player, threshold, "best") ?? (player[threshold] && player[threshold].best);
                  return (
                    <tr key={`${game.gameKey}:${player.name}`} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "8px 14px", color: "#e8eaed", fontSize: 13, fontWeight: 650 }}>
                        {player.name}
                        {player.team ? <span style={{ marginLeft: 8, color: "#6b7280", fontWeight: 600 }}>{player.team}</span> : null}
                      </td>
                      {BOOKS.map((book) => {
                        const price = cellPrice(player, threshold, book.key);
                        const highlighted = price != null && book.key === bestBook;
                        return (
                          <td key={book.key} style={{ padding: "8px", textAlign: "center" }}>
                            <span
                              data-td-price={book.key}
                              data-td-best={highlighted ? "1" : "0"}
                              style={{
                                fontVariantNumeric: "tabular-nums",
                                fontWeight: 700,
                                color: highlighted ? "#34d399" : "#e8eaed",
                                background: highlighted ? "rgba(16,185,129,0.16)" : "transparent",
                                borderRadius: 6,
                                padding: "3px 8px",
                              }}
                            >
                              {formatAmericanOdds(price)}
                            </span>
                          </td>
                        );
                      })}
                      <td style={{ padding: "8px", textAlign: "center", color: "#34d399", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                        {formatAmericanOdds(best)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {fetchedAt && (
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>
          Player TD snapshot {fetchedAt}
        </div>
      )}
    </div>
  );
}
