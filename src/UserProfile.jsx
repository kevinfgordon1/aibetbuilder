// Signed-in user profile. Identity is Google/Gmail; prefs are local defaults
// for Promo Builder. Combo Locks P/L is owner-only and only when the viewer
// is on the Combo Locks allowlist — never mention the feature otherwise.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { canSeeComboLocks, comboLockHash } from "./comboAccess";
import { identityFromUser, profileDisplayName } from "./userProfile";
import { buildComboStatement, formatStatementPnl } from "./comboStatement";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export default function UserProfile({
  user,
  prefs,
  onSavePrefs,
  sportsOptions = [],
  bookOptions = [],
  matchingBookKeys,
  onToggleMatchingBook,
  canSeeLocks = false,
  isOwner = true,
  onOpenLock,
}) {
  const ident = useMemo(() => identityFromUser(user), [user]);
  const [draftName, setDraftName] = useState(prefs?.displayName || ident.name || "");
  const [draftSports, setDraftSports] = useState(() => new Set(prefs?.sports || []));
  const [draftBook, setDraftBook] = useState(prefs?.promoBook || "draftkings");
  const [savedFlash, setSavedFlash] = useState(false);
  const [statement, setStatement] = useState(null);
  const [stmtError, setStmtError] = useState(null);
  const [stmtLoading, setStmtLoading] = useState(false);

  useEffect(() => {
    setDraftName(prefs?.displayName || ident.name || "");
    setDraftSports(new Set(prefs?.sports || []));
    setDraftBook(prefs?.promoBook || "draftkings");
  }, [prefs, ident.name]);

  const showPnl = !!(isOwner && canSeeLocks && canSeeComboLocks(user));

  const loadStatement = useCallback(async () => {
    if (!showPnl || !user?.id) {
      setStatement(null);
      return;
    }
    setStmtLoading(true);
    setStmtError(null);
    try {
      const [{ data: parlays, error: pErr }, { data: fills, error: fErr }] = await Promise.all([
        supabase.from("combo_parlays").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
        supabase.from("combo_fills").select("parlay_id,count,is_combo,is_taker").eq("is_combo", true).eq("is_taker", false),
      ]);
      if (pErr) throw pErr;
      if (fErr) throw fErr;
      const fillsById = {};
      (fills || []).forEach((f) => {
        if (!f.parlay_id) return;
        fillsById[f.parlay_id] = (fillsById[f.parlay_id] || 0) + Number(f.count || 0);
      });
      setStatement(buildComboStatement({ parlays: parlays || [], fillsById, fills: fills || [] }));
    } catch (err) {
      setStmtError(err && err.message ? err.message : "Could not load statement.");
    } finally {
      setStmtLoading(false);
    }
  }, [showPnl, user]);

  useEffect(() => { loadStatement(); }, [loadStatement]);

  const toggleSport = (key) => {
    setDraftSports((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const save = () => {
    if (!onSavePrefs) return;
    onSavePrefs({
      displayName: draftName.trim(),
      sports: [...draftSports],
      promoBook: draftBook,
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  const name = profileDisplayName(user, { displayName: draftName });
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div className="up">
      <style>{`
        .up{max-width:860px}
        .up .card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:16px}
        .up h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin:0 0 12px}
        .up label{display:block;font-size:12px;font-weight:600;color:#8a8f98;margin:0 0 6px}
        .up input,.up select{width:100%;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#12141a;color:#e8eaed;font:inherit}
        .up .btn{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#e8eaed;font:inherit;font-weight:600;padding:9px 14px;border-radius:8px;cursor:pointer}
        .up .btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
        .up .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#9ca3af;font-size:12px;font-weight:600;cursor:pointer}
        .up .chip.on{background:rgba(59,130,246,0.18);border-color:rgba(59,130,246,0.45);color:#93c5fd}
        .up .muted{color:#6b7280;font-size:13px;line-height:1.5}
        .up .num{font-variant-numeric:tabular-nums}
        .up .pos{color:#34d399}.up .neg{color:#f87171}
        .up table{width:100%;border-collapse:collapse;font-size:13px}
        .up th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;padding:6px 8px}
        .up td{padding:8px;border-top:1px solid rgba(255,255,255,0.06)}
        .up .link{background:none;border:none;color:#67e8f9;font:inherit;font-weight:600;cursor:pointer;padding:0}
      `}</style>

      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {ident.avatar ? (
          <img src={ident.avatar} alt="" style={{ width: 64, height: 64, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 }}>{initials}</div>
        )}
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{name}</div>
          <div className="muted">{ident.email || "Signed in with Google"}</div>
        </div>
      </div>

      <div className="card">
        <h3>Preferences</h3>
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="up-name">Display name</label>
          <input id="up-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={ident.name || "Your name"} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label>Default sports</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sportsOptions.map((s) => (
              <button key={s.key} type="button" className={"chip" + (draftSports.has(s.key) ? " on" : "")} onClick={() => toggleSport(s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label htmlFor="up-book">Default sportsbook</label>
          <select id="up-book" value={draftBook} onChange={(e) => setDraftBook(e.target.value)}>
            {bookOptions.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        {matchingBookKeys && onToggleMatchingBook && (
          <div style={{ marginBottom: 14 }}>
            <label>Matching books (Promo Builder)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {bookOptions.filter((b) => b.trusted).map((b) => (
                <button key={b.key} type="button" className={"chip" + (matchingBookKeys.has(b.key) ? " on" : "")} onClick={() => onToggleMatchingBook(b.key)}>{b.label}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" className="btn primary" onClick={save}>Save preferences</button>
          {savedFlash && <span className="muted">Saved — Promo Builder will use these defaults.</span>}
        </div>
      </div>

      {showPnl && (
        <div className="card">
          <h3>P/L statement</h3>
          {stmtLoading && <div className="muted">Loading statement…</div>}
          {stmtError && <div className="muted">{stmtError}</div>}
          {!stmtLoading && !stmtError && statement && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                <div className="card" style={{ margin: 0, padding: 14 }}>
                  <div className="muted">Realized</div>
                  <div className={"num " + (statement.realized >= 0 ? "pos" : "neg")} style={{ fontSize: 24, fontWeight: 800 }}>{formatStatementPnl(statement.realized)}</div>
                </div>
                <div className="card" style={{ margin: 0, padding: 14 }}>
                  <div className="muted">Locked fills</div>
                  <div className={"num " + (statement.lockedFillPnl >= 0 ? "pos" : "neg")} style={{ fontSize: 20, fontWeight: 700 }}>{formatStatementPnl(statement.lockedFillPnl)}</div>
                  <div className="muted">{statement.lockedFills} settled</div>
                </div>
                <div className="card" style={{ margin: 0, padding: 14 }}>
                  <div className="muted">Unfilled (risk profile)</div>
                  <div className={"num " + (statement.unfilledPnl >= 0 ? "pos" : "neg")} style={{ fontSize: 20, fontWeight: 700 }}>{formatStatementPnl(statement.unfilledPnl)}</div>
                  <div className="muted">{statement.unfilledSettled} settled</div>
                </div>
              </div>
              {statement.pending > 0 && <div className="muted" style={{ marginBottom: 10 }}>{statement.pending} still open or awaiting a result.</div>}
              {statement.lines.length === 0 ? (
                <div className="muted">No lock history yet.</div>
              ) : (
                <table>
                  <thead><tr><th>Lock</th><th>Kind</th><th>Result</th><th>P/L</th><th></th></tr></thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.label}</td>
                        <td className="muted">{line.bucket === "locked_fill" ? "locked fill" : line.bucket === "unfilled" ? "unfilled" : "open"}</td>
                        <td>{line.resultLabel}</td>
                        <td className={"num " + (line.pnl == null ? "" : line.pnl >= 0 ? "pos" : "neg")}>{formatStatementPnl(line.pnl)}</td>
                        <td>
                          {onOpenLock && (
                            <button type="button" className="link" onClick={() => onOpenLock(line.id, comboLockHash(line.id))}>Open lock</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
