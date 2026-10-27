import React from "react";
import SiteFooterLinks from "./SiteFooterLinks.jsx";
import { DEMO_VIDEO_URL, ABOUT_PHOTO_URL } from "./onboarding.js";

// Black & gold, one display face (Fraunces) + one body face (Inter). No
// gradients, glows or emoji.
const GOLD = "#d4af37";
const INK = "#0b0b0c";
const DISPLAY = "'Fraunces', Georgia, serif";
const BODY = "'Inter', system-ui, sans-serif";
const S = {
  root: { minHeight: "100vh", background: INK, color: "#ece8df", fontFamily: BODY },
  wrap: { maxWidth: 1080, margin: "0 auto", padding: "0 24px" },
  btn: { display: "inline-block", background: GOLD, color: INK, fontWeight: 700, fontSize: 16, padding: "14px 26px", borderRadius: 6, textDecoration: "none" },
  ghost: { display: "inline-block", border: "1px solid " + GOLD, color: GOLD, fontWeight: 600, fontSize: 15, padding: "13px 22px", borderRadius: 6, textDecoration: "none" },
  card: { background: "#141414", border: "1px solid #2a2618", borderRadius: 8, padding: 24 },
  h2: { fontFamily: DISPLAY, fontSize: 34, fontWeight: 800, margin: "0 0 28px", color: "#f4efe2" },
  k: { fontSize: 12, fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 },
};

export function Wordmark({ size = 22 }) {
  return (
    <a href="/" style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: size, color: "#f4efe2", textDecoration: "none", letterSpacing: -0.3 }} data-wordmark="true">
      aibet<span style={{ color: GOLD }}>builder</span>
    </a>
  );
}

const STEPS = [
  { n: "01", t: "Tell us your promo", d: "Pick your sportsbook and the boost, free bet or no-sweat you got." },
  { n: "02", t: "We rank the bets", d: "We compare live odds from 20+ books and exchanges and rank bets by expected value (EV), the estimated average result of each bet." },
  { n: "03", t: "You place it yourself", d: "Open your sportsbook and place the bet. We never touch your account or money." },
];

const TOOLS = [
  { img: "/landing/promo-builder.png", t: "Promo Builder", d: "Start here. Enter your boost or free bet and see which bets make it worth the most." },
  { img: "/landing/odds-board.png", t: "Odds Board", d: "Compare one game's prices across every book, with the best price highlighted." },
  { img: "/landing/ev-bets.png", t: "+EV Bets", d: "For experienced bettors: bets where a book's price beats our fair-odds estimate." },
];

