"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import SlidePanel from "@/components/ui/SlidePanel";
import { useRouter } from "next/navigation";
import { ArrowLeft, Edit2, Check, X, Plus, Trash2, FileText, Video, Image as ImageIcon, BookOpen, Upload, ExternalLink } from "lucide-react";
import api from "@/lib/api";

type UploadType = "file" | "video" | "image" | "resources";

interface Module {
  title: string;
  description?: string;
  duration?: string;
  type?: UploadType;
  file?: string;
  video?: string;
  image?: string;
  resources?: string;
  [key: string]: unknown;
}

interface Course {
  _id: string;
  title: string;
  level?: string;
  program?: string | string[];
  category?: string | string[];
  cost?: string | number;
  duration?: string;
  description?: string;
  instructor?: string;
  tags?: string[];
  features?: string[];
  modules?: Module[];
  publish?: boolean;
  featured?: boolean;
  thumbnail?: string;
  grade?: string | string[];
  [key: string]: unknown;
}

const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
};

const UPLOAD_TYPES: { value: UploadType; label: string; icon: React.ElementType }[] = [
  { value: "file",      label: "File",      icon: FileText  },
  { value: "video",     label: "Video",     icon: Video     },
  { value: "image",     label: "Image",     icon: ImageIcon },
  { value: "resources", label: "Resources", icon: BookOpen  },
];

const EMPTY_MODULE: Module = { title: "", description: "", duration: "", type: "file", file: "" };

