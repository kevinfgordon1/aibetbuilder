// Combo Locks prepaid credits card: balance + "Add credits" (USDC via Coinbase or card via Stripe).
// Visible only inside Combo Locks (allowlist). The balance is read from the
// combo_credit_balances view (RLS: own rows; Kevin sees all). The button calls
// /api/combo-credits (Coinbase) or /api/stripe-checkout (Stripe); credits land
// only when the matching webhook confirms payment. No fees are charged yet.
import { useCallback, useEffect, useState } from "react";
import {
  CREDIT_PRESETS_USD, COMBO_FEE_RATE, DEFAULT_PRESET_USD, addCreditsState, allowanceResetText, creditsText, isMissingCreditsSchema, ledgerLabel, returnNote, showUsdcCreditsEnabled,
} from "./comboCredits";

const CREDITS_CSS = `
.cl .crd{margin:0 0 14px}
.cl .crd .crd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cl .crd .crd-title{font-weight:700;font-size:14px}
.cl .crd .crd-bal{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:8px 0 4px}
.cl .crd .crd-amt{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.cl .crd .crd-sub{font-size:12.5px;color:#8a8f98}
.cl .crd p{margin:6px 0;color:#b6bac2;font-size:13px;line-height:1.45}
.cl .crd .crd-presets{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.cl .crd .crd-preset{min-width:64px;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.03);color:#e8eaed;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
.cl .crd .crd-preset.on{border-color:#60a5fa;background:rgba(59,130,246,.18);color:#dbeafe}
.cl .crd .crd-preset:disabled{opacity:.5;cursor:not-allowed}
.cl .crd .crd-go{padding:9px 14px;border-radius:10px;border:0;background:#2563eb;color:#fff;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
.cl .crd .crd-actions{display:flex;gap:8px;flex-wrap:wrap}
.cl .crd .crd-go.alt{background:#0f766e}
.cl .crd .crd-go:disabled{background:#3a3d46;color:#9aa3b2;cursor:not-allowed}
.cl .crd .crd-note{font-size:12.5px;color:#fcd34d;margin-top:6px}
.cl .crd .crd-note.ok{color:#6ee7b7}
.cl .crd .crd-hist{margin-top:10px;font-size:12.5px}
.cl .crd .crd-hist summary{cursor:pointer;color:#93c5fd;font-weight:600}
.cl .crd .crd-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.cl .crd .crd-row .pos{color:#6ee7b7}.cl .crd .crd-row .neg{color:#fca5a5}
.cl .crd .crd-allow{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.cl .crd .crd-box{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;background:rgba(255,255,255,0.02)}
.cl .crd .crd-box .k{font-size:12px;color:#8a8f98}
.cl .crd .crd-box .v{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
.cl .crd .crd-box .s{font-size:12px;color:#9aa3b2}
.cl .crd .crd-meter{height:6px;border-radius:4px;background:rgba(255,255,255,0.08);overflow:hidden;margin-top:6px}
.cl .crd .crd-meter>i{display:block;height:100%;background:#60a5fa}
.cl .crd .crd-gate{border:1px solid rgba(251,191,36,.45);background:rgba(251,191,36,.08);color:#fde68a;border-radius:10px;padding:8px 10px;font-size:13px;margin:8px 0}
@media (max-width:600px){.cl .crd .crd-allow{grid-template-columns:1fr}}
@media (max-width:600px){.cl .crd .crd-preset{flex:1 1 calc(50% - 8px)}.cl .crd .crd-go{width:100%}}
`;

async function authedFetch(supabase, url, init = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) return { ok: false, status: 401, body: { error: "Sign in required" } };
  const r = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...(init.headers || {}), authorization: "Bearer " + token } });
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  return { ok: r.ok && body && body.ok !== false, status: r.status, body: body || {} };
}

const etDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
};

