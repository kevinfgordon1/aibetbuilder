import React, { useState } from "react";

// First-run guided setup for Promo Builder. Only calls the setters it is
// given; no pricing logic lives here.
export default function PromoWizard({ books, promoTypes, initial, onApply, onSkip }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState(initial.promoType);
  const [book, setBook] = useState(initial.promoBook);
  const [boost, setBoost] = useState(initial.boostPct);
  const [stake, setStake] = useState(initial.stake);
  const [legs, setLegs] = useState(initial.numLegs);
  const chip = (on) => ({ padding: "10px 16px", borderRadius: 10, border: "1px solid " + (on ? "#3b82f6" : "rgba(255,255,255,0.1)"), background: on ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.03)", color: on ? "#93c5fd" : "#d1d5db", fontWeight: 600, fontSize: 14, cursor: "pointer" });
  const input = { width: 110, background: "#12131a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#e8eaed", padding: "10px 12px", fontSize: 16, fontWeight: 600 };
  const steps = [
    { t: "What promo did you get?", body: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {promoTypes.map((p) => <button key={p.val} type="button" style={chip(type === p.val)} onClick={() => setType(p.val)}>{p.label}</button>)}
      </div>) },
    { t: "Which sportsbook is it at?", body: (
      <select value={book} onChange={(e) => setBook(e.target.value)} style={{ ...input, width: 260 }}>
        {books.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
      </select>) },
    { t: "How big is it?", body: (
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        {type === "boost" && <label style={{ fontSize: 13, color: "#9ca3af" }}>Boost %<br /><input type="number" value={boost} onChange={(e) => setBoost(Number(e.target.value) || 0)} style={input} /></label>}
        <label style={{ fontSize: 13, color: "#9ca3af" }}>{type === "freebet" ? "Free bet $" : "Stake $"}<br /><input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} style={input} /></label>
        <div style={{ fontSize: 13, color: "#9ca3af" }}>Legs (1 = single bet)<br />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>{[1, 2, 3, 4].map((n) => <button key={n} type="button" style={chip(legs === n)} onClick={() => setLegs(n)}>{n}</button>)}</div>
        </div>
      </div>) },
  ];
  const last = step === steps.length - 1;
  return (
    <div data-promo-wizard="true" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(16,185,129,0.08))", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 14, padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase", letterSpacing: 1 }}>Quick setup · Step {step + 1} of {steps.length}</div>
        <button type="button" onClick={onSkip} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 13, cursor: "pointer" }}>Skip</button>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#e8eaed", marginBottom: 14 }}>{steps[step].t}</div>
      {steps[step].body}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {step > 0 && <button type="button" onClick={() => setStep(step - 1)} style={chip(false)}>Back</button>}
        <button type="button" onClick={() => (last ? onApply({ promoType: type, promoBook: book, boostPct: boost, stake, numLegs: legs }) : setStep(step + 1))}
          style={{ ...chip(true), background: "linear-gradient(135deg,#10b981,#0ea5e9)", color: "#06110d", border: "none" }}>
          {last ? "Show my best bets →" : "Next →"}
        </button>
      </div>
    </div>
  );
}
