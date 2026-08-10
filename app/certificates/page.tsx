"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { uploadFile } from "@/lib/upload";
import {
  Plus, ArrowLeft, Trash2, Award, Eye, ImagePlus, Type, QrCode,
  Copy, Save, AlignLeft, AlignCenter, AlignRight, Bold,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Field {
  id: string;
  type: "text" | "image" | "qr";
  x: number; y: number;
  text?: string; size?: number; font?: "helvetica" | "times";
  bold?: boolean; italic?: boolean; color?: string;
  align?: "left" | "center" | "right";
  url?: string; width?: number;
}

interface Template {
  id: string; name: string; backgroundUrl?: string | null; theme: string;
  orientation: string; fields: Field[]; isActive: boolean;
}

const TOKENS = [
  ["{{candidate_name}}", "Their name"],
  ["{{exam_title}}",     "Exam name"],
  ["{{grade_band}}",     "Distinction, Merit etc"],
  ["{{score}}",          "Marks scored"],
  ["{{total}}",          "Marks available"],
  ["{{percentage}}",     "Percentage"],
  ["{{school}}",         "Their school"],
  ["{{grade}}",          "Their grade"],
  ["{{date_issued}}",    "Date issued"],
  ["{{serial}}",         "Certificate number"],
];

const SAMPLE: Record<string, string> = {
  candidate_name: "Ama Mensah", exam_title: "GH STEM Olympiad, Round 1",
  grade_band: "Distinction", score: "34", total: "40", percentage: "85%",
  school: "Achimota School", grade: "10", date_issued: "6 Aug 2026",
  serial: "SAMPLE-2026-0001",
};

const fillPreview = (s: string) =>
  String(s || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => SAMPLE[k.toLowerCase()] ?? "");

const uid = () => Math.random().toString(36).slice(2, 9);

function serverMessage(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CertificatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/certificate-templates");
      setTemplates(res.data.templates || []);
    } catch { setTemplates([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError("");
    try {
      const res = await api.post("/add-certificate-template", {
        name: "New certificate", theme: "plain", orientation: "landscape",
      });
      await load();
      setEditing(res.data.template);
    } catch (e) { setError(serverMessage(e, "Could not create the design. Try again.")); }
  };

  const duplicate = async (t: Template) => {
    try {
      const res = await api.post("/add-certificate-template", {
        name: `${t.name} copy`, theme: t.theme, orientation: t.orientation,
        backgroundUrl: t.backgroundUrl, fields: t.fields,
      });
      await load();
      setEditing(res.data.template);
    } catch (e) { setError(serverMessage(e, "Could not copy that design.")); }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete "${t.name}"? Certificates already issued with it keep working.`)) return;
    try {
      await api.delete(`/delete-certificate-template/${t.id}`);
      load();
    } catch (e) { setError(serverMessage(e, "Could not delete that design.")); }
  };

  if (editing) {
    return <TemplateEditor template={editing} onBack={() => { setEditing(null); load(); }} />;
  }

  return (
    <AuthGuard>
      <DashboardShell title="Certificates">
        <div className="space-y-4 max-w-5xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Designs you can attach to any exam sitting. Upload your own artwork or start from the built in layout.
            </p>
            <Button size="sm" onClick={create}><Plus size={14} /> New design</Button>
          </div>

          {error && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          {loading ? (
            <Card><Spinner text="Loading your certificate designs..." /></Card>
          ) : templates.length === 0 ? (
            <Card>
              <div className="py-16 text-center">
                <Award size={30} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No certificate designs yet.</p>
                <Button size="sm" className="mt-4" onClick={create}>
                  <Plus size={14} /> Create your first design
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((t) => (
                <div key={t.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <button onClick={() => setEditing(t)}
                    className="block w-full aspect-[297/210] bg-surface relative overflow-hidden hover:opacity-90 transition-opacity">
                    {t.backgroundUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.backgroundUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Award size={26} className="text-subtle" />
                      </div>
                    )}
                  </button>
                  <div className="p-3">
                    <p className="font-medium text-ink text-sm truncate">{t.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {(t.fields || []).length} field{(t.fields || []).length === 1 ? "" : "s"} · {t.orientation}
                    </p>
                    <div className="flex items-center gap-1 mt-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>
                      <button onClick={() => duplicate(t)} title="Make a copy"
                        className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-surface">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => remove(t)} title="Delete"
                        className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────

function TemplateEditor({ template, onBack }: { template: Template; onBack: () => void }) {
  const [name, setName] = useState(template.name);
  const [orientation, setOrientation] = useState(template.orientation || "landscape");
  const [background, setBackground] = useState(template.backgroundUrl || "");
  const [fields, setFields] = useState<Field[]>(template.fields || []);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const canvasRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const sel = fields.find((f) => f.id === selected) || null;
  const ratio = orientation === "portrait" ? 210 / 297 : 297 / 210;

  const patch = (id: string, p: Partial<Field>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true);
  };

  const addField = (type: Field["type"]) => {
    const f: Field = type === "text"
      ? { id: uid(), type, x: 50, y: 50, text: "New text", size: 18, font: "helvetica", color: "#0A0E1A", align: "center" }
      : type === "qr"
        ? { id: uid(), type, x: 88, y: 82, width: 9 }
        : { id: uid(), type, x: 50, y: 70, width: 15, url: "" };
    setFields((prev) => [...prev, f]);
    setSelected(f.id);
    setDirty(true);
  };

  // Drag to position. Percentages of the canvas, so the layout holds at any
  // zoom and at the real print size.
  const onPointerDown = (e: React.PointerEvent, f: Field) => {
    e.preventDefault();
    setSelected(f.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id: f.id,
      dx: ((e.clientX - rect.left) / rect.width) * 100 - f.x,
      dy: ((e.clientY - rect.top) / rect.height) * 100 - f.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100 - d.dx));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100 - d.dy));
    patch(d.id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const save = async () => {
    setError(""); setSaving(true);
    try {
      await api.put(`/update-certificate-template/${template.id}`, {
        name, orientation, backgroundUrl: background || null, fields,
      });
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(serverMessage(e, "Could not save this design. Try again."));
    } finally { setSaving(false); }
  };

  const preview = async () => {
    try {
      const res = await api.post("/preview-certificate",
        { fields, backgroundUrl: background || null, orientation },
        { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(serverMessage(e, "Could not build the preview. Try again."));
    }
  };

  const pickBackground = async (file: File) => {
    setUploading(true); setError("");
    try { setBackground(await uploadFile(file)); setDirty(true); }
    catch (e) { setError(e instanceof Error ? e.message : "That image did not upload. Try again."); }
    finally { setUploading(false); }
  };

  return (
    <AuthGuard>
      <DashboardShell title="Certificate design">
        <div className="space-y-4 pb-16">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => {
              if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
              onBack();
            }}>
              <ArrowLeft size={14} /> All designs
            </Button>
            <div className="flex items-center gap-2">
              {savedAt && !dirty && <span className="text-xs text-muted">Saved at {savedAt}</span>}
              {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
              <Button size="sm" variant="secondary" onClick={preview}><Eye size={13} /> Preview PDF</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save size={13} /> {saving ? "Saving your design..." : "Save design"}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">

            {/* Canvas */}
            <Card padding={false}>
              <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="secondary" onClick={() => addField("text")}><Type size={13} /> Text</Button>
                <Button size="sm" variant="secondary" onClick={() => imgRef.current?.click()}>
                  <ImagePlus size={13} /> {uploading ? "Uploading..." : "Image or signature"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => addField("qr")}><QrCode size={13} /> QR code</Button>
                <span className="w-px h-5 bg-border mx-1" />
                <Button size="sm" variant="secondary" onClick={() => bgRef.current?.click()}>
                  {background ? "Change artwork" : "Upload artwork"}
                </Button>
                {background && (
                  <button onClick={() => { setBackground(""); setDirty(true); }}
                    className="text-xs text-danger hover:underline">Remove artwork</button>
                )}
              </div>

              <div className="p-4 bg-surface/40">
                <div
                  ref={canvasRef}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onClick={(e) => { if (e.target === canvasRef.current) setSelected(null); }}
                  className="relative mx-auto bg-white shadow-sm border border-border overflow-hidden select-none"
                  // containerType makes cqw resolve against this canvas, so a
                  // font size in PDF points previews at its true relative size
                  // whatever the screen width.
                  style={{ aspectRatio: String(ratio), maxWidth: "100%", containerType: "inline-size" }}
                >
                  {background && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={background} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                  )}

                  {fields.map((f) => {
                    const isSel = f.id === selected;
                    return (
                      <div
                        key={f.id}
                        onPointerDown={(e) => onPointerDown(e, f)}
                        className={`absolute cursor-move ${isSel ? "ring-2 ring-primary ring-offset-1" : ""}`}
                        style={{
                          left: `${f.x}%`, top: `${f.y}%`,
                          transform: "translate(-50%, -50%)",
                          whiteSpace: "pre",
                          textAlign: f.align || "center",
                        }}
                      >
                        {f.type === "text" && (
                          <span style={{
                            // Sizes are in PDF points against a 297mm page, so
                            // scale to the on-screen canvas width to match print
                            fontSize: `${((f.size ?? 18) / (orientation === "portrait" ? 595 : 842)) * 100}cqw`,
                            fontFamily: f.font === "times" ? "Georgia, serif" : "Helvetica, Arial, sans-serif",
                            fontWeight: f.bold ? 700 : 400,
                            fontStyle: f.italic ? "italic" : "normal",
                            color: f.color || "#0A0E1A",
                            lineHeight: 1.25,
                          }}>
                            {fillPreview(f.text || "")}
                          </span>
                        )}
                        {f.type === "image" && (
                          f.url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={f.url} alt="" style={{ width: `${f.width ?? 15}cqw` }} className="pointer-events-none" />
                            : <div className="bg-border/60 border border-dashed border-subtle rounded px-3 py-2 text-[10px] text-muted">
                                Pick an image
                              </div>
                        )}
                        {f.type === "qr" && (
                          <div className="bg-ink" style={{ width: `${f.width ?? 9}cqw`, aspectRatio: "1" }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted text-center mt-3">
                  Drag anything to move it. Sample details are shown so you can see the real fit.
                </p>
              </div>

              <input ref={bgRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickBackground(f); e.target.value = ""; }} />
              <input ref={imgRef} type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]; e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  try {
                    const url = await uploadFile(file);
                    const f: Field = { id: uid(), type: "image", x: 50, y: 70, width: 15, url };
                    setFields((prev) => [...prev, f]); setSelected(f.id); setDirty(true);
                  } catch (err) { setError(err instanceof Error ? err.message : "That image did not upload. Try again."); }
                  finally { setUploading(false); }
                }} />
            </Card>

            {/* Inspector */}
            <div className="space-y-4">
              <Card title="Design">
                <div className="space-y-3">
                  <Input label="Name" value={name}
                    onChange={(e) => { setName(e.target.value); setDirty(true); }} />
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-ink">Paper</label>
                    <div className="flex gap-2">
                      {(["landscape", "portrait"] as const).map((o) => (
                        <button key={o} onClick={() => { setOrientation(o); setDirty(true); }}
                          className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                            orientation === o ? "bg-primary text-white border-primary"
                                              : "border-border text-muted hover:border-primary hover:text-primary"
                          }`}>
                          A4 {o}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {sel ? (
                <Card title={sel.type === "text" ? "Text" : sel.type === "qr" ? "QR code" : "Image"}
                  action={
                    <button onClick={() => { setFields((p) => p.filter((f) => f.id !== sel.id)); setSelected(null); setDirty(true); }}
                      className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50">
                      <Trash2 size={13} />
                    </button>
                  }>
                  <div className="space-y-3">
                    {sel.type === "text" && (
                      <>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-ink">Content</label>
                          <textarea value={sel.text || ""} rows={3}
                            onChange={(e) => patch(sel.id, { text: e.target.value })}
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {TOKENS.map(([tok, label]) => (
                            <button key={tok} title={label}
                              onClick={() => patch(sel.id, { text: (sel.text || "") + tok })}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-border text-muted hover:border-primary hover:text-primary">
                              {tok.replace(/[{}]/g, "")}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-muted">Size</label>
                            <input type="number" value={sel.size ?? 18}
                              onChange={(e) => patch(sel.id, { size: Number(e.target.value) || 18 })}
                              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted">Colour</label>
                            <input type="color" value={sel.color || "#0A0E1A"}
                              onChange={(e) => patch(sel.id, { color: e.target.value })}
                              className="w-full h-[34px] border border-border rounded-lg px-1 cursor-pointer" />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs text-muted">Typeface</label>
                          <div className="flex gap-1">
                            {(["helvetica", "times"] as const).map((ft) => (
                              <button key={ft} onClick={() => patch(sel.id, { font: ft })}
                                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border ${
                                  (sel.font || "helvetica") === ft ? "bg-primary text-white border-primary" : "border-border text-muted"
                                }`}
                                style={{ fontFamily: ft === "times" ? "Georgia, serif" : "Helvetica, sans-serif" }}>
                                {ft === "times" ? "Serif" : "Sans"}
                              </button>
                            ))}
                            <button onClick={() => patch(sel.id, { bold: !sel.bold })}
                              className={`px-2.5 py-1.5 rounded-lg border ${sel.bold ? "bg-primary text-white border-primary" : "border-border text-muted"}`}>
                              <Bold size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs text-muted">Alignment</label>
                          <div className="flex gap-1">
                            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
                              <button key={a} onClick={() => patch(sel.id, { align: a })}
                                className={`flex-1 py-1.5 rounded-lg border flex items-center justify-center ${
                                  (sel.align || "center") === a ? "bg-primary text-white border-primary" : "border-border text-muted"
                                }`}>
                                <Icon size={13} />
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {(sel.type === "image" || sel.type === "qr") && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted">Size, as a share of the page width</label>
                        <input type="range" min={3} max={60} value={sel.width ?? 15}
                          onChange={(e) => patch(sel.id, { width: Number(e.target.value) })}
                          className="w-full" />
                        <p className="text-xs text-muted">{sel.width ?? 15}%</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                      <div className="space-y-1">
                        <label className="text-xs text-muted">Across</label>
                        <input type="number" value={sel.x}
                          onChange={(e) => patch(sel.id, { x: Number(e.target.value) })}
                          className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted">Down</label>
                        <input type="number" value={sel.y}
                          onChange={(e) => patch(sel.id, { y: Number(e.target.value) })}
                          className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary" />
                      </div>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card>
                  <p className="text-sm text-muted text-center py-6">
                    Pick something on the certificate to change it, or add a new piece from the toolbar.
                  </p>
                </Card>
              )}

              <Card title={`Everything on this design (${fields.length})`} padding={false}>
                <div className="divide-y divide-border max-h-56 overflow-y-auto">
                  {fields.map((f) => (
                    <button key={f.id} onClick={() => setSelected(f.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface transition-colors ${
                        f.id === selected ? "bg-primary-light/50" : ""
                      }`}>
                      {f.type === "text" ? <Type size={12} className="text-muted shrink-0" />
                        : f.type === "qr" ? <QrCode size={12} className="text-muted shrink-0" />
                        : <ImagePlus size={12} className="text-muted shrink-0" />}
                      <span className="truncate text-ink">
                        {f.type === "text" ? (f.text || "Empty text") : f.type === "qr" ? "Verification QR" : "Image"}
                      </span>
                    </button>
                  ))}
                  {fields.length === 0 && (
                    <p className="px-3 py-6 text-sm text-muted text-center">Nothing on the certificate yet.</p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
