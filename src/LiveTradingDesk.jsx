// Private Live Trading Desk. Owner gate is canSeeOwnerTools (Kevin), same as
// Miss tape / Unhedged — not the Underdog allowlist. The API checks again.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import { MAX_SIZE_DOLLARS, DEFAULT_SIZE_DOLLARS, deskErrorText, quoteRestingOrder } from "./liveDeskPrice";
import { DESK_MARKET_TYPES, classifyDeskMarket, fallbackGameLabel, moneylineSlugForGame } from "./liveDeskGames";
import { DEFAULT_PROTECT_X_CENTS, DEFAULT_PROTECT_Y_CENTS, parseProtectCents } from "./liveDeskProtect";

let supabaseClient = null;
function supabase() {
  if (supabaseClient) return supabaseClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

async function authHeaders() {
  const client = supabase();
  if (!client) return null;
  const { data: { session } } = await client.auth.getSession();
  const token = session && session.access_token;
  if (!token) return null;
  return {
    accept: "application/json",
    authorization: "Bearer " + token,
  };
}

function plain(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  return sign + "$" + Math.abs(v).toFixed(2);
}

function whenLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function stateLabel(state) {
  return String(state || "").replace(/^ORDER_STATE_/, "").replace(/^TRADE_STATE_/, "").replace(/_/g, " ").toLowerCase();
}

const card = {
  background: "#12131a",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 16,
};

const label = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "#9ca3af",
  marginBottom: 6,
};

const field = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0a0b0f",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#f8fafc",
  padding: "10px 12px",
  fontSize: 18,
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 700,
};

const pick = {
  width: "100%",
  boxSizing: "border-box",
  background: "#12141a",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#e8eaed",
  padding: "9px 10px",
  fontSize: 13,
  fontWeight: 600,
};

class DeskErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: "8px 0 24px" }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Live Trading Desk</div>
        <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "#fecaca", fontSize: 13 }}>
          {deskErrorText(this.state.error, "The desk hit a display error.")}
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{ marginTop: 12, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, color: "#93c5fd", padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >Try again</button>
      </div>
    );
  }
}

function Chip({ on, children, onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        background: on ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
        border: on ? "1px solid rgba(59,130,246,0.55)" : "1px solid rgba(255,255,255,0.1)",
        color: on ? "#e0f2fe" : "#d1d5db",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >{children}</button>
  );
}