export default function CourseDetailsPage() {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Module panel
  const [modulePanel, setModulePanel] = useState(false);
  const [editingModule, setEditingModule] = useState<number | null>(null);
  const [moduleForm, setModuleForm] = useState<Module>(EMPTY_MODULE);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("courseInfo");
    if (!stored) { router.push("/learning"); return; }
    const c: Course = JSON.parse(stored);
    setCourse(c);
    resetForm(c);
  }, [router]);

  const resetForm = (c: Course) => {
    setForm({
      title: c.title || "",
      description: c.description || "",
      level: c.level || "",
      instructor: c.instructor || "",
      duration: c.duration || "",
      cost: c.cost ? String(c.cost) : "",
      program: arr(c.program).join(", "),
      category: arr(c.category).join(", "),
      grade: arr(c.grade).join(", "),
      tags: arr(c.tags).join(", "),
      features: arr(c.features).join(", "),
      publish: !!c.publish,
      featured: !!c.featured,
      thumbnail: c.thumbnail || "",
    });
  };

  const handleSave = async () => {
    if (!course?._id) return;
    setSaving(true); setSaveError("");
    try {
      const split = (v: unknown) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      const payload = {
        title: form.title, description: form.description, level: form.level,
        instructor: form.instructor, duration: form.duration, cost: form.cost,
        thumbnail: form.thumbnail,
        program: split(form.program), category: split(form.category),
        grade: split(form.grade), tags: split(form.tags), features: split(form.features),
        publish: form.publish, featured: form.featured,
      };
      const res = await api.put(`/update-course/${course._id}`, payload);
      const updated = { ...course, ...res.data.course };
      setCourse(updated);
      localStorage.setItem("courseInfo", JSON.stringify(updated));
      setEditing(false);
    } catch {
      setSaveError("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const openAddModule = () => {
    setEditingModule(null);
    setModuleForm({ ...EMPTY_MODULE });
    setUploadError("");
    setModulePanel(true);
  };

  const openEditModule = (i: number) => {
    const m = course?.modules?.[i];
    if (!m) return;
    setEditingModule(i);
    setModuleForm({ ...EMPTY_MODULE, ...m });
    setUploadError("");
    setModulePanel(true);
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true); setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload-file", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Upload failed");
      const urlKey = moduleForm.type === "video" ? "video"
        : moduleForm.type === "image" ? "image"
        : moduleForm.type === "resources" ? "resources"
        : "file";
      setModuleForm((f) => ({ ...f, [urlKey]: json.url }));
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  };

  const saveModule = async () => {
    if (!course || !moduleForm.title.trim()) { setUploadError("Module title is required."); return; }
    setSaving(true);
    try {
      const modules = [...(course.modules || [])];
      const cleanModule = Object.fromEntries(
        Object.entries(moduleForm).filter(([, v]) => v !== "" && v !== undefined && v !== null)
      ) as Module;
      if (editingModule !== null) {
        modules[editingModule] = cleanModule;
      } else {
        modules.push(cleanModule);
      }
      const res = await api.put(`/update-course/${course._id}`, { modules });
      const updated = { ...course, modules: res.data.course?.modules ?? modules };
      setCourse(updated);
      localStorage.setItem("courseInfo", JSON.stringify(updated));
      setModulePanel(false);
    } catch {
      setUploadError("Could not save module. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteModule = async (i: number) => {
    if (!course || !confirm("Remove this module?")) return;
    const modules = [...(course.modules || [])];
    modules.splice(i, 1);
    const res = await api.put(`/update-course/${course._id}`, { modules });
    const updated = { ...course, modules: res.data.course?.modules ?? modules };
    setCourse(updated);
    localStorage.setItem("courseInfo", JSON.stringify(updated));
  };

  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setMF = (k: keyof Module, v: unknown) => setModuleForm((f) => ({ ...f, [k]: v }));

  const moduleFileUrl = (m: Module) => m.file || m.video || m.image || m.resources || "";

  if (!course) return null;

  return (
    <AuthGuard>
      <DashboardShell title={course.title}>
        <div className="space-y-5 max-w-3xl">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => router.push("/learning")}>
              <ArrowLeft size={14} /> Back to courses
            </Button>
            {!editing ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Edit2 size={13} /> Edit course
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Check size={13} /> {saving ? "Saving..." : "Save changes"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { if (course) resetForm(course); setEditing(false); }}>
                  <X size={13} /> Cancel
                </Button>
              </div>
            )}
          </div>

          {saveError && <p className="text-sm text-danger bg-red-50 rounded-lg px-4 py-2">{saveError}</p>}

          {editing ? (
            <div className="space-y-4">
              <Card title="Basic info">
                <div className="space-y-4">
                  <Input label="Title" value={String(form.title || "")} onChange={setF("title")} />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Description</label>
                    <textarea value={String(form.description || "")} onChange={setF("description")} rows={4}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Instructor" value={String(form.instructor || "")} onChange={setF("instructor")} />
                    <Input label="Duration" placeholder="e.g. 4 weeks" value={String(form.duration || "")} onChange={setF("duration")} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Level" placeholder="e.g. Beginner" value={String(form.level || "")} onChange={setF("level")} />
                    <Input label="Cost (GHS)" type="number" value={String(form.cost || "")} onChange={setF("cost")} />
                  </div>
                  <Input label="Thumbnail URL" value={String(form.thumbnail || "")} onChange={setF("thumbnail")} placeholder="https://..." />
                </div>
              </Card>
              <Card title="Classification">
                <div className="space-y-4">
                  <Input label="Program (comma-separated)" value={String(form.program || "")} onChange={setF("program")} />
                  <Input label="Category (comma-separated)" value={String(form.category || "")} onChange={setF("category")} />
                  <Input label="Grade (comma-separated)" value={String(form.grade || "")} onChange={setF("grade")} />
                  <Input label="Tags (comma-separated)" value={String(form.tags || "")} onChange={setF("tags")} />
                  <Input label="Features (comma-separated)" value={String(form.features || "")} onChange={setF("features")} />
                </div>
              </Card>
              <Card title="Visibility">
                <div className="flex gap-6">
                  {(["publish", "featured"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
                        className="w-4 h-4 rounded border-border accent-primary" />
                      <span className="text-sm text-ink capitalize">{k === "publish" ? "Published" : "Featured"}</span>
                    </label>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <>
              {/* Overview */}
              <Card title="Course overview">
                {course.thumbnail && (
                  <img src={course.thumbnail} alt={course.title}
                    className="w-40 h-28 object-cover rounded-xl border border-border mb-4" />
                )}
                {course.description && <p className="text-sm text-muted mb-5">{course.description}</p>}
                <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                  {([
                    ["Level", course.level],
                    ["Program", arr(course.program).join(", ")],
                    ["Category", arr(course.category).join(", ")],
                    ["Grade", arr(course.grade).join(", ")],
                    ["Cost", course.cost ? `GHS ${course.cost}` : null],
                    ["Duration", course.duration],
                    ["Instructor", course.instructor],
                    ["Status", course.publish ? "Published" : "Draft"],
                    ["Featured", course.featured ? "Yes" : "No"],
                  ] as [string, unknown][]).filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted uppercase tracking-wide font-medium">{label}</dt>
                      <dd className="mt-0.5 text-sm text-ink">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {/* Modules */}
              <Card
                title={`${(course.modules || []).length} module${(course.modules || []).length !== 1 ? "s" : ""}`}
                padding={false}
                action={
                  <Button size="sm" onClick={openAddModule}>
                    <Plus size={13} /> Add module
                  </Button>
                }
              >
                {(course.modules || []).length === 0 ? (
                  <div className="py-12 text-center">
                    <BookOpen size={24} className="text-subtle mx-auto mb-2" />
                    <p className="text-muted text-sm">No modules yet. Add the first one.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface/50">
                        <th className="text-left px-5 py-2.5 text-muted font-medium text-xs w-8">#</th>
                        <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Title</th>
                        <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Duration</th>
                        <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Type</th>
                        <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">File</th>
                        <th className="px-5 py-2.5 w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {(course.modules || []).map((m, i) => {
                        const url = moduleFileUrl(m);
                        const TypeIcon = UPLOAD_TYPES.find((t) => t.value === m.type)?.icon || FileText;
                        return (
                          <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/40">
                            <td className="px-5 py-3 text-muted text-xs">{i + 1}</td>
                            <td className="px-5 py-3">
                              <p className="font-medium text-ink">{m.title}</p>
                              {m.description && <p className="text-xs text-muted mt-0.5 max-w-xs truncate">{m.description}</p>}
                            </td>
                            <td className="px-5 py-3 text-muted text-sm">{m.duration || "—"}</td>
                            <td className="px-5 py-3">
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                                <TypeIcon size={12} /> {m.type || "—"}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              {url ? (
                                <a href={url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                  <ExternalLink size={11} /> View
                                </a>
                              ) : <span className="text-xs text-subtle">—</span>}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5 justify-end">
                                <button onClick={() => openEditModule(i)} className="p-1.5 rounded text-muted hover:text-ink transition-colors">
                                  <Edit2 size={12} />
                                </button>
                                <button onClick={() => deleteModule(i)} className="p-1.5 rounded text-muted hover:text-danger transition-colors">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </div>

        {/* Module slide panel */}
        <SlidePanel open={modulePanel} onClose={() => setModulePanel(false)}
          title={editingModule !== null ? "Edit module" : "Add new module"} width="lg">
          <div className="space-y-4">
            <Input label="Title" value={moduleForm.title} onChange={(e) => setMF("title", e.target.value)}
              placeholder="What's this module about?" />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={moduleForm.description || ""} onChange={(e) => setMF("description", e.target.value)}
                rows={3} placeholder="Brief description of this module..."
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none" />
            </div>
            <Input label="Duration" value={moduleForm.duration || ""} onChange={(e) => setMF("duration", e.target.value)}
              placeholder="e.g. 30 minutes" />

            {/* Upload type */}
            <div>
              <label className="text-sm font-medium text-ink block mb-2">Upload type</label>
              <div className="flex gap-3 flex-wrap">
                {UPLOAD_TYPES.map(({ value, label, icon: Icon }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="uploadType" value={value}
                      checked={moduleForm.type === value}
                      onChange={() => setMF("type", value)}
                      className="accent-primary" />
                    <span className="text-sm text-ink flex items-center gap-1"><Icon size={13} /> {label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* File upload */}
            <div>
              <label className="text-sm font-medium text-ink block mb-2">Upload file</label>
              <input type="file" ref={fileRef} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
              <button onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-lg text-sm text-muted hover:border-primary hover:text-primary transition-colors w-full justify-center">
                <Upload size={14} />
                {uploading ? "Uploading..." : "Choose file"}
              </button>

              {/* Current URL */}
              {(() => {
                const urlKey = moduleForm.type === "video" ? "video"
                  : moduleForm.type === "image" ? "image"
                  : moduleForm.type === "resources" ? "resources"
                  : "file";
                const currentUrl = moduleForm[urlKey] as string | undefined;
                return currentUrl ? (
                  <a href={currentUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline break-all">
                    <ExternalLink size={11} /> {currentUrl}
                  </a>
                ) : null;
              })()}

              {/* Or paste URL directly */}
              <div className="mt-3">
                <label className="text-xs text-muted block mb-1">Or paste a URL directly</label>
                <input
                  value={(() => {
                    const k = moduleForm.type === "video" ? "video"
                      : moduleForm.type === "image" ? "image"
                      : moduleForm.type === "resources" ? "resources"
                      : "file";
                    return (moduleForm[k] as string) || "";
                  })()}
                  onChange={(e) => {
                    const k = moduleForm.type === "video" ? "video"
                      : moduleForm.type === "image" ? "image"
                      : moduleForm.type === "resources" ? "resources"
                      : "file";
                    setMF(k as keyof Module, e.target.value);
                  }}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>
            </div>

            {uploadError && <p className="text-sm text-danger">{uploadError}</p>}

            <div className="flex gap-3 pt-2">
              <Button onClick={saveModule} disabled={saving || uploading} className="flex-1">
                {saving ? "Saving..." : editingModule !== null ? "Save changes" : "Save module"}
              </Button>
              <Button variant="secondary" onClick={() => setModulePanel(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
