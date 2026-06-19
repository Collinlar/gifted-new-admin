"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import SlidePanel from "@/components/ui/SlidePanel";
import RichTextEditor from "@/components/ui/RichTextEditor";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Edit2, Check, X, Plus, Trash2, Upload, ExternalLink,
  ChevronUp, ChevronDown, Lock, Video, FileText, Image as ImageIcon,
  Link as LinkIcon, BookOpen, Layers, Zap, Target, FileQuestion,
} from "lucide-react";
import api from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type StepType = "lesson" | "assessment" | "practice" | "flashcard_set" | "contest";
type ContentFormat = "video" | "pdf" | "image" | "link" | "text";

interface ContentItem {
  id: string;
  type: ContentFormat;
  url?: string;
  body?: string;
  title?: string;
}

interface Step {
  id: string;
  position: number;
  type: StepType;
  title: string;
  description?: string;
  required: boolean;
  unlock_after?: string | null;
  duration?: string;
  content_items?: ContentItem[];
  // Legacy single-format fields (kept for backward-compat reading only)
  content_format?: ContentFormat;
  video?: string;
  file?: string;
  image?: string;
  resources?: string;
  body?: string;
  // Reference fields (assessment / practice / contest / flashcard_set)
  content_id?: string;
  content_title?: string;
}

interface Course {
  _id: string;
  id?: string;
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
  steps?: Step[];
  publish?: boolean;
  featured?: boolean;
  thumbnail?: string;
  grade?: string | string[];
  [key: string]: unknown;
}

interface ExamOption    { id: string; title: string; mode?: string; numberOfQuestions?: number; number_of_questions?: number; time?: number; }
interface ContestOption { id: string; title: string; numberOfQuestions?: number; number_of_questions?: number; }
interface FcGroup       { id: string; subject: string; grade: string; trackId: string; count: number; }

// ── Helpers ────────────────────────────────────────────────────────────────────

const genId = () => `s_${Math.random().toString(36).slice(2, 9)}`;

// The admin API cam() recursively converts JSONB step keys to camelCase.
// This undoes that so steps are always stored and read in snake_case.
function normalizeStep(s: Record<string, unknown>): Step {
  // Normalize content_items / contentItems (may also be camelCase'd by cam())
  const rawItems = (s.content_items ?? (s as Record<string, unknown>).contentItems) as ContentItem[] | undefined;
  let contentItems: ContentItem[] | undefined = rawItems;

  if (!contentItems || contentItems.length === 0) {
    // Auto-migrate from legacy single-format fields
    const fmt = (s.content_format ?? (s as Record<string, unknown>).contentFormat) as ContentFormat | undefined;
    const video = (s.video as string) || "";
    const file  = (s.file  as string) || "";
    const image = (s.image as string) || "";
    const link  = (s.resources as string) || "";
    const body  = (s.body  as string) || "";
    if (fmt === "video" && video) contentItems = [{ id: genId(), type: "video", url: video }];
    else if (fmt === "pdf" && file) contentItems = [{ id: genId(), type: "pdf", url: file }];
    else if (fmt === "image" && image) contentItems = [{ id: genId(), type: "image", url: image }];
    else if (fmt === "link" && link) contentItems = [{ id: genId(), type: "link", url: link }];
    else if (fmt === "text" && body) contentItems = [{ id: genId(), type: "text", body }];
  }

  return {
    id:            (s.id            ?? "")                                    as string,
    position:      (s.position      ?? 0)                                     as number,
    type:          (s.type          ?? "lesson")                              as StepType,
    title:         (s.title         ?? "")                                    as string,
    description:   (s.description   ?? "")                                    as string,
    required:      (s.required      !== false),
    unlock_after:  (s.unlock_after  ?? (s as Record<string, unknown>).unlockAfter  ?? null) as string | null,
    duration:      (s.duration      ?? "")                                    as string,
    content_items: contentItems || [],
    content_id:    (s.content_id    ?? (s as Record<string, unknown>).contentId    ?? "") as string,
    content_title: (s.content_title ?? (s as Record<string, unknown>).contentTitle ?? "") as string,
  };
}

