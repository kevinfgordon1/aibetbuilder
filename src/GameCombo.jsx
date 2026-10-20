import React, { useState, useRef, useEffect, useMemo } from "react";

// Searchable game picker. Same value/onChange contract as the old <select>:
// onChange receives the selected option value ("" for none).
export function gameSearchText(g, label) {
  return [label, g && g.key, g && g.sportLabel, g && g.sport, g && g.title, g && g.date]
    .filter(Boolean).join(" ").toLowerCase();
}

export function filterGameOptions(options, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter((o) => terms.every((t) => o.search.includes(t)));
}

export default function GameCombo({ value, onChange, options, placeholder = "— game —" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => filterGameOptions(options, q), [options, q]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    const el = listRef.current && listRef.current.children[hi];
    if (open && el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (v) => { onChange(v); setOpen(false); setQ(""); inputRef.current && inputRef.current.blur(); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && filtered[hi]) pick(filtered[hi].value); else setOpen(true); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQ(""); }
  };

  return (
    <div className="gcombo" ref={wrapRef}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        data-testid="game-search"
        value={open ? q : (selected ? selected.label : "")}
        placeholder={open ? "Search team, league, code, date…" : placeholder}
        onFocus={() => { setOpen(true); setQ(""); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      <span className="gcombo-caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="gcombo-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="gcombo-empty">No games match "{q}"</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={(i === hi ? "hi " : "") + (o.value === value ? "sel" : "")}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
            >{o.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
