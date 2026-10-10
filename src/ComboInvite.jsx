import { useCallback, useEffect, useState } from "react";
import { INVITE_COPY, INVITE_TABLE, dismissKey, fetchMyInvite, shouldShowInviteBanner, statusUpdate, submitInvite } from "./comboInvite.js";

const card = { margin: "12px 32px 0", padding: "14px 16px", borderRadius: 12, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.28)", color: "#e5e7eb", fontSize: 13.5, position: "relative" };
const btn = { background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ghost = { background: "transparent", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" };
const input = { width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e5e7eb", padding: "8px 10px", font: "inherit", fontSize: 13.5 };
const label = { display: "block", fontSize: 12.5, color: "#9ca3af", margin: "10px 0 4px" };

function readDismissed(userId) { try { return localStorage.getItem(dismissKey(userId)) === "1"; } catch (_) { return false; } }

/** Signed-in only. Render nothing for logged-out visitors or users who already have Combo Locks. */
export function ComboInviteBanner({ supabase, user, hasAccess }) {
  const uid = user && user.id;
  const [dismissed, setDismissed] = useState(() => (uid ? readDismissed(uid) : false));
  const [mine, setMine] = useState(undefined); // undefined = loading, null = none
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: (user && user.email) || "", books: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const show = shouldShowInviteBanner({ user, hasAccess, dismissed });

  useEffect(() => { if (uid) { setDismissed(readDismissed(uid)); setForm((f) => ({ ...f, email: f.email || user.email || "" })); } }, [uid]);
  useEffect(() => {
    if (!show) return undefined;
    let alive = true;
    fetchMyInvite(supabase, uid).then((r) => { if (alive) setMine(r); }).catch(() => { if (alive) setMine(null); });
    return () => { alive = false; };
  }, [show, supabase, uid]);

  if (!show || mine === undefined) return null;
  const dismiss = () => { try { localStorage.setItem(dismissKey(uid), "1"); } catch (_) {} setDismissed(true); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await submitInvite(supabase, uid, form); setMine({ status: "pending" }); setOpen(false); }
    catch (x) { setErr((x && x.message) || "Couldn't send your request. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="combo-invite-banner" data-guard-allow="true" style={card}>
      <button type="button" aria-label="Dismiss" onClick={dismiss} style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "#9ca3af", fontSize: 18, cursor: "pointer" }}>×</button>
      <div style={{ fontWeight: 700, fontSize: 14.5, paddingRight: 24 }}>{INVITE_COPY.title}</div>
      <div style={{ marginTop: 4, lineHeight: 1.45 }}>{INVITE_COPY.body}</div>
      {mine ? (
        <div data-testid="combo-invite-done" style={{ marginTop: 10, color: "#6ee7b7", fontWeight: 600 }}>✓ {INVITE_COPY.done}</div>
      ) : !open ? (
        <div style={{ marginTop: 10 }}><button type="button" style={btn} onClick={() => setOpen(true)}>{INVITE_COPY.cta}</button></div>
      ) : (
        <form data-testid="combo-invite-form" onSubmit={submit} style={{ marginTop: 6, maxWidth: 520 }}>
          <label style={label} htmlFor="ci-email">Email</label>
          <input id="ci-email" type="email" required style={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label style={label} htmlFor="ci-books">Which sportsbooks/exchanges do you use? (optional)</label>
          <input id="ci-books" style={input} maxLength={500} placeholder="e.g. FanDuel, DraftKings, Kalshi" value={form.books} onChange={(e) => setForm({ ...form, books: e.target.value })} />
          <label style={label} htmlFor="ci-notes">Anything else? (optional)</label>
          <textarea id="ci-notes" rows={3} style={{ ...input, resize: "vertical" }} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {err && <div style={{ color: "#fca5a5", fontSize: 12.5, marginTop: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" style={btn} disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
            <button type="button" style={ghost} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, color: "#9ca3af" }}>{INVITE_COPY.risk}</div>
    </div>
  );
}

const etDate = (iso) => { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; } catch (_) { return iso; } };

/** Owner-only list inside All users. Approve/Decline change status only; they do not grant access. */
export function InviteRequestsList({ supabase, enabled = true, initialRows = null }) {
  const [rows, setRows] = useState(initialRows);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from(INVITE_TABLE).select("id,user_id,email,books,notes,status,created_at,decided_at").order("created_at", { ascending: false }).limit(200);
    if (error) { setErr(/does not exist|schema cache/i.test(error.message || "") ? "Invite requests table isn't set up yet." : "Couldn't load invite requests."); setRows([]); return; }
    setErr(null); setRows(data || []);
  }, [supabase]);
  useEffect(() => { if (enabled && !initialRows) load(); }, [enabled, load, initialRows]);
  const set = async (id, status) => {
    setBusy(id);
    const patch = statusUpdate(status);
    const { error } = await supabase.from(INVITE_TABLE).update(patch).eq("id", id);
    if (error) setErr("Couldn't update status."); else setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setBusy(null);
  };
  if (!rows) return null;
  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <div data-testid="invite-requests" style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Invite requests <span className="muted" style={{ fontWeight: 400 }}>· {rows.length} total · {pending} pending</span></div>
      {err && <div className="note warn" style={{ marginBottom: 6 }}>{err}</div>}
      {!rows.length && !err && <div className="muted" style={{ fontSize: 12 }}>No requests yet.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12.5 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ wordBreak: "break-all" }}>{r.email}</b>
            <span className="muted">{etDate(r.created_at)}</span>
            <span className={"chip" + (r.status === "declined" ? " warn" : "")}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn mini" disabled={busy === r.id || r.status === "approved"} onClick={() => set(r.id, "approved")}>Approve</button>
            <button type="button" className="btn mini danger" disabled={busy === r.id || r.status === "declined"} onClick={() => set(r.id, "declined")}>Decline</button>
          </div>
          <div style={{ marginTop: 4 }}><span className="muted">Uses:</span> {r.books || "—"}</div>
          <div><span className="muted">Anything else:</span> {r.notes || "—"}</div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11.5 }}>Approve/Decline only record your decision. Approving does not give access and sends nothing.</div>
    </div>
  );
}
