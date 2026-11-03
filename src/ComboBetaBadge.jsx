// Violet "BETA" pill for the Combo Locks tab and the page notice.
// Gold stays the site accent; this pill is the only violet so the label
// reads as a badge on the black nav.

export const COMBO_BETA_CSS = `
.combo-beta-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  margin: 0;
  padding: 2px 7px 2px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 100%);
  color: #ffffff;
  font-family: inherit;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
  vertical-align: middle;
  box-shadow:
    0 0 8px rgba(139, 92, 246, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.38);
  animation: combo-beta-glow 2.8s ease-in-out infinite;
}
.combo-beta-badge-label {
  position: relative;
  z-index: 1;
  padding-right: 0.11em;
}
.combo-beta-badge::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.45) 48%, transparent 66%);
  transform: translateX(-130%);
  animation: combo-beta-shimmer 2.8s ease-in-out infinite;
  pointer-events: none;
}
@keyframes combo-beta-shimmer {
  0% { transform: translateX(-130%); }
  55%, 100% { transform: translateX(130%); }
}
@keyframes combo-beta-glow {
  0%, 100% {
    box-shadow:
      0 0 6px rgba(139, 92, 246, 0.45),
      inset 0 0 0 1px rgba(255, 255, 255, 0.32);
  }
  50% {
    box-shadow:
      0 0 12px rgba(168, 85, 247, 0.72),
      inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  }
}
.combo-beta-note {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(168, 85, 247, 0.4);
  color: #f4efe2;
  font-size: 13px;
  line-height: 1.45;
}
.combo-beta-gate {
  max-width: 560px;
  background: #12131a;
  border: 1px solid rgba(212, 175, 55, 0.35);
  border-radius: 14px;
  padding: 22px 22px 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.combo-beta-gate h1 {
  margin: 14px 0 8px;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.3px;
  color: #f4efe2;
}
.combo-beta-gate p {
  margin: 0 0 10px;
  color: #d1d5db;
  font-size: 14.5px;
  line-height: 1.5;
}
.combo-beta-gate button {
  margin-top: 6px;
  background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 100%);
  color: #ffffff;
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.35);
}
.combo-beta-gate button:disabled {
  background: rgba(255, 255, 255, 0.06);
  color: #ddd6fe;
  cursor: default;
  box-shadow: none;
  border: 1px solid rgba(168, 85, 247, 0.45);
}
.combo-beta-gate .combo-beta-err {
  margin-top: 10px;
  color: #fca5a5;
  font-size: 13px;
}
@media (max-width: 720px) {
  .combo-beta-badge {
    font-size: 9px;
    letter-spacing: 0.1em;
    padding: 2px 6px 2px 7px;
  }
  .combo-beta-gate { padding: 16px 14px 14px; }
  .combo-beta-gate h1 { font-size: 22px; }
  .combo-beta-note { font-size: 12.5px; padding: 8px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .combo-beta-badge { animation: none; }
  .combo-beta-badge::after { animation: none; opacity: 0; }
}
`;

export function ComboBetaStyles() {
  return <style>{COMBO_BETA_CSS}</style>;
}

export default function ComboBetaBadge() {
  return (
    <span className="combo-beta-badge" data-testid="combo-beta-badge">
      <span className="combo-beta-badge-label">BETA</span>
    </span>
  );
}
