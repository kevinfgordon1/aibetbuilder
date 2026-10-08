// Card summary click → toggle Details, except on real controls (switch,
// buttons, links, inputs, labels) or when the user is selecting text.
export const CARD_CONTROL_SELECTOR = "button,a,input,select,textarea,label,[role=switch],[role=checkbox],[data-no-toggle]";
export function shouldToggleFromCard(e) {
  const t = e && e.target;
  if (t && typeof t.closest === "function") {
    const hit = t.closest(CARD_CONTROL_SELECTOR);
    if (hit && hit !== e.currentTarget) return false;
  }
  try {
    const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (sel && String(sel).trim()) return false;
  } catch (_) { /* no selection API */ }
  return true;
}
