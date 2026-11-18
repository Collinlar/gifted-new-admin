"use client";

import { useRef, useState } from "react";
import { ImagePlus, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { uploadFile } from "@/lib/upload";
import type { AssessmentMedia } from "@/lib/assessmentMedia";

export default function MediaGalleryField({ label, value, onChange, compact = false }: {
  label: string; value: AssessmentMedia[]; onChange: (media: AssessmentMedia[]) => void; compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const media = Array.isArray(value) ? value : [];
  const patch = (index: number, next: Partial<AssessmentMedia>) =>
    onChange(media.map((item, i) => i === index ? { ...item, ...next } : item));
  const addBlank = () => onChange([...media, { url: "" }]);
  const upload = async (files: File[]) => {
    setError("");
    const invalid = files.find(file => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024);
    if (invalid) return setError("Use PNG, JPG, GIF, SVG or WebP images no larger than 5MB each.");
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(async file => ({
        url: await uploadFile(file), alt: file.name.replace(/\.[^.]+$/, ""),
      })));
      onChange([...media.filter(item => item.url), ...uploaded]);
    } catch (e) { setError(e instanceof Error ? e.message : "The images did not upload."); }
    finally { setUploading(false); }
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <label className={`${compact ? "text-xs text-muted" : "text-sm text-ink"} font-medium`}>{label}</label>
      <div className="flex gap-2">
        <button type="button" onClick={addBlank} className="text-xs font-semibold text-primary flex items-center gap-1 min-h-11 px-2">
          <Link2 size={12} /> Add link
        </button>
        <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
          className="text-xs font-semibold text-primary flex items-center gap-1 min-h-11 px-2 disabled:opacity-60">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} Upload images
        </button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => {
      const files = [...(e.target.files || [])]; if (files.length) upload(files); e.target.value = "";
    }} />
    {media.length === 0 && <button type="button" onClick={addBlank}
      className="w-full border-2 border-dashed border-border rounded-lg min-h-16 text-sm text-muted hover:border-primary/50">
      <Plus size={14} className="inline mr-1" /> Add the first image
    </button>}
    <div className="space-y-3">
      {media.map((item, index) => <div key={`${item.url}-${index}`} className="border border-border rounded-lg p-3 grid sm:grid-cols-[7rem_1fr_auto] gap-3 items-start">
        <div className="h-24 bg-surface rounded border border-border flex items-center justify-center overflow-hidden">
          {item.url ? <img src={item.url} alt={item.alt || item.title || ""} className="w-full h-full object-contain" /> : <ImagePlus size={18} className="text-subtle" />}
        </div>
        <div className="space-y-2">
          <input value={item.url} onChange={e => patch(index, { url: e.target.value })} placeholder="https://..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          <input value={item.title || ""} onChange={e => patch(index, { title: e.target.value })}
            placeholder="Caption or description shown below the image"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="button" aria-label="Remove image" onClick={() => onChange(media.filter((_, i) => i !== index))}
          className="min-w-11 min-h-11 flex items-center justify-center text-danger"><Trash2 size={15} /></button>
      </div>)}
    </div>
    {error && <p className="text-xs text-danger">{error}</p>}
  </div>;
}
