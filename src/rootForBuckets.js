// Safety net for a moneyline outcome ("DET") whose game's chances are split into spread buckets
// ("DET>=4", "DET<4"): the plain team is the sum of its buckets. Unknown outcomes are left as-is.
const BUCKET = (o) => new RegExp(`^${String(o).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(>=|<)\\d+$`);
export function expandAllowed(allowed = [], dist) {
  if (!dist) return allowed;
  const out = [];
  for (const o of allowed) {
    if (o in dist) { out.push(o); continue; }
    const re = BUCKET(o); const parts = Object.keys(dist).filter((k) => re.test(k));
    if (parts.length) out.push(...parts); else out.push(o);
  }
  return [...new Set(out)];
}
