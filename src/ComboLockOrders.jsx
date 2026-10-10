// Open-quote cancel + edit-fill controls for active Combo Lock cards.
import { useState } from "react";
import {
  displayFillForEdit,
  fillEditLabel,
  fillEditedNote,
  openQuotesForLock,
  openQuoteLabel,
  resolveExchangeFill,
  validateFillAmerican,
  COMBO_FEE_RATE,
  allInFromExchange,
} from "./comboLockEdit";
import { fmtAmerican as fmtAm } from "./comboLockView";

async function postLockOrder(supabase, body) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("Sign in required");
  const r = await fetch("/api/combo-lock-orders", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await r.json(); } catch (_) { payload = null; }
  if (!r.ok || !payload || payload.ok === false) {
    throw new Error((payload && payload.error) || `Request failed (${r.status})`);
  }
  return payload;
}

export function OpenQuotesPanel({
  parlay,
  submissions,
  supabase,
  feesEnabled,
  onDone,
  busyKey,
  setBusyKey,
}) {
  const opens = openQuotesForLock(submissions, parlay.id);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const busy = busyKey === parlay.id || (editId && busyKey === editId);

  const run = async (key, fn) => {
    setErr("");
    setBusyKey(key);
    try {
      await fn();
      setEditId(null);
      if (onDone) await onDone();
    } catch (e) {
      setErr(e.message || "Something went wrong");
    } finally {
      setBusyKey(null);
    }
  };

  const cancelOne = (sub) => run(sub.id, () => postLockOrder(supabase, { action: "cancel_quote", submission_id: sub.id }));
  const cancelAll = () => run(parlay.id, () => postLockOrder(supabase, { action: "cancel_all_open", parlay_id: parlay.id }));
  const saveEdit = (sub) => run(sub ? sub.id : parlay.id, async () => {
    const v = validateFillAmerican(draft);
    if (!v.ok) throw new Error(v.error);
    await postLockOrder(supabase, { action: "edit_fill", parlay_id: parlay.id, fill: v.american });
    // Per-quote edit also cancels that quote explicitly (edit_fill already cancels all open).
    if (sub && sub.id) {
      try { await postLockOrder(supabase, { action: "cancel_quote", submission_id: sub.id }); } catch (_) { /* may already be cancelled by cancel_open */ }
    }
  });

  const startEdit = (sub) => {
    setErr("");
    setEditId(sub ? sub.id : "lock");
    setDraft(displayFillForEdit(parlay, { feesEnabled }));
  };

  return (
    <div className="open-quotes" data-no-toggle="">
      <div className="oq-head">
        <div className="oq-title">Open quotes</div>
        <div className="oq-actions">
          <button type="button" className="btn mini" disabled={!!busy} onClick={() => startEdit(null)}>Edit fill odds</button>
          {opens.length > 0 && (
            <button type="button" className="btn mini danger" disabled={!!busy} onClick={cancelAll}>Cancel all open</button>
          )}
        </div>
      </div>
      {fillEditedNote(parlay) ? <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{fillEditedNote(parlay)}</div> : null}
      {editId === "lock" && (
        <EditFillForm
          feesEnabled={feesEnabled}
          draft={draft}
          setDraft={setDraft}
          busy={!!busy}
          onCancel={() => setEditId(null)}
          onSave={() => saveEdit(null)}
        />
      )}
      {opens.length === 0 ? (
        <div className="empty" style={{ padding: "4px 0" }}>No open quotes right now.</div>
      ) : (
        <ul className="oq-list">
          {opens.map((sub) => (
            <li key={sub.id} className="oq-row">
              <div className="oq-label num">{openQuoteLabel(sub)}</div>
              <div className="oq-btns">
                <button type="button" className="btn mini" disabled={!!busy} onClick={() => startEdit(sub)}>Edit odds</button>
                <button type="button" className="btn mini danger" disabled={!!busy} onClick={() => cancelOne(sub)}>Cancel</button>
              </div>
              {editId === sub.id && (
                <EditFillForm
                  feesEnabled={feesEnabled}
                  draft={draft}
                  setDraft={setDraft}
                  busy={!!busy}
                  onCancel={() => setEditId(null)}
                  onSave={() => saveEdit(sub)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {err ? <div className="note warn" role="alert">{err}</div> : null}
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Cancels hit the exchange within a few seconds. New quotes use the updated fill odds within about 30s. Fills you already have keep their old price.
      </div>
    </div>
  );
}

function EditFillForm({ feesEnabled, draft, setDraft, busy, onCancel, onSave }) {
  const preview = Number(draft);
  const resolved = Number.isFinite(preview) && preview !== 0
    ? resolveExchangeFill(preview, { feesEnabled, feeRate: COMBO_FEE_RATE })
    : null;
  return (
    <div className="oq-edit" style={{ marginTop: 8, marginBottom: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>{fillEditLabel(feesEnabled)}</label>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="num" type="number" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} style={{ maxWidth: 140 }} />
        <button type="button" className="btn mini primary" disabled={busy} onClick={onSave}>Save fill odds</button>
        <button type="button" className="btn mini" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {feesEnabled && resolved && resolved.ok ? (
        <div className="muted num" style={{ fontSize: 12, marginTop: 4 }}>
          Quotes on the exchange at {fmtAm(resolved.fillAmerican)}. The 1% fee on the amount at risk makes it {fmtAm(resolved.typedAmerican)} all-in.
        </div>
      ) : null}
      {!feesEnabled && Number.isFinite(preview) && preview !== 0 ? (
        <div className="muted num" style={{ fontSize: 12, marginTop: 4 }}>
          Selling at {fmtAm(preview)}{allInFromExchange(preview) != null ? ` · all-in with 1% would be ${fmtAm(allInFromExchange(preview))} (you are fee-free)` : ""}
        </div>
      ) : null}
    </div>
  );
}

export { postLockOrder };