export default function MarketingLanding() {
  return (
    <div style={S.root} data-page="landing">
      <div style={{ borderBottom: "1px solid #1f1c12" }}>
        <div style={{ ...S.wrap, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px" }}>
          <Wordmark />
          <nav style={{ display: "flex", gap: 22, alignItems: "center", fontSize: 14 }}>
            <a href="#how" style={{ color: "#bdb6a4", textDecoration: "none" }}>How it works</a>
            <a href="#about" style={{ color: "#bdb6a4", textDecoration: "none" }}>About</a>
            <a href="/learn" style={{ color: "#bdb6a4", textDecoration: "none" }}>Learn</a>
            <a href="/app#promo" style={{ ...S.ghost, padding: "8px 16px", fontSize: 14 }}>Open the app</a>
          </nav>
        </div>
      </div>

      <section style={{ ...S.wrap, padding: "72px 24px 48px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 40, alignItems: "center" }}>
        <div>
          <div style={S.k}>For sportsbook boosts and free bets</div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 54, fontWeight: 800, lineHeight: 1.04, margin: "0 0 20px", color: "#f4efe2" }}>
            Find where your boost is worth <span style={{ color: GOLD }}>the most.</span>
          </h1>
          <p style={{ fontSize: 18, color: "#bdb6a4", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 520 }}>
            Tell us your book and promo. We rank every bet by estimated value using live odds from 20+ sportsbooks and exchanges. Free to try, no card needed.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="/app?wizard=1#promo" style={S.btn} data-cta="try-boost">Try it with your boost</a>
            <a href="#how" style={S.ghost}>How it works</a>
          </div>
        </div>
        {DEMO_VIDEO_URL ? (
          <div data-demo-video="true" style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #2a2618", aspectRatio: "16 / 9" }}>
            <iframe src={DEMO_VIDEO_URL} title="aibetbuilder demo" style={{ width: "100%", height: "100%", border: 0 }} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
          </div>
        ) : (
          <img src="/landing/promo-builder.png" alt="Promo Builder ranking bets for a 30% DraftKings boost" style={{ width: "100%", borderRadius: 8, border: "1px solid #2a2618" }} />
        )}
      </section>

      <section id="how" style={{ ...S.wrap, padding: "48px 24px" }}>
        <div style={S.k}>How it works</div>
        <h2 style={S.h2}>Three steps, then you place the bet.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 18 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{ ...S.card, borderTop: "2px solid " + GOLD }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: GOLD, marginBottom: 10 }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#f4efe2" }}>{s.t}</div>
              <div style={{ fontSize: 14, color: "#bdb6a4", lineHeight: 1.6 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...S.wrap, padding: "48px 24px" }}>
        <div style={S.k}>Example result</div>
        <h2 style={S.h2}>What a pick looks like</h2>
        <div style={{ ...S.card, maxWidth: 760 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12 }}>Example · 30% DraftKings boost · $100 stake</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {["Celtics team total under 125.5  -311", "Army to win  +195", "Knicks -3.5  -105"].map((l) => (
              <div key={l} style={{ background: INK, border: "1px solid #2a2618", borderRadius: 6, padding: "10px 14px", fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>{l}</div>
            ))}
          </div>
          <div style={{ fontSize: 15, color: "#d8d2c3", lineHeight: 1.65 }}>
            The parlay pays <b>+661</b>, or <b>+859</b> with the boost. Our fair-odds estimate is <b>+674</b>, so the boosted bet is estimated at about <b style={{ color: GOLD }}>+$24 EV</b>, its average value over many bets. Any single bet can lose.
          </div>
          <div style={{ fontSize: 12, color: "#8a8473", marginTop: 10 }}>Illustrative only; live numbers change every few minutes.</div>
        </div>
      </section>

      <section style={{ ...S.wrap, padding: "48px 24px" }}>
        <div style={S.k}>The tools</div>
        <h2 style={S.h2}>Start with Promo Builder.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20 }}>
          {TOOLS.map((t) => (
            <div key={t.t} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
              <img src={t.img} alt={t.t + " screenshot"} loading="lazy" style={{ width: "100%", display: "block", borderBottom: "1px solid #2a2618" }} />
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, color: "#f4efe2" }}>{t.t}</div>
                <div style={{ fontSize: 14, color: "#bdb6a4", lineHeight: 1.6 }}>{t.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="about" style={{ ...S.wrap, padding: "48px 24px" }}>
        <div style={S.k}>About</div>
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
          {ABOUT_PHOTO_URL && <img data-about-photo="true" src={ABOUT_PHOTO_URL} alt="Kevin Gordon" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: 8, border: "1px solid " + GOLD }} />}
          <div style={{ flex: 1, minWidth: 280, maxWidth: 680 }}>
            <h2 style={{ ...S.h2, marginBottom: 14 }}>Built by Kevin Gordon, a bettor in New Jersey.</h2>
            <p data-about-story="true" style={{ fontSize: 16, color: "#bdb6a4", lineHeight: 1.7, margin: "0 0 12px" }}>
              [Story placeholder — Kevin will write why he built this and how he uses it.]
            </p>
            <p style={{ fontSize: 14, color: "#8a8473", margin: 0 }}>aibetbuilder is operated by Kaygosports, LLC.</p>
          </div>
        </div>
      </section>

      <section style={{ ...S.wrap, padding: "40px 24px 64px", textAlign: "center" }}>
        <a href="/app?wizard=1#promo" style={S.btn}>Try it with your boost</a>
        <div style={{ marginTop: 14, fontSize: 14 }}><a href="/learn" style={{ color: GOLD }}>New to EV and odds? Read the short guide.</a></div>
      </section>

      <footer style={{ borderTop: "1px solid #1f1c12", padding: "28px 24px" }}>
        <SiteFooterLinks />
      </footer>
    </div>
  );
}
