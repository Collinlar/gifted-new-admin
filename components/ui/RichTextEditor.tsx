"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Bold, Italic, List, ListOrdered } from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Write content here...",
  minHeight = 150,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  // null sentinel means "DOM not yet initialised" — ensures the first mount always
  // writes value into the contentEditable even when value is non-empty.
  const lastHtml = useRef<string | null>(null);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    if (ref.current && value !== lastHtml.current) {
      ref.current.innerHTML = value || "";
      lastHtml.current = value;
      setEmpty(!value || value === "<br>");
    }
  }, [value]);

  const exec = useCallback(
    (cmd: string, arg?: string) => {
      document.execCommand(cmd, false, arg);
      if (ref.current) {
        const html = ref.current.innerHTML;
        lastHtml.current = html;
        setEmpty(!html || html === "<br>");
        onChange(html);
      }
      ref.current?.focus();
    },
    [onChange]
  );

  const handleInput = useCallback(() => {
    if (ref.current) {
      const html = ref.current.innerHTML;
      lastHtml.current = html;
      setEmpty(!html || html === "<br>");
      onChange(html);
    }
  }, [onChange]);

  return (
    <div className="border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-primary/30 focus-within:border-primary transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-surface border-b border-border flex-wrap">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
          className="p-1.5 rounded hover:bg-border text-muted hover:text-ink transition-colors"
          title="Bold"
        >
          <Bold size={13} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
          className="p-1.5 rounded hover:bg-border text-muted hover:text-ink transition-colors"
          title="Italic"
        >
          <Italic size={13} />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h2"); }}
          className="px-2 py-1 rounded hover:bg-border text-xs font-bold text-muted hover:text-ink transition-colors"
        >
          H1
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h3"); }}
          className="px-2 py-1 rounded hover:bg-border text-xs font-semibold text-muted hover:text-ink transition-colors"
        >
          H2
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
          className="p-1.5 rounded hover:bg-border text-muted hover:text-ink transition-colors"
          title="Bullet list"
        >
          <List size={13} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
          className="p-1.5 rounded hover:bg-border text-muted hover:text-ink transition-colors"
          title="Numbered list"
        >
          <ListOrdered size={13} />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec("removeFormat"); }}
          className="px-2 py-1 rounded hover:bg-border text-xs text-muted hover:text-ink transition-colors"
          title="Clear formatting"
        >
          Clear
        </button>
      </div>

      {/* Editable area */}
      <div className="relative">
        {empty && (
          <div
            className="absolute inset-0 p-3 text-sm text-gray-300 pointer-events-none select-none"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          className="p-3 text-sm focus:outline-none prose prose-sm max-w-none"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}
