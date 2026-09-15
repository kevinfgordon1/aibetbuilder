import { useState } from "react";
import { bookInitials } from "./oddsBoard.js";

export default function BookMark({ book, extra = 0, title, size = 13 }) {
  const [logoError, setLogoError] = useState(false);
  if (!book) return null;
  const showLogo = book.logo && !logoError;
  const initials = bookInitials(book.label);
  return (
    <span
      title={title || book.label}
      data-book-mark={book.key}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle", flexShrink: 0 }}
    >
      {showLogo ? (
        <img
          src={book.logo}
          alt=""
          width={size}
          height={size}
          style={{
            borderRadius: 3,
            display: "block",
            background: book.bg || "rgba(255,255,255,0.08)",
            objectFit: "contain",
          }}
          onError={() => setLogoError(true)}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            borderRadius: 3,
            background: book.bg,
            color: book.color,
            fontSize: Math.max(8, Math.round(size * 0.58)),
            fontWeight: 800,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            fontFamily: "'DM Sans', sans-serif",
            letterSpacing: -0.3,
          }}
        >
          {initials}
        </span>
      )}
      {extra > 0 && (
        <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>+{extra}</span>
      )}
    </span>
  );
}
