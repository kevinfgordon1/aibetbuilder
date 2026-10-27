import React from "react";
import SiteFooterLinks from "./SiteFooterLinks.jsx";
import { GLOSSARY } from "./onboarding.js";
import { Wordmark } from "./MarketingLanding.jsx";

export function LearnContent() {
  return (
    <div data-page="learn" style={{ maxWidth: 760, margin: "0 auto", color: "#e8eaed" }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, fontFamily: "'Fraunces', Georgia, serif", margin: "0 0 8px" }}>Learn the basics</h1>
      <p style={{ color: "#9ca3af", fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
        New here? Start in <a href="/app?wizard=1#promo" style={{ color: "#d4af37" }}>Promo Builder</a>: pick your sportsbook and promo, and we rank bets by estimated value. These are the terms you'll see.
      </p>
      <dl style={{ margin: 0 }}>
        {GLOSSARY.map((g) => (
          <div key={g.term} id={g.term.split(" ")[0].toLowerCase()} style={{ background: "#141414", border: "1px solid #2a2618", borderRadius: 12, padding: "14px 18px", marginBottom: 10 }}>
            <dt style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{g.term}</dt>
            <dd style={{ margin: 0, color: "#9ca3af", fontSize: 14, lineHeight: 1.55 }}>{g.def}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function LearnPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0b0b0c", fontFamily: "'Inter', system-ui, sans-serif", padding: "24px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto 24px", display: "flex", justifyContent: "space-between" }}>
        <Wordmark />
        <a href="/app#promo" style={{ color: "#d4af37", fontWeight: 600, textDecoration: "none" }}>Open the app</a>
      </div>
      <LearnContent />
      <div style={{ marginTop: 40 }}><SiteFooterLinks /></div>
    </div>
  );
}