const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
};

const STEP_META: Record<StepType, { label: string; color: string; Icon: React.ElementType }> = {
  lesson:       { label: "Lesson",      color: "#185FA5", Icon: BookOpen      },
  assessment:   { label: "Assessment",  color: "#003366", Icon: FileQuestion  },
  practice:     { label: "Practice",    color: "#1D9E75", Icon: Target        },
  flashcard_set:{ label: "Flash Cards", color: "#7C3AED", Icon: Layers        },
  contest:      { label: "Contest",     color: "#E8A020", Icon: Zap           },
};

const FORMAT_META: Record<ContentFormat, { label: string; Icon: React.ElementType }> = {
  video: { label: "Video",    Icon: Video    },
  pdf:   { label: "PDF",      Icon: FileText },
  image: { label: "Image",    Icon: ImageIcon },
  link:  { label: "Link",     Icon: LinkIcon  },
  text:  { label: "Text",     Icon: FileText  },
};

const EMPTY_STEP: Partial<Step> = {
  type: "lesson", title: "", description: "", required: true, unlock_after: null,
  duration: "", content_items: [],
  content_id: "", content_title: "",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function CourseDetailsPage() {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Step state
  const [stepPanel, setStepPanel] = useState(false);
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState<Partial<Step>>({ ...EMPTY_STEP });
  const [stepSaving, setStepSaving] = useState(false);
  const [stepError, setStepError] = useState("");
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const itemFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Options for reference steps
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [contests, setContests] = useState<ContestOption[]>([]);
  const [fcGroups, setFcGroups] = useState<FcGroup[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("courseInfo");
    if (!stored) { router.push("/learning"); return; }
    const c: Course = JSON.parse(stored);
    // Normalize any camelCase step keys that may have been stored by the recursive admin cam()
    c.steps = (c.steps || []).map(s => normalizeStep(s as unknown as Record<string, unknown>));
    setCourse(c);
    resetForm(c);
    // Re-fetch from server to ensure steps are authoritative (not just localStorage cache)
    const courseId = c._id || c.id;
    if (courseId) {
      api.get(`/course/${courseId}`).then(res => {
        if (res.data.course) {
          const fresh = res.data.course as Course;
          const freshSteps = (fresh.steps || []).map(s => normalizeStep(s as unknown as Record<string, unknown>));
          const merged: Course = { ...c, ...fresh, steps: freshSteps };
          setCourse(merged);
          localStorage.setItem("courseInfo", JSON.stringify(merged));
        }
      }).catch(() => {});
    }
  }, [router]);

  const loadOptions = async () => {
    if (optionsLoaded) return;
    try {
      const res = await api.get("/course-step-options");
      setExams(res.data.exams || []);
      setContests(res.data.contests || []);
      setFcGroups(res.data.flashcardGroups || []);
      setOptionsLoaded(true);
    } catch {
      // non-fatal
    }
  };

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
      await api.put(`/update-course/${course._id}`, payload);
      // Preserve local steps — res.data.course has camelCase step keys from recursive cam()
      const updated: Course = { ...course, ...(payload as Partial<Course>) };
      setCourse(updated);
      localStorage.setItem("courseInfo", JSON.stringify(updated));
      setEditing(false);
    } catch {
      setSaveError("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const persistSteps = async (steps: Step[]) => {
    if (!course) return;
    await api.put(`/update-course/${course._id}`, { steps });
    // Use the local steps array — the API response has camelCase keys from recursive cam()
    // which would corrupt JSONB fields (content_format → contentFormat) on the next read.
    const updated = { ...course, steps };
    setCourse(updated);
    localStorage.setItem("courseInfo", JSON.stringify(updated));
    return updated;
  };

  const openAddStep = async () => {
    await loadOptions();
    setEditingStepIdx(null);
    setStepForm({ ...EMPTY_STEP, id: genId(), position: (course?.steps || []).length });
    setStepError("");
    setStepPanel(true);
  };

  const openEditStep = async (idx: number) => {
    await loadOptions();
    const s = course?.steps?.[idx];
    if (!s) return;
    setEditingStepIdx(idx);
    setStepForm({ ...EMPTY_STEP, ...s });
    setStepError("");
    setStepPanel(true);
  };

  const saveStep = async () => {
    if (!stepForm.title?.trim()) { setStepError("Give this step a title."); return; }
    setStepSaving(true);
    try {
      const steps = [...(course?.steps || [])];
      const clean: Step = {
        id: stepForm.id || genId(),
        position: stepForm.position ?? steps.length,
        type: stepForm.type || "lesson",
        title: stepForm.title!,
        description: stepForm.description || "",
        required: stepForm.required !== false,
        unlock_after: stepForm.unlock_after || null,
        duration: stepForm.duration || "",
        content_items: stepForm.content_items || [],
        content_id: stepForm.content_id || "",
        content_title: stepForm.content_title || "",
      };
      if (editingStepIdx !== null) {
        steps[editingStepIdx] = clean;
      } else {
        steps.push(clean);
      }
      const reordered = steps.map((s, i) => ({ ...s, position: i }));
      await persistSteps(reordered);
      setStepPanel(false);
    } catch {
      setStepError("Could not save step. Try again.");
    } finally {
      setStepSaving(false);
    }
  };

  // ── Content item helpers ────────────────────────────────────────────────────

  const addContentItem = (type: ContentFormat) => {
    const item: ContentItem = { id: genId(), type };
    setStepForm(f => ({ ...f, content_items: [...(f.content_items || []), item] }));
  };

  const updateContentItem = (id: string, patch: Partial<ContentItem>) => {
    setStepForm(f => ({
      ...f,
      content_items: (f.content_items || []).map(item => item.id === id ? { ...item, ...patch } : item),
    }));
  };

  const removeContentItem = (id: string) => {
    setStepForm(f => ({ ...f, content_items: (f.content_items || []).filter(item => item.id !== id) }));
  };

  const moveContentItem = (id: string, dir: -1 | 1) => {
    setStepForm(f => {
      const items = [...(f.content_items || [])];
      const idx = items.findIndex(i => i.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= items.length) return f;
      [items[idx], items[target]] = [items[target], items[idx]];
      return { ...f, content_items: items };
    });
  };

  const uploadContentItemFile = async (itemId: string, file: File) => {
    setUploadingItemId(itemId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload-file", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Upload failed");
      updateContentItem(itemId, { url: json.url });
    } catch (e) {
      setStepError(String(e));
    } finally {
      setUploadingItemId(null);
    }
  };

  const deleteStep = async (idx: number) => {
    if (!confirm("Remove this step?")) return;
    const steps = [...(course?.steps || [])];
    steps.splice(idx, 1);
    const reordered = steps.map((s, i) => ({ ...s, position: i }));
    await persistSteps(reordered);
  };

  const moveStep = async (idx: number, dir: -1 | 1) => {
    const steps = [...(course?.steps || [])];
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    [steps[idx], steps[target]] = [steps[target], steps[idx]];
    const reordered = steps.map((s, i) => ({ ...s, position: i }));
    await persistSteps(reordered);
  };


  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setSF = (k: keyof Step, v: unknown) => setStepForm((f) => ({ ...f, [k]: v }));

  const steps = course?.steps || [];

  if (!course) return null;

  return (
    <AuthGuard>
      <DashboardShell title={course.title}>
        <div className="space-y-5 max-w-3xl">

          {/* Header row */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => router.push("/learning")}>
              <ArrowLeft size={14} /> Back to courses
            </Button>
            {!editing ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Edit2 size={13} /> Edit details
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
              {/* Course overview */}
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

              {/* Learning path steps */}
              <Card
                title={`Learning path (${steps.length} step${steps.length !== 1 ? "s" : ""})`}
                padding={false}
                action={
                  <Button size="sm" onClick={openAddStep}>
                    <Plus size={13} /> Add step
                  </Button>
                }
              >
                {steps.length === 0 ? (
                  <div className="py-16 text-center">
                    <BookOpen size={24} className="text-subtle mx-auto mb-3" />
                    <p className="text-muted text-sm mb-4">No steps yet. Build the learning path by adding steps below.</p>
                    <Button size="sm" onClick={openAddStep}><Plus size={13} /> Add first step</Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {steps.map((step, idx) => {
                      const meta = STEP_META[step.type];
                      const StepIcon = meta.Icon;
                      const unlockedBy = step.unlock_after ? steps.find(s => s.id === step.unlock_after) : null;
                      return (
                        <div key={step.id} className="flex items-start gap-4 px-5 py-4 hover:bg-surface/40 transition-colors">
                          {/* Position */}
                          <div className="shrink-0 flex flex-col items-center gap-1 mt-0.5">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ backgroundColor: meta.color }}>
                              {idx + 1}
                            </div>
                            {idx < steps.length - 1 && (
                              <div className="w-px h-6 bg-border" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                                style={{ backgroundColor: meta.color }}>
                                <StepIcon size={9} /> {meta.label}
                              </span>
                              {step.required && (
                                <span className="text-[10px] font-medium text-muted border border-border px-1.5 py-0.5 rounded">Required</span>
                              )}
                              {unlockedBy && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                                  <Lock size={9} /> After: {unlockedBy.title}
                                </span>
                              )}
                            </div>
                            <p className="font-medium text-ink text-sm">{step.title}</p>
                            {step.description && <p className="text-xs text-muted mt-0.5 truncate max-w-sm">{step.description}</p>}
                            {step.duration && <p className="text-xs text-muted mt-0.5">{step.duration}</p>}
                            {step.content_title && step.type !== "lesson" && (
                              <p className="text-xs text-muted mt-0.5 italic">Linked: {step.content_title}</p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="shrink-0 flex items-center gap-1">
                            <button onClick={() => moveStep(idx, -1)} disabled={idx === 0}
                              className="p-1.5 rounded text-muted hover:text-ink disabled:opacity-30 transition-colors">
                              <ChevronUp size={13} />
                            </button>
                            <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}
                              className="p-1.5 rounded text-muted hover:text-ink disabled:opacity-30 transition-colors">
                              <ChevronDown size={13} />
                            </button>
                            <button onClick={() => openEditStep(idx)}
                              className="p-1.5 rounded text-muted hover:text-ink transition-colors">
                              <Edit2 size={12} />
                            </button>
                            <button onClick={() => deleteStep(idx)}
                              className="p-1.5 rounded text-muted hover:text-danger transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>

        {/* Step slide panel */}
        <SlidePanel open={stepPanel} onClose={() => setStepPanel(false)}
          title={editingStepIdx !== null ? "Edit step" : "Add step"} width="lg">
          <div className="space-y-5">

            {/* Type selector */}
            <div>
              <label className="text-sm font-medium text-ink block mb-2">Step type</label>
              <div className="grid grid-cols-5 gap-2">
                {(Object.entries(STEP_META) as [StepType, typeof STEP_META[StepType]][]).map(([type, meta]) => {
                  const Icon = meta.Icon;
                  const active = stepForm.type === type;
                  return (
                    <button key={type} type="button" onClick={() => setSF("type", type)}
                      className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 text-center transition-all"
                      style={{
                        borderColor: active ? meta.color : "var(--color-border)",
                        backgroundColor: active ? `${meta.color}12` : "transparent",
                      }}>
                      <Icon size={16} style={{ color: active ? meta.color : "var(--color-muted)" }} />
                      <span className="text-[10px] font-semibold leading-tight"
                        style={{ color: active ? meta.color : "var(--color-muted)" }}>
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Common fields */}
            <Input label="Step title" value={stepForm.title || ""} onChange={(e) => setSF("title", e.target.value)}
              placeholder="What will students do in this step?" />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description (optional)</label>
              <textarea value={stepForm.description || ""} onChange={(e) => setSF("description", e.target.value)}
                rows={2} placeholder="Brief context for this step..."
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" />
            </div>

            {/* Lesson-specific fields */}
            {stepForm.type === "lesson" && (
              <>
                <Input label="Duration" value={stepForm.duration || ""} onChange={(e) => setSF("duration", e.target.value)}
                  placeholder="e.g. 20 minutes" />

                {/* Multi-content blocks */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-ink">Content blocks</label>
                    <span className="text-xs text-muted">{(stepForm.content_items || []).length} block{(stepForm.content_items || []).length !== 1 ? "s" : ""}</span>
                  </div>

                  {(stepForm.content_items || []).length === 0 && (
                    <div className="border border-dashed border-border rounded-xl py-8 text-center">
                      <p className="text-xs text-muted mb-3">No content yet. Add your first block below.</p>
                    </div>
                  )}

                  {(stepForm.content_items || []).map((item, itemIdx) => {
                    const FmtIcon = FORMAT_META[item.type].Icon;
                    const isUploadingThis = uploadingItemId === item.id;
                    return (
                      <div key={item.id} className="border border-border rounded-xl p-4 space-y-3 bg-surface/30">
                        {/* Block header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            {(Object.entries(FORMAT_META) as [ContentFormat, typeof FORMAT_META[ContentFormat]][]).map(([fmt, fmeta]) => {
                              const FIcon = fmeta.Icon;
                              const active = item.type === fmt;
                              return (
                                <button key={fmt} type="button"
                                  onClick={() => updateContentItem(item.id, { type: fmt })}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border font-medium transition-colors ${
                                    active ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"
                                  }`}>
                                  <FIcon size={10} /> {fmeta.label}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button type="button" onClick={() => moveContentItem(item.id, -1)} disabled={itemIdx === 0}
                              className="p-1 rounded text-muted hover:text-ink disabled:opacity-30 transition-colors">
                              <ChevronUp size={12} />
                            </button>
                            <button type="button" onClick={() => moveContentItem(item.id, 1)}
                              disabled={itemIdx === (stepForm.content_items || []).length - 1}
                              className="p-1 rounded text-muted hover:text-ink disabled:opacity-30 transition-colors">
                              <ChevronDown size={12} />
                            </button>
                            <button type="button" onClick={() => removeContentItem(item.id)}
                              className="p-1 rounded text-muted hover:text-danger transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Block title (optional) */}
                        <input
                          value={item.title || ""}
                          onChange={(e) => updateContentItem(item.id, { title: e.target.value })}
                          placeholder="Block title (optional)"
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-colors"
                        />

                        {/* Block content by type */}
                        {(item.type === "video" || item.type === "pdf" || item.type === "image") && (
                          <div className="space-y-2">
                            <input type="file" className="hidden"
                              ref={el => { itemFileRefs.current[item.id] = el; }}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadContentItemFile(item.id, f); }}
                            />
                            <button type="button"
                              onClick={() => itemFileRefs.current[item.id]?.click()}
                              disabled={isUploadingThis}
                              className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-xs text-muted hover:border-primary hover:text-primary transition-colors w-full justify-center">
                              <Upload size={12} />
                              {isUploadingThis ? "Uploading..." : "Upload file"}
                            </button>
                            <input
                              value={item.url || ""}
                              onChange={(e) => updateContentItem(item.id, { url: e.target.value })}
                              placeholder="Or paste URL: https://..."
                              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-colors"
                            />
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline break-all">
                                <ExternalLink size={10} /> {item.url}
                              </a>
                            )}
                          </div>
                        )}

                        {item.type === "link" && (
                          <input
                            value={item.url || ""}
                            onChange={(e) => updateContentItem(item.id, { url: e.target.value })}
                            placeholder="https://..."
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-colors"
                          />
                        )}

                        {item.type === "text" && (
                          <RichTextEditor
                            key={item.id}
                            value={item.body || ""}
                            onChange={(html) => updateContentItem(item.id, { body: html })}
                            placeholder="Write lesson content here..."
                            minHeight={120}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* Add block buttons */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(Object.entries(FORMAT_META) as [ContentFormat, typeof FORMAT_META[ContentFormat]][]).map(([fmt, fmeta]) => {
                      const FIcon = fmeta.Icon;
                      return (
                        <button key={fmt} type="button" onClick={() => addContentItem(fmt)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-muted hover:border-primary hover:text-primary transition-colors bg-white">
                          <Plus size={10} /> <FIcon size={10} /> {fmeta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Assessment / Practice — pick an exam */}
            {(stepForm.type === "assessment" || stepForm.type === "practice") && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Select exam</label>
                <select value={stepForm.content_id || ""} onChange={(e) => {
                  const exam = exams.find(x => x.id === e.target.value);
                  setSF("content_id", e.target.value);
                  setSF("content_title", exam?.title || "");
                  if (!stepForm.title) setSF("title", exam?.title || "");
                }}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="">Choose an exam...</option>
                  {exams.filter(e => stepForm.type === "practice" ? (e.mode === "practice" || e.mode === "both") : true)
                    .map(e => (
                      <option key={e.id} value={e.id}>
                        {e.title}{(e.numberOfQuestions || e.number_of_questions) ? ` (${e.numberOfQuestions || e.number_of_questions} questions)` : ""}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Contest — pick a contest exam */}
            {stepForm.type === "contest" && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Select contest</label>
                <select value={stepForm.content_id || ""} onChange={(e) => {
                  const c = contests.find(c => c.id === e.target.value);
                  setSF("content_id", e.target.value);
                  setSF("content_title", c?.title || "");
                  if (!stepForm.title) setSF("title", c?.title || "");
                }}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="">Choose a contest...</option>
                  {contests.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.title}{(c.numberOfQuestions || c.number_of_questions) ? ` (${c.numberOfQuestions || c.number_of_questions} questions)` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Flashcard set — pick a group */}
            {stepForm.type === "flashcard_set" && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Select flashcard set</label>
                <select value={stepForm.content_id || ""} onChange={(e) => {
                  const grp = fcGroups.find(g => g.id === e.target.value);
                  setSF("content_id", e.target.value);
                  setSF("content_title", grp ? `${grp.subject}${grp.grade ? ` – Grade ${grp.grade}` : ""}` : "");
                  if (!stepForm.title) setSF("title", grp?.subject || "Flash Cards");
                }}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="">Choose a set...</option>
                  {fcGroups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.subject}{g.grade ? ` – Grade ${g.grade}` : ""} ({g.count} cards)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Gate / unlock settings */}
            <div className="pt-3 border-t border-border space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={stepForm.required !== false}
                  onChange={(e) => setSF("required", e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-primary" />
                <span className="text-sm text-ink">Required: student must complete this step to progress</span>
              </label>
              {steps.length > 0 && (editingStepIdx === null || editingStepIdx > 0) && (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink flex items-center gap-1.5">
                    <Lock size={13} /> Unlock after
                  </label>
                  <select value={stepForm.unlock_after || ""}
                    onChange={(e) => setSF("unlock_after", e.target.value || null)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    <option value="">No prerequisite, available immediately</option>
                    {steps
                      .filter((_, i) => editingStepIdx === null || i < editingStepIdx)
                      .map(s => <option key={s.id} value={s.id}>Step {s.position + 1}: {s.title}</option>)}
                  </select>
                </div>
              )}
            </div>

            {stepError && <p className="text-sm text-danger">{stepError}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={saveStep} disabled={stepSaving || !!uploadingItemId} className="flex-1">
                {stepSaving ? "Saving..." : editingStepIdx !== null ? "Save changes" : "Add step"}
              </Button>
              <Button variant="secondary" onClick={() => setStepPanel(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