export default function ComboCredits({ supabase, user, feeStatus = null, gateNote = null }) {
  const usdcOn = showUsdcCreditsEnabled();
  const [configured, setConfigured] = useState(false);
  const [cardConfigured, setCardConfigured] = useState(false);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [balance, setBalance] = useState(null);
  const [rows, setRows] = useState([]);
  const [fees, setFees] = useState([]);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [amount, setAmount] = useState(DEFAULT_PRESET_USD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [back] = useState(() => (typeof window !== "undefined" ? returnNote(window.location.search) : null));

  const loadBalance = useCallback(async () => {
    if (!user || !user.id) return;
    const [balQ, rowsQ] = await Promise.all([
      supabase.from("combo_credit_balances").select("balance_usd").eq("user_id", user.id).maybeSingle(),
      supabase.from("combo_credit_ledger").select("id,kind,amount_usd,source,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    ]);
    if (balQ.error || rowsQ.error) {
      if (isMissingCreditsSchema(balQ.error || rowsQ.error)) setSchemaMissing(true);
      setBalance(null);
      return;
    }
    setSchemaMissing(false);
    setBalance(balQ.data ? Number(balQ.data.balance_usd) : 0);
    setRows(rowsQ.data || []);
    try {
      const fq = await supabase.from("combo_fee_charges").select("id,fee_usd,from_allowance_usd,from_credits_usd,contracts,lay_price,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
      setFees(fq.error ? [] : (fq.data || []));
    } catch (_) { setFees([]); }
  }, [supabase, user]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, c] = await Promise.all([
          authedFetch(supabase, "/api/combo-credits").catch(() => ({ ok: false, body: {} })),
          authedFetch(supabase, "/api/stripe-checkout").catch(() => ({ ok: false, body: {} })),
        ]);
        if (alive) {
          setConfigured(usdcOn && !!(r.ok && r.body.configured));
          setCardConfigured(!!(c.ok && c.body.configured));
        }
      } catch (_) {
        if (alive) { setConfigured(false); setCardConfigured(false); }
      } finally {
        if (alive) setCfgLoading(false);
      }
    })();
    loadBalance().catch(() => {});
    return () => { alive = false; };
  }, [supabase, loadBalance]);

  // After returning from Coinbase: drop ?credits= from the URL and poll the balance briefly.
  useEffect(() => {
    if (!back || typeof window === "undefined") return undefined;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("credits");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (_) { /* ignore */ }
    if (back.kind !== "ok") return undefined;
    let n = 0;
    const t = setInterval(() => { n += 1; loadBalance().catch(() => {}); if (n >= 12) clearInterval(t); }, 10000);
    return () => clearInterval(t);
  }, [back, loadBalance]);

  const add = async (method) => {
    const card = method === "card";
    setBusy(card ? "card" : "usdc");
    setError(null);
    try {
      const r = await authedFetch(supabase, card ? "/api/stripe-checkout" : "/api/combo-credits", { method: "POST", body: JSON.stringify({ amount }) });
      if (r.ok && r.body.url) {
        window.location.assign(r.body.url);
        return;
      }
      if (r.body && r.body.code === "not_configured") (card ? setCardConfigured : setConfigured)(false);
      setError((r.body && r.body.error) || "Could not start checkout. Please try again.");
    } catch (_) {
      setError("Could not start checkout. Please try again.");
    }
    setBusy(false);
  };

  const state = addCreditsState({ configured: (configured || cardConfigured) && !schemaMissing, loading: cfgLoading, busy, error });
  const feesOn = !!(feeStatus && feeStatus.feesEnabled);
  const allow = feesOn ? feeStatus : null;
  const usedPct = allow && allow.allowanceUsd > 0 ? Math.min(100, Math.round((allow.allowanceUsedUsd / allow.allowanceUsd) * 100)) : 0;

  return (
    <div className="card crd" aria-label="Combo Locks credits">
      <style>{CREDITS_CSS}</style>
      <div className="crd-head">
        <div className="crd-title">Your credits</div>
        <span className={"chip" + (feesOn ? "" : " ok")}>{feesOn ? `${Math.round(COMBO_FEE_RATE * 100)}% fee on fills` : "Free for now · no fees"}</span>
      </div>
      {gateNote && <div className="crd-gate" role="status">{gateNote}</div>}
      {allow && (
        <div className="crd-allow">
          <div className="crd-box">
            <div className="k">Free credits this month</div>
            <div className="v">{creditsText(allow.allowanceLeftUsd)} <span className="crd-sub">left of {creditsText(allow.allowanceUsd)}</span></div>
            <div className="crd-meter" aria-hidden="true"><i style={{ width: usedPct + "%" }} /></div>
            <div className="s">{creditsText(allow.allowanceUsedUsd)} used · {allowanceResetText()} · unused credits don't carry over</div>
          </div>
          <div className="crd-box">
            <div className="k">Purchased credits</div>
            <div className="v">{balance == null ? "—" : creditsText(balance)}</div>
            <div className="s">Used after your free credits run out</div>
          </div>
        </div>
      )}
      {!allow && <div className="crd-bal">
        <span className="crd-amt">{balance == null ? "—" : creditsText(balance)}</span>
        <span className="crd-sub">{schemaMissing ? "Credits aren't set up yet." : "1 credit = $1"}</span>
      </div>}
      {allow
        ? <p>Each filled lock costs 1% of the amount you put at risk (contracts × lay price). It comes out of your free credits first, then purchased credits. Your all-in price on each lock already includes it. Credits are only for using the tool. They aren't a betting balance and can't be wagered.</p>
        : <p>Credits will pay for Combo Locks. Right now Combo Locks is free, so nothing is taken from your balance. Credits are only for using the tool. They aren't a betting balance and can't be wagered.</p>}
      <p>{usdcOn ? "Pay with a debit or credit card on Stripe's secure checkout page, or add USDC, a digital dollar, from Coinbase or any crypto wallet." : "Pay with a debit or credit card on Stripe's secure checkout page."}</p>
      <div className="crd-presets" role="group" aria-label="Amount to add">
        {CREDIT_PRESETS_USD.map((v) => (
          <button key={v} type="button" className={"crd-preset" + (amount === v ? " on" : "")} aria-pressed={amount === v} disabled={state.disabled && !error} onClick={() => setAmount(v)}>${v}</button>
        ))}
      </div>
      <div className="crd-actions">
        <button type="button" className="crd-go" disabled={state.disabled || !cardConfigured || schemaMissing} onClick={() => add("card")}>{busy === "card" ? "Opening checkout…" : `Pay $${amount} with card`}</button>
        {usdcOn && <button type="button" className="crd-go alt" disabled={state.disabled || !configured || schemaMissing} onClick={() => add("usdc")}>{busy === "usdc" ? "Opening checkout…" : `Add $${amount} with USDC`}</button>}
      </div>
      {state.note && <div className="crd-note">{state.note}</div>}
      {back && <div className={"crd-note" + (back.kind === "ok" ? " ok" : "")}>{back.text}</div>}
      {allow && fees.length > 0 && (
        <details className="crd-hist" open>
          <summary>Recent fees</summary>
          {fees.map((f) => (
            <div className="crd-row" key={"f" + f.id}>
              <span>{Number(f.contracts).toLocaleString("en-US")} contracts × {Number(f.lay_price).toFixed(2)} × 1% <span className="muted">· {etDate(f.created_at)} · {Number(f.from_credits_usd) > 0 ? (Number(f.from_allowance_usd) > 0 ? "free + purchased" : "purchased") : "free credits"}</span></span>
              <span className="neg">−{creditsText(Number(f.fee_usd))}</span>
            </div>
          ))}
        </details>
      )}
      {rows.length > 0 && (
        <details className="crd-hist">
          <summary>Recent activity</summary>
          {rows.map((r) => {
            const v = Number(r.amount_usd);
            return (
              <div className="crd-row" key={r.id}>
                <span>{ledgerLabel(r)} <span className="muted">· {etDate(r.created_at)}</span></span>
                <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : "−"}{creditsText(Math.abs(v))}</span>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
