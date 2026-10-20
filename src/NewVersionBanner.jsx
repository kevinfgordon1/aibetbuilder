import React, { useEffect, useRef, useState } from "react";
import { currentEntryScript, entryScriptFromHtml, isNewer } from "./newVersion.js";

const CHECK_MS = 3 * 60 * 1000;

// Checks every 3 min and when the tab comes back into view. A tab that is in the
// background reloads itself when a new version is found (nothing typed is
// visible to lose); a tab in view shows a Reload bar instead of reloading
// mid-form.
export default function NewVersionBanner() {
  const [ready, setReady] = useState(false);
  const current = useRef(currentEntryScript());
  useEffect(() => {
    if (!current.current) return undefined; // dev server: no hashed bundle
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch("/?v=" + Date.now(), { cache: "no-store" });
        if (!r.ok) return;
        const latest = entryScriptFromHtml(await r.text());
        if (stop || !isNewer(current.current, latest)) return;
        if (document.visibilityState === "hidden") window.location.reload();
        else setReady(true);
      } catch (_) { /* offline: try again later */ }
    };
    const t = setInterval(check, CHECK_MS);
    const onVis = () => { check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 10000, background: "#d4af37", color: "#111", padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
      A new version of aibetbuilder is out.
      <button onClick={() => window.location.reload()} style={{ background: "#111", color: "#d4af37", border: 0, borderRadius: 6, padding: "6px 14px", fontWeight: 700, cursor: "pointer" }}>Reload</button>
    </div>
  );
}
