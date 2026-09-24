// Private Live Trading Desk. Owner gate is canSeeOwnerTools (Kevin), same as
// Miss tape / Unhedged — not the Underdog allowlist. The API checks again.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";
import { MAX_SIZE_DOLLARS, DEFAULT_SIZE_DOLLARS, quoteRestingOrder } from "./liveDeskPrice";

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

export default function LiveTradingDesk({ user }) {
  const [board, setBoard] = useState(null);
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [outcome, setOutcome] = useState("long");
  const [action, setAction] = useState("sell");
  const [american, setAmerican] = useState("");
  const [dollars, setDollars] = useState(String(DEFAULT_SIZE_DOLLARS));
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
    return quoteRestingOrder({
      american,
      outcome,
      action,
      tick: market.tick,
      dollars,
      minQty: market.minQty,
    });
  }, [market, american, outcome, action, dollars]);

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
        setError((data && data.error) || "Could not load the desk (" + res.status + ").");
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

  function selectPosition(row) {
    setSlug(row.slug);
    setSlugDraft(row.slug);
    setOutcome(row.side === "short" ? "short" : "long");
    setAction("sell");
    setNotice("");
    load(row.slug, { silent: true });
  }

  function loadDraft(e) {
    if (e) e.preventDefault();
    const next = slugDraft.trim();
    setSlug(next);
    setNotice("");
    load(next);
  }

  async function submit(e) {
    e.preventDefault();
    if (!market || !quote || !quote.ok || busy) return;
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
          outcome,
          action,
          american,
          dollars: Number(dollars),
        }),
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (!res.ok || !data || data.ok === false) {
        setError((data && data.error) || "Order was not accepted (" + res.status + ").");
        return;
      }
      const snap = data.snap || {};
      setNotice(
        "Rested " + (snap.action || action) + " " + (snap.outcomeName || "")
        + " at " + (snap.americanLabel || "") + " (" + (snap.centsLabel || "") + ")"
        + (snap.contracts != null ? " · " + snap.contracts + " contracts" : "")
        + (snap.riskLabel ? " · " + snap.riskLabel + " at risk" : "")
        + "."
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
        setError((data && data.error) || "Cancel failed (" + res.status + ").");
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

  const positions = (board && board.positions) || [];
  const orders = (board && board.orders) || [];
  const activity = (board && board.activity) || [];
  const outcomeName = market ? (outcome === "short" ? market.shortName : market.longName) : "";
  const canSubmit = !!(market && market.tradable && quote && quote.ok && !busy);

  return (
    <div>
      <style>{`
        .desk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .desk-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        @media (max-width: 900px) {
          .desk-grid { grid-template-columns: 1fr; }
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

      {error && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "#fecaca", fontSize: 13 }}>{error}</div>
      )}
      {notice && (
        <div style={{ marginBottom: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.35)", color: "#a7f3d0", fontSize: 13 }}>{notice}</div>
      )}

      <div className="desk-grid">
        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Open positions</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Click a position to hedge it. Long/short follows marketSides, not outcomes[] order.</div>
          {loading && !board && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 14 }}>Loading Polymarket US…</div>}
          {!loading && positions.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 14 }}>No open Polymarket US positions.</div>}
          <div className="desk-list">
            {positions.map((row) => {
              const on = row.slug === slug;
              return (
                <button
                  key={row.slug}
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
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{row.title}</div>
                  <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 4 }}>
                    {(row.side === "short" ? "Short " : "Long ") + (row.team || (row.side === "short" ? "No" : "Yes"))}
                    {" · "}
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{row.net}</span>
                    {row.cost != null ? " · cost " + money(row.cost) : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Rest a limit</div>
          <form onSubmit={loadDraft} style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              aria-label="Market slug"
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              placeholder="market slug"
              style={{ ...field, fontSize: 13, fontWeight: 600, flex: 1 }}
            />
            <button type="submit" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e5e7eb", borderRadius: 8, padding: "0 12px", fontWeight: 700, cursor: "pointer" }}>Load</button>
          </form>
          {market && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#cbd5e1" }}>
              <div style={{ fontWeight: 700, color: "#f8fafc" }}>{market.title}</div>
              <div style={{ marginTop: 4 }}>Yes {market.longName} · No {market.shortName} · tick {market.tick}</div>
              {!market.tradable && <div style={{ color: "#fbbf24", marginTop: 4 }}>This market is not open.</div>}
            </div>
          )}

          <form onSubmit={submit} style={{ marginTop: 14 }}>
            <div style={label}>Side</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip on={outcome === "long"} disabled={!market} onClick={() => setOutcome("long")}>{market ? market.longName : "Yes"}</Chip>
              <Chip on={outcome === "short"} disabled={!market} onClick={() => setOutcome("short")}>{market ? market.shortName : "No"}</Chip>
              <Chip on={action === "buy"} disabled={!market} onClick={() => setAction("buy")}>Buy</Chip>
              <Chip on={action === "sell"} disabled={!market} onClick={() => setAction("sell")}>Sell</Chip>
            </div>

            <label style={{ ...label, marginTop: 14 }} htmlFor="desk-american">American odds</label>
            <input
              id="desk-american"
              inputMode="text"
              autoComplete="off"
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
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              style={field}
            />
            <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 8, lineHeight: 1.45 }}>
              Small size, trial only. Hard cap ${MAX_SIZE_DOLLARS} so a fat-finger cannot rest a large order. Default ${DEFAULT_SIZE_DOLLARS}. Dollars are the most you can lose if this fills and settles against you.
            </div>

            <div style={{ marginTop: 14, padding: "12px 12px", borderRadius: 10, background: "#0a0b0f", border: "1px solid rgba(255,255,255,0.08)", minHeight: 64 }}>
              {!market && <div style={{ color: "#9ca3af", fontSize: 13 }}>Pick a position or load a market slug.</div>}
              {market && !String(american).trim() && (
                <div style={{ color: "#9ca3af", fontSize: 13 }}>Type American odds. The desk snaps to the Polymarket tick in your favor and shows that price before you rest it.</div>
              )}
              {market && String(american).trim() && quote && !quote.ok && (
                <div style={{ color: "#fecaca", fontSize: 13 }}>{quote.error}</div>
              )}
              {market && quote && quote.ok && (
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 800 }}>
                    {action === "buy" ? "Buy" : "Sell"} {outcomeName} {quote.snappedAmericanLabel}
                  </div>
                  <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 6 }}>
                    {quote.centsLabel} on {outcomeName}
                    {outcome === "short" ? " · YES book " + quote.yesCentsLabel : ""}
                    {" · "}{quote.contracts} contracts · {quote.riskLabel} at risk
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    Buys floor the tick (you pay less). Sells ceil the tick (you receive more). Never a worse American than you typed. Good-till-cancel limit — a price through the market can fill now; the rest stays until you cancel.
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                marginTop: 14,
                width: "100%",
                background: canSubmit ? "#2563eb" : "rgba(255,255,255,0.06)",
                color: canSubmit ? "#fff" : "#6b7280",
                border: "none",
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 14,
                fontWeight: 800,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >{busy === "place" ? "Resting…" : (quote && quote.ok ? "Rest limit at " + quote.snappedAmericanLabel : "Rest limit")}</button>
          </form>
        </section>

        <section style={card}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Open orders</div>
          {orders.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>No resting orders.</div>}
          <div className="desk-list">
            {orders.map((order) => (
              <div key={order.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{order.title}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 4 }}>
                    {order.action === "sell" ? "Sell" : "Buy"} {order.outcomeName} {order.americanLabel}
                    <span style={{ color: "#9ca3af" }}> · {order.centsLabel}</span>
                    {order.quantity != null ? " · " + order.quantity : ""}
                  </div>
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
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>American is the YES (long) price. No fill alerts on this desk.</div>
          {activity.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 12 }}>No recent trades.</div>}
          <div className="desk-list">
            {activity.map((row) => (
              <div key={row.id} style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{row.title}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 4 }}>
                  {row.longName} {row.americanLabel}
                  <span style={{ color: "#9ca3af" }}> · {row.centsLabel}</span>
                  {row.qty != null ? " · " + row.qty : ""}
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
