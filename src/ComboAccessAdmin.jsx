// Beta access requests, on the Combo Locks page for Kevin's two accounts.
// Sits with the existing All users admin. Approving opens the page; it
// does not change who can trade.
import { useCallback, useEffect, useState } from "react";
import { canReviewComboAccess } from "./comboAccess";

async function authedFetch(supabase, url, init = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) return { ok: false, status: 401, body: { error: "Sign in required" } };
  const r = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers || {}),
      authorization: "Bearer " + token,
    },
  });
  let body = null;
  try { body = await r.json(); } catch (_) { body = null; }
  return { ok: r.ok && body && body.ok !== false, status: r.status, body: body || {} };
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ComboAccessAdmin({ user, supabase }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await authedFetch(supabase, "/api/combo-access-requests");
    if (!r.ok) {
      setErr(r.body.error || "Could not load requests.");
      setRows([]);
      return;
    }
    setErr("");
    setRows(r.body.requests || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  if (!canReviewComboAccess(user)) return null;
  const list = rows || [];
  const pending = list.filter((r) => r.status === "pending");
  const approve = async (row) => {
    const who = row.email || "this account";
    if (!window.confirm(`Open Combo Locks for ${who}?`)) return;
    setBusy(true);
    setErr("");
    const r = await authedFetch(supabase, "/api/combo-access-requests", {
      method: "POST",
      body: JSON.stringify({ user_id: row.user_id }),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.body.error || "Could not approve that request."); return; }
    setRows(r.body.requests || []);
  };
  return (
    <div className="card tst" data-testid="combo-access-admin">
      <div className="tst-head">
        <div className="tst-title">Beta access requests {rows ? <span className="muted" style={{ fontWeight: 400 }}>· {pending.length} pending</span> : null}</div>
        <button type="button" className="btn mini" disabled={busy} onClick={load}>Refresh</button>
      </div>
      <p>Approve opens the Combo Locks page for that account.</p>
      {err && <div className="note warn" role="alert">{err}</div>}
      {!rows && !err && <div className="muted">Loading…</div>}
      {rows && list.length === 0 && !err && <div className="muted">No requests yet.</div>}
      {list.length > 0 && (
        <div className="tst-scroll" style={{ marginTop: 8 }}>
          <table className="tst-table">
            <thead><tr><th>Email</th><th>Requested</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.user_id}>
                  <td data-k="Email">{row.email}</td>
                  <td data-k="Requested">{when(row.created_at)}</td>
                  <td data-k="Status">{row.status === "approved" ? "Approved" : row.status === "denied" ? "Declined" : "Pending"}</td>
                  <td data-k="">
                    {row.status !== "approved" && (
                      <button type="button" className="btn mini" disabled={busy} onClick={() => approve(row)}>Approve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
