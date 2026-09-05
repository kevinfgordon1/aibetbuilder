import { useEffect, useMemo, useState } from "react";
import WhatsNewModal from "./WhatsNewModal";
import {
  normalizeAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
} from "./whatsNew";

export default function WhatsNewComposer({
  client,
  current,
  onPublished,
  onUnpublished,
}) {
  const live = normalizeAnnouncement(current);
  const [title, setTitle] = useState(live?.title || "");
  const [body, setBody] = useState(live?.body || "");
  const [ctaLabel, setCtaLabel] = useState((live && live.cta && live.cta.label) || "");
  const [ctaHref, setCtaHref] = useState((live && live.cta && live.cta.href) || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!live) return;
    setTitle(live.title || "");
    setBody(live.body || "");
    setCtaLabel((live.cta && live.cta.label) || "");
    setCtaHref((live.cta && live.cta.href) || "");
  }, [live && live.id]);

  const draft = useMemo(
    () => ({ title, body, ctaLabel, ctaHref }),
    [title, body, ctaLabel, ctaHref],
  );

  const previewAnnouncement = useMemo(() => normalizeAnnouncement({
    id: (live && live.id) || "preview",
    title,
    body,
    cta_label: ctaLabel,
    cta_href: ctaHref,
    enabled: true,
  }), [live, title, body, ctaLabel, ctaHref]);

  const canPublish = !!(title.trim() && body.trim() && !busy);

  const publish = async () => {
    setBusy(true);
    setError("");
    setFlash("");
    const result = await publishAnnouncement(client, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error && result.error.message ? result.error.message : "Could not publish.");
      return;
    }
    setFlash("Published — signed-in users will see this once.");
    if (onPublished) onPublished(result.announcement);
  };

  const unpublish = async () => {
    setBusy(true);
    setError("");
    setFlash("");
    const result = await unpublishAnnouncement(client);
    setBusy(false);
    if (!result.ok) {
      setError(result.error && result.error.message ? result.error.message : "Could not unpublish.");
      return;
    }
    setFlash("Unpublished — the popup will not show.");
    if (onUnpublished) onUnpublished();
  };

  return (
    <div className="card" data-whats-new-composer="true">
      <h3>What’s New</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Type a title and body, then publish. Signed-in users see it once until Got it.
        Publish again to show a new one. Unpublish stops the popup for anyone who has not seen it yet.
      </p>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="wn-title">Title</label>
        <input
          id="wn-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What’s new"
        />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="wn-body">Body</label>
        <textarea
          id="wn-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What should people know?"
          rows={5}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <label htmlFor="wn-cta-label">Button label (optional)</label>
          <input
            id="wn-cta-label"
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Open Profile"
          />
        </div>
        <div>
          <label htmlFor="wn-cta-href">Button link (optional)</label>
          <input
            id="wn-cta-href"
            value={ctaHref}
            onChange={(e) => setCtaHref(e.target.value)}
            placeholder="#profile"
          />
        </div>
      </div>
      <div className="muted" style={{ marginBottom: 12 }}>
        {live && live.enabled
          ? `Live now · ${live.id}`
          : "No live announcement."}
      </div>
      {error ? <div className="muted" style={{ color: "#f87171", marginBottom: 12 }}>{error}</div> : null}
      {flash ? <div className="muted" style={{ marginBottom: 12 }}>{flash}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" className="btn primary" disabled={!canPublish} onClick={publish}>
          {busy ? "Working…" : "Publish"}
        </button>
        <button type="button" className="btn" disabled={busy || !(live && live.enabled)} onClick={unpublish}>
          Unpublish
        </button>
        <button
          type="button"
          className="btn"
          disabled={!title.trim() && !body.trim()}
          onClick={() => setPreviewOpen(true)}
        >
          Preview
        </button>
      </div>
      {previewOpen && previewAnnouncement ? (
        <WhatsNewModal
          announcement={previewAnnouncement}
          onDismiss={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
