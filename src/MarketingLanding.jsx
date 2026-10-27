import React from "react";
import SiteFooterLinks from "./SiteFooterLinks.jsx";
import { DEMO_VIDEO_URL } from "./onboarding.js";

const S = {
  root: { minHeight: "100vh", background: "#0a0b0f", color: "#e8eaed", fontFamily: "'DM Sans', sans-serif" },
  wrap: { maxWidth: 1040, margin: "0 auto", padding: "0 24px" },
  btn: { display: "inline-block", background: "linear-gradient(135deg,#10b981,#0ea5e9)", color: "#06110d", fontWeight: 800, fontSize: 16, padding: "14px 26px", borderRadius: 12, textDecoration: "none" },
  ghost: { display: "inline-block", border: "1px solid rgba(255,255,255,0.18)", color: "#e8eaed", fontWeight: 600, fontSize: 15, padding: "13px 22px", borderRadius: 12, textDecoration: "none" },
  card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24 },
  h2: { fontSize: 30, fontWeight: 800, letterSpacing: -0.6, textAlign: "center", margin: "0 0 28px" },
};

const STEPS = [
  { n: 1, t: "Tell us your promo", d: "Pick your sportsbook and the boost, free bet or no-sweat you got." },
  { n: 2, t: "We rank the bets", d: "We compare live odds from 20+ books and exchanges and rank bets by expected value (EV) — what each is worth on average." },
  { n: 3, t: "You place it yourself", d: "Open your sportsbook and place the bet. We never touch your account or money." },
];

const TOOLS = [
  { ic: "🎯", t: "Promo Builder", d: "Start here. Enter your boost or free bet and see which bets make it worth the most." },
  { ic: "📊", t: "Odds Board", d: "Compare one game's prices across every book; the best price is highlighted." },
  { ic: "📈", t: "+EV Bets", d: "For experienced bettors: every bet where a book's price beats our fair-odds estimate." },
];

export default function MarketingLanding() {
  return (
    <div style={S.root} data-page="landing">
      <div style={{ ...S.wrap, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 18 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>B</div>
          AI Bet Builder
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 14 }}>
          <a href="/learn" style={{ color: "#9ca3af", textDecoration: "none", fontWeight: 600 }}>Learn</a>
          <a href="/app#promo" style={{ ...S.ghost, padding: "8px 16px", fontSize: 14 }}>Open the app</a>
        </div>
      </div>

      <section style={{ ...S.wrap, textAlign: "center", padding: "56px 24px 40px" }}>
        <h1 style={{ fontSize: 52, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.08, margin: "0 0 18px" }}>
          Find where your sportsbook boost<br /><span style={{ background: "linear-gradient(135deg,#10b981,#3b82f6)", WebkitBackgroundClip: "text", color: "transparent" }}>is worth the most.</span>
        </h1>
        <p style={{ fontSize: 18, color: "#9ca3af", maxWidth: 620, margin: "0 auto 30px", lineHeight: 1.55 }}>
          Got a profit boost or free bet? Tell us your book and promo. We rank every bet by estimated value using live odds from 20+ sportsbooks and exchanges. Free to try, no card needed.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/app?wizard=1#promo" style={S.btn} data-cta="try-boost">Try it with your boost →</a>
          <a href="#how" style={S.ghost}>How it works</a>
        </div>
        {DEMO_VIDEO_URL && (
          <div data-demo-video="true" style={{ marginTop: 40, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", aspectRatio: "16 / 9", maxWidth: 820, marginLeft: "auto", marginRight: "auto" }}>
            <iframe src={DEMO_VIDEO_URL} title="AI Bet Builder demo" style={{ width: "100%", height: "100%", border: 0 }} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
          </div>
        )}
      </section>

      <section id="how" style={{ ...S.wrap, padding: "40px 24px" }}>
        <h2 style={S.h2}>How it works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 18 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={S.card}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, marginBottom: 14 }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{s.t}</div>
              <div style={{ fontSize: 14, color: "#9ca3af", lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...S.wrap, padding: "40px 24px" }}>
        <h2 style={S.h2}>What a result looks like</h2>
        <div style={{ ...S.card, maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Example · 30% DraftKings boost · $100 stake</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {["Celtics team total under 125.5  -311", "Army to win  +195", "Knicks -3.5  -105"].map((l) => (
              <div key={l} style={{ background: "#12131a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>{l}</div>
            ))}
          </div>
          <div style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.6 }}>
            Parlay pays <b>+661</b>, <b>+859</b> with the boost. Our fair-odds estimate is <b>+674</b>, so the boosted bet is estimated at about <b style={{ color: "#10b981" }}>+$24 EV</b> — its average value over many bets. Any single bet can lose.
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 10 }}>Illustrative only; live numbers change every few minutes.</div>
        </div>
      </section>

      <section style={{ ...S.wrap, padding: "40px 24px" }}>
        <h2 style={S.h2}>The tools</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 18 }}>
          {TOOLS.map((t) => (
            <div key={t.t} style={S.card}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>{t.ic}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t.t}</div>
              <div style={{ fontSize: 14, color: "#9ca3af", lineHeight: 1.55 }}>{t.d}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <a href="/app?wizard=1#promo" style={S.btn}>Try it with your boost →</a>
          <div style={{ marginTop: 14, fontSize: 14 }}><a href="/learn" style={{ color: "#60a5fa" }}>New to EV and odds? Read the 2-minute guide.</a></div>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "28px 24px", marginTop: 40 }}>
        <SiteFooterLinks />
      </footer>
    </div>
  );
}
