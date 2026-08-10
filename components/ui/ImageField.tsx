"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X, Link2, Type } from "lucide-react";
import { uploadFile } from "@/lib/upload";

interface Props {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  placeholder?: string;
  /** Compact layout for tight spaces such as an inline question editor. */
  compact?: boolean;
  /**
   * Optional caption. Pass both to show a title box under the image: it is
   * printed beneath the picture for students and doubles as the alt text, so
   * anyone using a screen reader is not left with an unlabelled diagram.
   */
  title?: string;
  onTitleChange?: (title: string) => void;
}

// One image, two ways to supply it.
//
// Paste a link, or upload a file and get a link back. Both produce the same
// thing: a URL string. Nothing downstream can tell which route was used, which
// is what keeps bulk upload unaffected. A spreadsheet fills the identical field
// with the identical kind of value.
export default function ImageField({
  value, onChange, label = "Image", placeholder = "https://...", compact,
  title, onTitleChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image. Pick a PNG, JPG or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("That image is over 5MB. Compress it and try again.");
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadFile(file));
    } catch (e) {
      // Show what storage actually said. "Check your connection" is wrong and
      // unhelpful when the real problem is a missing bucket.
      setError(e instanceof Error ? e.message : "The image did not upload. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label className={`font-medium text-muted flex items-center gap-1 ${compact ? "text-xs" : "text-sm text-ink"}`}>
          <Link2 size={11} /> {label}
        </label>
      )}

      <div className="flex gap-2">
        <input
          value={value || ""}
          onChange={(e) => { onChange(e.target.value); setError(""); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload an image instead of pasting a link"
          className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-border text-xs font-semibold text-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-60"
        >
          {uploading
            ? <><Loader2 size={13} className="animate-spin" /> Uploading...</>
            : <><ImagePlus size={13} /> Upload</>}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {value && (
        <>
          <div className="flex items-start gap-2 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt={title || ""}
              className="h-16 w-auto max-w-[8rem] object-contain rounded border border-border bg-surface"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <button
              type="button"
              onClick={() => { onChange(""); onTitleChange?.(""); setError(""); }}
              className="flex items-center gap-1 text-xs text-danger hover:underline mt-1"
            >
              <X size={11} /> Remove
            </button>
          </div>

          {onTitleChange && (
            <div className="space-y-1 pt-1">
              <label className="text-xs font-medium text-muted flex items-center gap-1">
                <Type size={11} /> Image title
                <span className="font-normal">(shown under the picture)</span>
              </label>
              <input
                value={title || ""}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="e.g. Figure 1: the factor tree of 2023"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
