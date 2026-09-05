import { useState } from "react";
import {
  absoluteShareUrl,
  copyTextToClipboard,
  shareOrDownloadCard,
} from "./shareCard";

const btn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  minHeight: 32,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "'DM Sans', sans-serif",
  background: "rgba(255,255,255,0.06)",
  color: "#d1d5db",
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
};

export default function ShareCardActions({
  tab,
  cardId = null,
  lockId = null,
  model = null,
  showImage = true,
  origin,
}) {
  const [status, setStatus] = useState("");
  const url = absoluteShareUrl({
    origin: origin || (typeof window !== "undefined" ? window.location.origin : ""),
    tab,
    cardId,
    lockId,
  });

  const flash = (msg) => {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? "" : s)), 1600);
  };

  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const result = await copyTextToClipboard(url);
      flash(result === "copied" ? "Copied" : "Copy failed");
    } catch (_) {
      flash("Copy failed");
    }
  };

  const onImage = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!model) return;
    try {
      const result = await shareOrDownloadCard({ model, url, title: model.badge });
      flash(result === "shared" ? "Shared" : result === "downloaded" ? "Saved PNG" : "Share failed");
    } catch (_) {
      flash("Share failed");
    }
  };

  return (
    <div
      data-share-actions="true"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
    >
      <button type="button" onClick={onCopy} style={btn} title={url}>Copy link</button>
      {showImage && model && (
        <button type="button" onClick={onImage} style={btn} title="Download or share a PNG card">
          Share image
        </button>
      )}
      {status && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>{status}</span>}
    </div>
  );
}
