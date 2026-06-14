"use client";

import { useRef, useState, useCallback } from "react";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
}

const SYMBOLS_ROW1 = [
  "α","β","γ","Δ","θ","λ","π","Σ","∫","∞","√","≈","≠","≤","≥","·","×","÷","±",
];
const SYMBOLS_ROW2 = [
  "∂","∇","∈","∉","∪","∩","⊂","⊆","⊇",
];

const TEMPLATES: { label: string; insert: string }[] = [
  { label: "Fraction",    insert: "\\frac{a}{b}" },
  { label: "Power",       insert: "x^{n}" },
  { label: "Subscript",   insert: "x_{n}" },
  { label: "Limit",       insert: "\\lim_{x\\to\\infty}" },
  { label: "Sum",         insert: "\\sum_{i=1}^{n}" },
  { label: "Integral",    insert: "\\int_{a}^{b}" },
  { label: "Matrix 2×2",  insert: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
  { label: "Vector",      insert: "\\vec{v}" },
  { label: "Casework",    insert: "\\begin{cases} a & \\text{if } x>0 \\\\ b & \\text{otherwise} \\end{cases}" },
];

const EXTRAS = ["≤","≥","≠","≈","±","·","→","↔","∴","∵"];

function countWords(text: string) {
  const stripped = text.replace(/<[^>]+>/g, " ").trim();
  return stripped ? stripped.split(/\s+/).length : 0;
}
function countChars(text: string) {
  return text.replace(/<[^>]+>/g, "").length;
}

export default function MathEditor({ value, onChange, placeholder = "Type here...", rows = 4, label }: Props) {
  const [mode, setMode] = useState<"rich" | "html">("rich");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const divRef = useRef<HTMLDivElement>(null);

  const insertAtCursor = useCallback((text: string) => {
    if (mode === "html") {
      // Insert into textarea
      const el = areaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = value.slice(0, start) + text + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
      });
    } else {
      // Insert into contenteditable
      const el = divRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        // Just append
        onChange(value + text);
        return;
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
      onChange(el.innerHTML);
    }
  }, [mode, value, onChange]);

  const handleRichInput = () => {
    if (divRef.current) onChange(divRef.current.innerHTML);
  };

  const words = countWords(value);
  const chars = countChars(value);

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-white">
      {label && (
        <div className="px-4 pt-3 pb-0">
          <p className="text-sm font-medium text-ink">{label}</p>
        </div>
      )}

      {/* Stats + mode toggle */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/40">
        <span className="text-xs text-muted">
          Words: <strong className="text-ink">{words}</strong>&ensp;Chars: <strong className="text-ink">{chars}</strong>
        </span>
        <div className="flex items-center gap-0.5 bg-surface border border-border rounded-lg p-0.5">
          {(["rich", "html"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded text-xs font-semibold uppercase transition-colors ${mode === m ? "bg-primary text-white" : "text-muted hover:text-ink"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol rows */}
      <div className="px-3 py-2 border-b border-border bg-surface/20 space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {SYMBOLS_ROW1.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => insertAtCursor(s)}
              className="w-7 h-7 rounded text-sm font-medium text-ink hover:bg-primary-light hover:text-primary border border-border bg-white transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {SYMBOLS_ROW2.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => insertAtCursor(s)}
              className="w-7 h-7 rounded text-sm font-medium text-ink hover:bg-primary-light hover:text-primary border border-border bg-white transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => insertAtCursor(t.insert)}
              className="px-2.5 h-7 rounded text-xs font-medium text-body hover:bg-primary-light hover:text-primary border border-border bg-white transition-colors"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Editor area */}
      {mode === "rich" ? (
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleRichInput}
          data-placeholder={placeholder}
          className="min-h-[96px] px-4 py-3 text-sm text-ink focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-subtle"
          style={{ minHeight: `${rows * 24}px` }}
          dangerouslySetInnerHTML={{ __html: value }}
        />
      ) : (
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full px-4 py-3 text-sm text-ink font-mono focus:outline-none resize-none"
        />
      )}

      {/* Extra symbols row */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-t border-border bg-surface/20">
        {EXTRAS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => insertAtCursor(s)}
            className="w-7 h-7 rounded text-sm font-medium text-ink hover:bg-primary-light hover:text-primary border border-border bg-white transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
