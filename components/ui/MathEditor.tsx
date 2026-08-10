"use client";

import { useRef, useState, useCallback } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { uploadFile } from "@/lib/upload";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
}

// Inline styles rather than classes: this HTML is rendered raw on the student
// side, where the admin stylesheet does not apply.
const IMG_STYLE = "max-width:100%;height:auto;display:block;margin:8px 0;border-radius:6px";

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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const insertHtmlAtCursor = useCallback((html: string) => {
    if (mode === "html") {
      const el = areaRef.current;
      if (!el) { onChange(value + html); return; }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      onChange(value.slice(0, start) + html + value.slice(end));
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + html.length;
        el.focus();
      });
      return;
    }

    const el = divRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      onChange(value + html);
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const frag = range.createContextualFragment(html);
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.setEndAfter(last);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    onChange(el.innerHTML);
  }, [mode, value, onChange]);

  const uploadAndInsert = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("That file is not an image. Pick a PNG, JPG or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("That image is over 5MB. Compress it and try again.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const url = await uploadFile(file);
      insertHtmlAtCursor(`<img src="${url}" alt="" style="${IMG_STYLE}" />`);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "The image did not upload. Try again.");
    } finally {
      setUploading(false);
    }
  }, [insertHtmlAtCursor]);

  // Most people screenshot a diagram rather than saving it as a file first,
  // so pasting straight from the clipboard needs to work.
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    uploadAndInsert(file);
  }, [uploadAndInsert]);

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
        <div className="flex flex-wrap items-center gap-1">
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

          <span className="w-px h-5 bg-border mx-1" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-semibold border border-primary/30 bg-primary-light text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-60"
          >
            {uploading
              ? <><Loader2 size={11} className="animate-spin" /> Adding your image...</>
              : <><ImagePlus size={11} /> Add image</>
            }
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAndInsert(f);
              e.target.value = "";
            }}
          />
        </div>

        {uploadError && (
          <p className="text-xs text-danger bg-red-50 rounded px-2 py-1">{uploadError}</p>
        )}
      </div>

      {/* Editor area */}
      {mode === "rich" ? (
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleRichInput}
          onPaste={handlePaste}
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
          onPaste={handlePaste}
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
