// Locked Combo Locks screen for signed-out visitors (sign in first) and signed-in users who are not on the
// hardcoded allowlist and do not have an approved access request.
import { useState } from "react";
import ComboBetaBadge from "./ComboBetaBadge.jsx";

export default function ComboLocksGate({ user, supabase, request, onRequested, onSignIn }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pending = request && request.status === "pending";
  const denied = request && request.status === "denied";
  const email = user && user.email ? String(user.email).trim().toLowerCase() : "";

  const requestAccess = async () => {
    if (!user || !user.id || !email || !supabase || busy || pending) return;
    setBusy(true);
    setErr("");
    const row = { user_id: user.id, email, status: "pending" };
    const { error } = await supabase.from("combo_locks_access_requests").insert(row);
    setBusy(false);
    if (error && error.code !== "23505") {
      setErr("Couldn't save that request. Try again in a moment.");
      return;
    }
    if (onRequested) onRequested({ ...row, status: "pending" });
  };

  return (
    <div className="combo-beta-gate" data-testid="combo-beta-gate">
      <ComboBetaBadge />
      <h1>Combo Locks</h1>
      <p>
        Submit a parlay you've already bet at your sportsbook, and Combo Locks hedges it for you on Kalshi and Polymarket US. Hedge most or all of it to lock in profit whether the parlay wins or loses.
      </p>
      <ol className="combo-beta-steps" data-testid="combo-beta-steps" style={{ textAlign: "left", lineHeight: 1.5, margin: "12px 0", paddingLeft: 20 }}>
        <li>Place a boosted or +EV parlay at your sportsbook.</li>
        <li>Submit that parlay to Combo Locks as a lock.</li>
        <li>We hedge it by offering the same combo on Kalshi and Polymarket US, priced off the best opposing price across prediction markets.</li>
        <li>As the hedge fills, your parlay gets hedged (mostly or fully) and the profit is locked in.</li>
        <li>Track fills, hedge %, and your P&amp;L on every lock.</li>
      </ol>
      <div className="combo-beta-example" data-testid="combo-beta-example" style={{ textAlign: "left", border: "1px dashed rgba(167,139,250,0.6)", borderRadius: 10, padding: "10px 14px", margin: "12px 0", fontSize: 13 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#a78bfa" }}>EXAMPLE</div>
        <div>3-leg parlay, $100 at <b>+600</b> (boosted)</div>
        <div>Hedged on Kalshi at <b>+450</b> → 100% hedged</div>
        <div>Locked profit: <b>+$27</b> win or lose</div>
        <div className="muted" style={{ fontSize: 11 }}>Illustration only. Real prices and fills vary.</div>
      </div>
      <p>It's in beta. Request access and we'll open the page for your account.</p>
      {!user ? (
        <button type="button" data-testid="combo-beta-signin" onClick={onSignIn}>Sign in to request access</button>
      ) : !email ? (
        <p>This account has no email address, so a request can't be saved.</p>
      ) : pending ? (
        <button type="button" disabled data-testid="combo-beta-pending">Request pending</button>
      ) : (
        <button type="button" data-testid="combo-beta-request" disabled={busy} onClick={requestAccess}>
          {busy ? "Sending…" : "Request access"}
        </button>
      )}
      {denied && !pending && <p>Your last request was declined. You can ask again.</p>}
      {err && <div className="combo-beta-err" role="alert">{err}</div>}
    </div>
  );
}
