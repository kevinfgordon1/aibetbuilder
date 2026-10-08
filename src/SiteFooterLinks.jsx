import { GAMBLER_TEL, SITE_FOOTER_LINKS } from "./siteLinks.js";

const linkStyle = { color: "#9ca3af", textDecoration: "none", fontWeight: 600, padding: "4px 2px" };

export default function SiteFooterLinks({ align = "center" }) {
  return (
    <div data-site-footer="true" style={{ display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", gap: 8, fontSize: 12 }}>
      <nav aria-label="Site" style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start" }}>
        {SITE_FOOTER_LINKS.map((l) => (
          <a key={l.href} href={l.href} style={linkStyle}>{l.label}</a>
        ))}
      </nav>
      <div style={{ color: "#9ca3af" }}>
        21+ only. Gambling problem? Call <a href={GAMBLER_TEL} style={{ color: "#d1d5db", fontWeight: 700, textDecoration: "none" }}>1-800-GAMBLER</a>.
      </div>
    </div>
  );
}
