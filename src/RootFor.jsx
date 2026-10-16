// "What to root for" — owner-only cheat sheet across ALL open Combo Locks (live inverse bet fairs).
import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeOwnerTools } from "./comboAccess";

let client = null;
function supabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sUsd = (n) => (n > 0 ? "+" : "") + usd(n);
const pct = (p, d = 1) => (p == null ? "—" : p > 0 && p * 100 < 0.5 * 10 ** -d ? `<${(10 ** -d).toFixed(d)}%` : (p * 100).toFixed(d) + "%");
const oneIn = (p) => (p > 0 ? `about 1 in ${Math.round(1 / p).toLocaleString("en-US")}` : "");
const am = (a) => (a == null ? "—" : (a > 0 ? "+" : "") + Math.round(a));
const amFromP = (p) => (!(p > 0 && p < 1) ? null : p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
const etStamp = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket", novig: "Novig", prophetx: "ProphetX" };

export default function RootFor({ user, initialData = null }) {
  const [open, setOpen] = useState(true);
  const [st, setSt] = useState({ loading: false, error: null, data: initialData });
  const load = useCallback(async () => {
    const c = supabase();
    if (!c) return setSt({ loading: false, error: "Not configured", data: null });
    setSt((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const r = await fetch("/api/root-for", { headers: { accept: "application/json", authorization: "Bearer " + session.access_token } });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `Request failed (${r.status})`);
      setSt({ loading: false, error: null, data: j });
    } catch (e) { setSt((s) => ({ loading: false, error: String((e && e.message) || e), data: s.data })); }
  }, []);
  useEffect(() => { if (canSeeOwnerTools(user) && !initialData) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canSeeOwnerTools(user)) return null;
  const d = st.data;
  return (
    <div className="rootfor">
      <style>{`
        .rootfor{border:1px solid #374151;border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#0b1220;color:#e5e7eb;font-size:13px}
        .rootfor h3{margin:0;font-size:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .rootfor .sub{color:#9ca3af;font-size:12px}.rootfor .tag{font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(16,185,129,.15);color:#6ee7b7}
        .rootfor .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
        .rootfor .tile{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 12px}
        .rootfor .tile b{display:block;font-size:18px;margin:2px 0}.rootfor .tile span{color:#9ca3af;font-size:12px}
        .rootfor .pos{color:#6ee7b7}.rootfor .neg{color:#fca5a5}
        .rootfor table{width:100%;border-collapse:collapse;margin-top:6px}.rootfor th,.rootfor td{padding:6px;border-bottom:1px solid #1f2937;text-align:left}
        .rootfor th{color:#9ca3af;font-weight:500;font-size:12px}.rootfor .num{text-align:right;font-variant-numeric:tabular-nums}
        .rootfor h4{margin:14px 0 4px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
        .rootfor button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}
        .rootfor .note{color:#9ca3af;font-size:12px;margin-top:6px}
        @media (max-width:600px){.rootfor .hide-sm{display:none}}
      `}</style>
      <h3>
        What to root for <span className="tag">Owner</span>
        <span className="sub">{d ? `As of ${etStamp(d.asOf)} · ${d.locksPriced} of ${d.locksTotal} open locks · ${d.events} games` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" onClick={load} disabled={st.loading}>{st.loading ? "Updating…" : "Refresh"}</button>
          <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"}</button>
        </span>
      </h3>
      {st.error && <div className="note neg">{st.error}</div>}
      {open && d && (
        <>
          <h4>Top 5 to root for (biggest swing in total P&L)</h4>
          <table>
            <thead><tr><th>#</th><th>Root for</th><th className="hide-sm">Game</th><th className="num">Chance now</th><th className="num">Fair</th><th className="num">Swing</th><th className="num hide-sm">If it hits / misses</th></tr></thead>
            <tbody>
              {d.top.map((t, i) => (
                <tr key={t.event}>
                  <td>{i + 1}</td><td><b>{t.name}</b></td><td className="hide-sm">{t.game}</td>
                  <td className="num">{pct(t.p)}</td><td className="num">{am(t.american)}</td>
                  <td className="num pos">{usd(t.swing)}</td>
                  <td className="num hide-sm">{sUsd(t.ifHit)} / {sUsd(t.ifMiss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid">
            <div className="tile"><span>Best outcome</span><b className="pos">{sUsd(d.best && d.best.pnl)}</b><span>{d.best && d.best.p != null ? (d.best.p < 1e-4 ? `${pct(d.best.p, 3)} chance (${oneIn(d.best.p)})` : `${pct(d.best.p, 3)} chance (${am(amFromP(d.best.p))})`) : "chance not computed"}</span></div>
            <div className="tile"><span>Worst outcome</span><b className={d.worst && d.worst.pnl < 0 ? "neg" : "pos"}>{sUsd(d.worst && d.worst.pnl)}</b><span>{d.worst && d.worst.p != null ? `${pct(d.worst.p, 3)} chance (${am(amFromP(d.worst.p))})` : "chance not computed"}</span></div>
            <div className="tile"><span>Total EV</span><b className={d.ev >= 0 ? "pos" : "neg"}>{sUsd(d.ev)}</b><span>±2 SD: {sUsd(d.lo2)} to {sUsd(d.hi2)}</span></div>
            <div className="tile"><span>Chance of a profit</span><b>{pct(d.pProfit, 1)}</b><span>{d.exact && d.exact.pProfit === false ? "simulated" : "exact"}</span></div>
          </div>
          <div className="note">±2 SD is correlation-aware (same team across locks moves together). With long shots the real range is lopsided: most slates land near the downside, and a rare all-hit slate makes the upside tail much longer than the ±2 SD band suggests.</div>
          <h4>Per game</h4>
          <table>
            <thead><tr><th>Game</th><th>Root for</th><th className="num">Chance now</th><th className="num">Swing</th><th className="num hide-sm">Locks</th></tr></thead>
            <tbody>
              {d.perEvent.map((e) => (
                <tr key={e.event}>
                  <td>{e.game}</td><td>{e.swing != null && Math.abs(e.swing) >= 0.5 ? e.rootForName : "Doesn't matter"}</td>
                  <td className="num">{pct(e.p)}</td><td className="num">{e.swing != null ? usd(Math.abs(e.swing)) : "—"}</td><td className="num hide-sm">{e.locks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            Chances come from the live inverse bet method: each leg is 1 minus the best opposing price with $500 of depth (fees included) across {Object.entries((d.legs || []).reduce((a, l) => { if (l.best) a[l.best] = (a[l.best] || 0) + 1; return a; }, {})).map(([v, n]) => `${VENUE[v] || v} (${n} legs)`).join(", ") || "—"}; ProphetX is off until its key is set. Chances are the raw inverted prices, not scaled. A team in many locks is one outcome, and both sides of a game can't both win. When locks hold both sides, the two raw chances add to a bit under 100%; the gap is treated as a slate where neither side's leg wins. Different games are independent.
            {" "}{d.method === "exact" ? "Exact enumeration." : d.note}
            {d.unpriced && d.unpriced.length ? ` ${d.unpriced.length} lock(s) left out: a leg had no live price with $500 depth (${d.unpriced.map((u) => u.leg).slice(0, 3).join(", ")}${d.unpriced.length > 3 ? "…" : ""}).` : ""}
            {d.resting ? ` Resting hedge orders (${Math.round(d.resting).toLocaleString()} contracts) count only once filled.` : ""}
          </div>
        </>
      )}
    </div>
  );
}
