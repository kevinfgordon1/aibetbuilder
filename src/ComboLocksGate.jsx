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
        Combo Locks locks in a profit on a sportsbook parlay by offering that same parlay to traders on Kalshi and Polymarket.
      </p>
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
