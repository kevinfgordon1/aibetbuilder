import { useState } from "react";

/** Logo + accessible text label. Broken / missing images hide the <img> only. */
export default function BookLabel({ book, size = 14, label }) {
  const [logoError, setLogoError] = useState(false);
  if (!book) return label || null;
  const text = label ?? book.label;
  const showLogo = Boolean(book.logo) && !logoError;
  return (
    <span
      data-book-label={book.key}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        maxWidth: "100%",
        verticalAlign: "middle",
      }}
    >
      {showLogo ? (
        <img
          src={book.logo}
          alt=""
          width={size}
          height={size}
          data-book-logo={book.key}
          style={{
            width: size,
            height: size,
            borderRadius: 3,
            display: "block",
            objectFit: "contain",
            flexShrink: 0,
            background: "rgba(255,255,255,0.92)",
            boxSizing: "border-box",
          }}
          onError={() => setLogoError(true)}
        />
      ) : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{text}</span>
    </span>
  );
}