function LiveTradingDeskView({ user }) {
  const [board, setBoard] = useState(null);
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [gameId, setGameId] = useState("");
  const [marketType, setMarketType] = useState("moneyline");
  const [scopeNote, setScopeNote] = useState("");
  const [outcome, setOutcome] = useState("long");
  const [action, setAction] = useState("buy");
  const [american, setAmerican] = useState("");
  const [dollars, setDollars] = useState(String(DEFAULT_SIZE_DOLLARS));
  const [protect, setProtect] = useState(false);
  const [protectX, setProtectX] = useState(String(DEFAULT_PROTECT_X_CENTS));
  const [protectY, setProtectY] = useState(String(DEFAULT_PROTECT_Y_CENTS));
  const [armedTicket, setArmedTicket] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelId, setCancelId] = useState("");
  const slugRef = useRef("");
  const seq = useRef(0);

  const market = board && board.market && board.market.slug === slug ? board.market : null;

  const quote = useMemo(() => {
    if (!market) return null;
    try {
      return quoteRestingOrder({
        american,
        outcome,
        action,
        tick: market.tick,
        dollars,
        minQty: market.minQty,
      });
    } catch (err) {
      return { ok: false, error: deskErrorText(err, "Could not price that order.") };
    }
  }, [market, american, outcome, action, dollars]);

  const protectXParsed = useMemo(
    () => parseProtectCents(protectX, DEFAULT_PROTECT_X_CENTS, { min: 0.1 }),
    [protectX],
  );
  const protectYParsed = useMemo(
    () => parseProtectCents(protectY, DEFAULT_PROTECT_Y_CENTS, { min: 0 }),
    [protectY],
  );
  const ticketKey = quote && quote.ok && market
    ? [market.slug, outcome, action, quote.yesPriceValue, quote.contracts, quote.riskLabel, protect ? "on" : "off"].join("|")
    : "";
  const confirmed = !!(ticketKey && armedTicket === ticketKey);

  useEffect(() => {
    setArmedTicket("");
  }, [american, dollars, outcome, action, slug, protect]);

  async function load(nextSlug, { silent } = {}) {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) {
        if (id === seq.current) {
          setError("Sign in required.");
          setLoading(false);
        }
        return;
      }
      const q = nextSlug ? "?slug=" + encodeURIComponent(nextSlug) : "";
      const res = await fetch("/api/live-trading-desk" + q, { headers });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (id !== seq.current) return;
      if (!res.ok || !data || data.ok === false) {
        setError(deskErrorText(data && data.error, "Could not load the desk (" + res.status + ")."));
        setLoading(false);
        return;
      }
      setBoard(data);
      setError("");
      setLoading(false);
    } catch (err) {
      if (id !== seq.current) return;
      setError(String(err && err.message || err));
      setLoading(false);
    }
  }

  useEffect(() => {
    slugRef.current = slug;
  }, [slug]);

  useEffect(() => {
    if (!canSeeOwnerTools(user)) return undefined;
    load(slugRef.current);
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load(slugRef.current, { silent: true });
    }, 12000);
    return () => clearInterval(timer);
  }, [user]);

  function applyMoneyline(nextSlug, { outcomeSide, hedge } = {}) {
    const classified = classifyDeskMarket(nextSlug);
    if (!classified.ok) {
      setScopeNote(classified.message || "Pick an NFL game moneyline.");
      return;
    }
    setGameId(classified.gameId);
    setMarketType("moneyline");
    setScopeNote("");
    setNotice("");
    setSlug(classified.slug);
    setSlugDraft(classified.slug);
    if (outcomeSide) setOutcome(outcomeSide === "short" ? "short" : "long");
    if (hedge) setAction("sell");
    load(classified.slug, { silent: true });
  }

  function selectPosition(row) {
    const next = row && typeof row.slug === "string" ? row.slug : "";
    const classified = classifyDeskMarket(next);
    if (!classified.ok) {
      setScopeNote(classified.message);
      return;
    }
    applyMoneyline(classified.slug, { outcomeSide: row.side, hedge: true });
  }

  function selectGame(nextId) {
    const id = String(nextId || "");
    setGameId(id);
    setMarketType("moneyline");
    setScopeNote("");
    setNotice("");
    if (!id) {
      setSlug("");
      setSlugDraft("");
      load("", { silent: true });
      return;
    }
    const game = games.find((g) => g && g.id === id);
    const fromGame = game && Array.isArray(game.markets)
      ? game.markets.find((m) => m && m.id === "moneyline" && typeof m.slug === "string")
      : null;
    const next = (fromGame && fromGame.slug) || moneylineSlugForGame(id);
    if (!next) {
      setSlug("");
      setSlugDraft("");
      setScopeNote("That game has no Polymarket US moneyline on this slate.");
      load("", { silent: true });
      return;
    }
    setSlug(next);
    setSlugDraft(next);
    load(next, { silent: true });
  }

  function selectMarketType(nextType) {
    const typeId = String(nextType || "");
    setMarketType(typeId);
    setNotice("");
    if (typeId === "moneyline" && gameId) {
      selectGame(gameId);
      return;
    }
    setSlug("");
    setSlugDraft("");
    setScopeNote(typeId === "moneyline"
      ? "Pick an NFL game first."
      : "Only Moneyline can be rested on this desk right now.");
    load("", { silent: true });
  }

  function loadDraft(e) {
    if (e) e.preventDefault();
    const next = slugDraft.trim();
    const classified = classifyDeskMarket(next);
    if (!classified.ok) {
      setScopeNote(classified.message || "Enter an NFL full-game moneyline slug.");
      return;
    }
    applyMoneyline(classified.slug);
  }

  async function submit(e) {
    e.preventDefault();
    if (!market || !quote || !quote.ok || busy) return;
    if (armedTicket !== ticketKey) {
      setArmedTicket(ticketKey);
      setNotice("");
      setError("");
      return;
    }
    if (marketType !== "moneyline" || market.slug !== moneylineSlugForGame(gameId)) {
      setScopeNote("Pick the NFL game moneyline before resting.");
      return;
    }
    setBusy("place");
    setNotice("");
    setError("");
    try {
      const headers = await authHeaders();
      if (!headers) {
        setError("Sign in required.");
        return;
      }
      const res = await fetch("/api/live-trading-desk", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          op: "place",
          marketSlug: market.slug,
          gameId,
          outcome,
          action,
          american,
          dollars: Number(dollars),
          protect,
          protectXCents: protect ? protectXParsed.cents : undefined,
          protectYCents: protect ? protectYParsed.cents : undefined,
        }),
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok || !data || data.ok === false) {
        setError(deskErrorText(data && data.error, "Order was not accepted (" + res.status + ")."));
        return;
      }
      const snap = data.snap || {};
      const protectSnap = snap.protect;
      setNotice(
        "Rested " + (snap.action || action) + " " + (snap.outcomeName || "")
        + " at " + (snap.americanLabel || "")
        + (snap.contracts != null ? " · " + snap.contracts + " contracts" : "")
        + (snap.riskLabel ? " · " + snap.riskLabel + " at risk" : "")
        + (protectSnap && protectSnap.on
          ? ". Protect on (more than " + protectSnap.xCents + "¢ through, re-rest " + protectSnap.yCents + "¢ better)"
          : ".")
      );
      await load(market.slug, { silent: true });
    } catch (err) {
      setError(String(err && err.message || err));
    } finally {
      setBusy("");
    }
  }

  async function cancel(order) {
    if (cancelId !== order.id) {
      setCancelId(order.id);
      return;
    }
    setBusy("cancel:" + order.id);
    setError("");
    try {
      const headers = await authHeaders();
      if (!headers) {
        setError("Sign in required.");
        return;
      }
      const res = await fetch("/api/live-trading-desk", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ op: "cancel", orderId: order.id, marketSlug: order.marketSlug }),
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok || !data || data.ok === false) {
        setError(deskErrorText(data && data.error, "Cancel failed (" + res.status + ")."));
        return;
      }
      setCancelId("");
      setNotice("Cancel sent for " + (order.outcomeName || "order") + " " + (order.americanLabel || "") + ".");
      await load(slugRef.current, { silent: true });
    } catch (err) {
      setError(String(err && err.message || err));
    } finally {
      setBusy("");
    }
  }

  if (!canSeeOwnerTools(user)) return null;

  const positions = Array.isArray(board && board.positions) ? board.positions : [];
  const orders = Array.isArray(board && board.orders) ? board.orders : [];
  const activity = Array.isArray(board && board.activity) ? board.activity : [];
  const games = Array.isArray(board && board.games)
    ? board.games.filter((g) => g && typeof g === "object" && typeof g.id === "string")
    : [];
  const marketTypes = (() => {
    const raw = board && board.marketTypes;
    const list = Array.isArray(raw)
      ? raw.filter((t) => t && typeof t.id === "string" && typeof t.label === "string")
      : [];
    return list.length ? list : DESK_MARKET_TYPES;
  })();
  const expectedSlug = gameId ? moneylineSlugForGame(gameId) : "";
  const scoped = !!(market && expectedSlug && market.slug === expectedSlug && marketType === "moneyline");
  const protectReady = !protect || (protectXParsed.ok && protectYParsed.ok);
  const gamesBad = !!(board && board.games != null && !Array.isArray(board.games));
  const boardShapeError = board && (
    !Array.isArray(board.positions) || !Array.isArray(board.orders) || !Array.isArray(board.activity) || gamesBad
  ) ? "The desk returned an unexpected board." : "";
  const outcomeName = market ? plain(outcome === "short" ? market.shortName : market.longName, "") : "";
  const canSubmit = !!(scoped && market.tradable && quote && quote.ok && protectReady && !busy);
  const knownGame = games.some((g) => g.id === gameId);
  const slateNote = board && typeof board.gamesError === "string" ? board.gamesError : "";

  return (
    <div>
      <style>{`
        .desk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .desk-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        .desk-picks { display: grid; grid-template-columns: 1.5fr 0.7fr; gap: 8px; margin-top: 12; }
        @media (max-width: 900px) {
          .desk-grid { grid-template-columns: 1fr; }
          .desk-picks { grid-template-columns: 1fr; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Live Trading Desk</div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>
            Polymarket US only. Small resting limits against your open positions. Kalshi is not on this desk.
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(slug, { silent: !!board })}
          style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, color: "#93c5fd", padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >Refresh</button>
      </div>

      {(error || boardShapeError) && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "#fecaca", fontSize: 13 }}>{deskErrorText(error || boardShapeError)}</div>
      )}
      {notice && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.35)", color: "#a7f3d0", fontSize: 13 }}>{notice}</div>
      )}

      <div className="desk-grid">
        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Open positions</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Every Polymarket US position stays listed. Click an NFL moneyline to hedge that game. A spread, total, or other board will not load.</div>
          {loading && !board && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 14 }}>Loading Polymarket US…</div>}
          {!loading && positions.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 14 }}>No open Polymarket US positions.</div>}
          <div className="desk-list">
            {positions.filter((row) => row && typeof row === "object").map((row, index) => {
              const on = row.slug === slug;
              const rowKey = typeof row.slug === "string" && row.slug ? row.slug : "pos-" + index;
              return (
                <button
                  key={rowKey}
                  type="button"
                  onClick={() => selectPosition(row)}
                  style={{
                    textAlign: "left",
                    background: on ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                    border: on ? "1px solid rgba(59,130,246,0.45)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: "#e8eaed",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{plain(row.title, "Position")}</div>
                  <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 4 }}>
                    {(row.side === "short" ? "Short " : "Long ") + plain(row.team, row.side === "short" ? "No" : "Yes")}
                    {" · "}
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{plain(row.net, "—")}</span>
                    {row.cost != null ? " · cost " + money(row.cost) : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Rest a limit</div>
          <div className="desk-picks">
            <div>
              <label style={label} htmlFor="desk-game">Game</label>
              <select id="desk-game" aria-label="NFL game" value={gameId} onChange={(e) => selectGame(e.target.value)} style={pick}>
                <option value="">— NFL game —</option>
                {gameId && !knownGame && <option value={gameId}>{fallbackGameLabel(gameId)}</option>}
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{plain(g.label, fallbackGameLabel(g.id))}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label} htmlFor="desk-market">Market</label>
              <select
                id="desk-market"
                aria-label="Market"
                value={marketTypes.some((t) => t.id === marketType) ? marketType : "moneyline"}
                disabled={!gameId || marketTypes.length < 2}
                title="Moneyline only for now. Spreads and totals can be added on this same control."
                onChange={(e) => selectMarketType(e.target.value)}
                style={{ ...pick, opacity: (!gameId || marketTypes.length < 2) ? 0.7 : 1 }}
              >
                {marketTypes.map((t) => (
                  <option key={t.id} value={t.id}>{plain(t.label, t.id)}</option>
                ))}
              </select>
            </div>
          </div>
          {(scopeNote || slateNote) && (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", color: "#fcd34d", fontSize: 13 }}>
              {deskErrorText(scopeNote || slateNote, "Pick an NFL game.")}
            </div>
          )}
          <form onSubmit={loadDraft} style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={label} htmlFor="desk-slug">Advanced slug</label>
              <input
                id="desk-slug"
                aria-label="Market slug"
                value={slugDraft}
                onChange={(e) => setSlugDraft(e.target.value)}
                placeholder="NFL moneyline slug"
                style={{ ...field, fontSize: 13, fontWeight: 600 }}
              />
            </div>
            <button type="submit" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e5e7eb", borderRadius: 8, padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>Load</button>
          </form>
          {market && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#cbd5e1" }}>
              <div style={{ fontWeight: 700, color: "#f8fafc" }}>{plain(market.title, market.slug || "Market")}</div>
              <div style={{ marginTop: 4 }}>Yes {plain(market.longName, "Yes")} · No {plain(market.shortName, "No")} · tick {plain(market.tick, "—")}</div>
              {!market.tradable && <div style={{ color: "#fbbf24", marginTop: 4 }}>This market is not open.</div>}
            </div>
          )}

          <form onSubmit={submit} style={{ marginTop: 14 }}>
            <div style={label}>Side</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip on={outcome === "long"} disabled={!market} onClick={() => setOutcome("long")}>{market ? plain(market.longName, "Yes") : "Yes"}</Chip>
              <Chip on={outcome === "short"} disabled={!market} onClick={() => setOutcome("short")}>{market ? plain(market.shortName, "No") : "No"}</Chip>
              <Chip on={action === "buy"} disabled={!market} onClick={() => setAction("buy")}>Buy</Chip>
              <Chip on={action === "sell"} disabled={!market} onClick={() => setAction("sell")}>Sell</Chip>
            </div>

            <label style={{ ...label, marginTop: 14 }} htmlFor="desk-american">American odds</label>
            <input
              id="desk-american"
              inputMode="text"
              autoComplete="off"
              name="desk-american"
              placeholder="−150"
              value={american}
              onChange={(e) => setAmerican(e.target.value)}
              style={field}
            />

            <label style={{ ...label, marginTop: 14 }} htmlFor="desk-size">Size in dollars</label>
            <input
              id="desk-size"
              type="number"
              min="1"
              max={MAX_SIZE_DOLLARS}
              step="1"
              autoComplete="off"
              name="desk-dollars"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              style={field}
            />
            <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8, lineHeight: 1.45 }}>
              Small size, trial only. Hard cap ${MAX_SIZE_DOLLARS} so a fat-finger cannot rest a large order. Default ${DEFAULT_SIZE_DOLLARS}. Dollars are the most you can lose if this fills and settles against you.
            </div>

            <label htmlFor="desk-protect" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
              <input
                id="desk-protect"
                type="checkbox"
                checked={protect}
                onChange={(e) => setProtect(e.target.checked)}
              />
              Protect <span style={{ fontWeight: 600, color: "#9ca3af" }}>(adverse pickoff)</span>
            </label>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, lineHeight: 1.45 }}>
              Off unless you arm this rest. Cancel if mid blows through your rest, then re-rest better. Does not chase if the market runs away.
            </div>
            {protect && (
              <details open style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, color: "#cbd5e1", fontWeight: 700 }}>
                  {(protectXParsed.ok ? protectXParsed.cents : protectX) + "¢ through mid · re-rest " + (protectYParsed.ok ? protectYParsed.cents : protectY) + "¢ better"}
                </summary>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div>
                    <label style={label} htmlFor="desk-protect-x">Through mid (¢)</label>
                    <input
                      id="desk-protect-x"
                      type="number"
                      min="0.1"
                      max="25"
                      step="0.1"
                      value={protectX}
                      onChange={(e) => setProtectX(e.target.value)}
                      style={{ ...field, fontSize: 16 }}
                    />
                  </div>
                  <div>
                    <label style={label} htmlFor="desk-protect-y">Re-rest better (¢)</label>
                    <input
                      id="desk-protect-y"
                      type="number"
                      min="0"
                      max="25"
                      step="0.1"
                      value={protectY}
                      onChange={(e) => setProtectY(e.target.value)}
                      style={{ ...field, fontSize: 16 }}
                    />
                  </div>
                </div>
              </details>
            )}

            <div style={{ marginTop: 14, padding: "12px 12px", borderRadius: 10, background: "#0a0b0f", border: "1px solid rgba(255,255,255,0.08)", minHeight: 64 }}>
              {!market && <div style={{ color: "#9ca3af", fontSize: 13 }}>Pick an NFL game. The rest uses that game’s moneyline.</div>}
              {market && !String(american).trim() && (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>Type American odds. The desk snaps to the Polymarket tick in your favor and shows that price before you rest it.</div>
              )}
              {market && String(american).trim() && quote && !quote.ok && (
                <div style={{ color: "#fecaca", fontSize: 13 }}>{deskErrorText(quote.error, "That price cannot be rested.")}</div>
              )}
              {market && protect && (!protectXParsed.ok || !protectYParsed.ok) && (
                <div style={{ color: "#fecaca", fontSize: 13, marginBottom: 8 }}>{deskErrorText((protectXParsed.ok ? protectYParsed : protectXParsed).error, "Check the Protect cushion.")}</div>
              )}
              {market && quote && quote.ok && (
                <div id="desk-order-readback">
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: confirmed ? "#93c5fd" : "#9ca3af" }}>
                    {confirmed ? "Sending this order" : "Order that will be sent"}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 800, marginTop: 8 }}>
                    {action === "buy" ? "Buy" : "Sell"} {outcomeName}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "4px 10px", marginTop: 8, fontSize: 13, color: "#e5e7eb" }}>
                    <div style={{ color: "#9ca3af" }}>American</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{plain(quote.snappedAmericanLabel, "")}</div>
                    <div style={{ color: "#9ca3af" }}>Cents</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{plain(quote.centsLabel, "")}</div>
                    <div style={{ color: "#9ca3af" }}>Contracts</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{plain(quote.contracts, "—")}</div>
                    <div style={{ color: "#9ca3af" }}>Total cost</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{plain(quote.riskLabel, "")}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8, lineHeight: 1.45 }}>
                    Polymarket US shows this as {plain(market.longName, "Yes")} at {plain(quote.yesCentsLabel, "")} (YES {plain(quote.yesPriceValue, "")}).
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    Buys floor the tick (you pay less). Sells ceil the tick (you receive more). Cost is contracts times that price, floored so it stays at or under the dollars typed, and never over ${MAX_SIZE_DOLLARS}.
                  </div>
                  {protect && protectReady && (
                    <div style={{ fontSize: 12, color: "#93c5fd", marginTop: 6 }}>
                      Protect armed. Cancel if this rest is more than {protectXParsed.cents}¢ through the new mid, then re-rest {protectYParsed.cents}¢ better (buy lower / sell higher) and snap the tick in your favor. Shown as American odds.
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              id="desk-confirm"
              type="submit"
              disabled={!canSubmit}
              style={{
                marginTop: 14,
                width: "100%",
                background: canSubmit ? (confirmed ? "#15803d" : "#2563eb") : "rgba(255,255,255,0.06)",
                color: canSubmit ? "#fff" : "#6b7280",
                border: "none",
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 14,
                fontWeight: 800,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >{busy === "place"
              ? "Sending…"
              : (quote && quote.ok
                ? ((confirmed ? "Send this order" : "Confirm order") + (protect ? " · Protect" : ""))
                : "Rest limit")}</button>
          </form>
        </section>

        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Open orders</div>
          {orders.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>No resting orders.</div>}
          <div className="desk-list">
            {orders.filter((order) => order && typeof order === "object").map((order, index) => (
              <div key={typeof order.id === "string" && order.id ? order.id : "ord-" + index} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{plain(order.title, "Order")}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 4 }}>
                    {order.action === "sell" ? "Sell" : "Buy"} {plain(order.outcomeName, "")} {plain(order.americanLabel, "")}
                    {typeof order.quantity === "number" || typeof order.quantity === "string" ? " · " + order.quantity : ""}
                  </div>
                  {order.protect && order.protect.on && (
                    <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 4 }}>
                      Protect · cancel if more than {order.protect.xCents}¢ through mid · re-rest {order.protect.yCents}¢ better
                      {order.protect.count > 0 ? " · improved " + order.protect.count + "×" : ""}
                      {order.protect.status === "pending_rereset" ? " · re-rest retrying" : ""}
                    </div>
                  )}
                  {stateLabel(order.state) && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{stateLabel(order.state)}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => cancel(order)}
                  disabled={!!busy}
                  style={{
                    background: cancelId === order.id ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(239,68,68,0.45)",
                    color: "#fecaca",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: busy ? "wait" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >{busy === "cancel:" + order.id ? "Canceling…" : (cancelId === order.id ? "Confirm cancel" : "Cancel")}</button>
              </div>
            ))}
          </div>
        </section>

        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Recent fills</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Prices are American odds. No fill alerts on this desk.</div>
          {activity.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>No recent trades.</div>}
          <div className="desk-list">
            {activity.filter((row) => row && typeof row === "object").map((row, index) => (
              <div key={typeof row.id === "string" && row.id ? row.id : "fill-" + index} style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{plain(row.title, "Trade")}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 4 }}>
                  {plain(row.longName, "Yes")} {plain(row.americanLabel, "")}
                  {typeof row.qty === "number" || typeof row.qty === "string" ? " · " + row.qty : ""}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{whenLabel(row.time)}{stateLabel(row.state) ? " · " + stateLabel(row.state) : ""}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function LiveTradingDesk(props) {
  return (
    <DeskErrorBoundary>
      <LiveTradingDeskView {...props} />
    </DeskErrorBoundary>
  );
}
