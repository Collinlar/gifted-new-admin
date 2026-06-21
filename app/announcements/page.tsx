"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import {
  Plus, Trash2, Edit2, Megaphone, CheckCircle, Clock,
  X, Check, Pin, BookOpen, FileQuestion, Zap, Link as LinkIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type AnnouncementType = "general" | "exam" | "contest" | "results" | "course";

interface Announcement {
  _id: string;
  id: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaLink?: string;
  targetAudience?: string;
  publishDate?: string;
  isPublished?: boolean;
  isPinned?: boolean;
  createdAt?: string;
  type?: AnnouncementType;
  contentId?: string;
  targetGrades?: string[];
  targetTracks?: string[];
  expiresAt?: string;
}

interface ContentOption { id: string; title?: string; name?: string; numberOfQuestions?: number }
interface TrackOption   { id: string; name: string }

// ── Constants ──────────────────────────────────────────────────────────────

const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));

const TYPE_META: Record<AnnouncementType, { label: string; color: string; Icon: React.ElementType; defaultCta: string }> = {
  general:  { label: "General",    color: "#4B5563", Icon: Megaphone,     defaultCta: "" },
  exam:     { label: "Assessment", color: "#185FA5", Icon: FileQuestion,  defaultCta: "Start assessment" },
  contest:  { label: "Contest",    color: "#E8A020", Icon: Zap,           defaultCta: "Enter contest" },
  results:  { label: "Results",    color: "#1D9E75", Icon: CheckCircle,   defaultCta: "View results" },
  course:   { label: "Course",     color: "#7C3AED", Icon: BookOpen,      defaultCta: "Start learning" },
};

const blank = (): Partial<Announcement> => ({
  title: "", body: "", ctaLabel: "", ctaLink: "",
  targetAudience: "All Users", publishDate: "", isPublished: false,
  isPinned: false, type: "general", contentId: "", targetGrades: [], targetTracks: [], expiresAt: "",
});

// ── Page ───────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const [items,    setItems]    = useState<Announcement[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing,  setEditing]  = useState<Announcement | null>(null);
  const [form,     setForm]     = useState<Partial<Announcement>>(blank());
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  // Content options loaded when panel opens
  const [exams,    setExams]    = useState<ContentOption[]>([]);
  const [contests, setContests] = useState<ContentOption[]>([]);
  const [courses,  setCourses]  = useState<ContentOption[]>([]);
  const [tracks,   setTracks]   = useState<TrackOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  const load = async () => {
    try {
      const res = await api.get("/all-announcements");
      setItems(res.data.announcements || res.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadOptions = async () => {
    if (optionsLoaded) return;
    try {
      const res = await api.get("/announcement-content-options");
      setExams(res.data.exams || []);
      setContests(res.data.contests || []);
      setCourses(res.data.courses || []);
      setTracks(res.data.tracks || []);
      setOptionsLoaded(true);
    } catch { /* non-fatal */ }
  };

  const openAdd = () => {
    setEditing(null); setForm(blank()); setError(""); setPanelOpen(true);
    loadOptions();
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({
      ...a,
      targetGrades: a.targetGrades || [],
      targetTracks: a.targetTracks || [],
    });
    setError(""); setPanelOpen(true);
    loadOptions();
  };

  const closePanel = () => { setPanelOpen(false); setEditing(null); setForm(blank()); };

  const sf = (key: keyof Announcement, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  // When type changes, auto-fill CTA label and clear contentId
  const setType = (t: AnnouncementType) => {
    setForm((p) => ({
      ...p,
      type: t,
      contentId: "",
      ctaLabel: p.ctaLabel || TYPE_META[t].defaultCta,
    }));
  };

  const toggleGrade = (g: string) => {
    setForm((p) => {
      const grades = p.targetGrades || [];
      return { ...p, targetGrades: grades.includes(g) ? grades.filter((x) => x !== g) : [...grades, g] };
    });
  };

  const toggleTrack = (id: string) => {
    setForm((p) => {
      const ts = p.targetTracks || [];
      return { ...p, targetTracks: ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id] };
    });
  };

  const handleSave = async () => {
    setError("");
    if (!form.title?.trim()) return setError("Give this announcement a title.");
    if (!form.body?.trim())  return setError("Add the announcement body.");
    setSaving(true);
    try {
      const payload = {
        ...form,
        expiresAt: form.expiresAt || null,
        publishDate: form.publishDate || null,
      };
      if (editing) {
        await api.put(`/update-announcement/${editing._id}`, payload);
      } else {
        await api.post("/add-announcement", payload);
      }
      await load();
      closePanel();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    await api.delete(`/delete-announcement/${id}`);
    setItems((p) => p.filter((a) => a._id !== id));
  };

  const togglePublish = async (a: Announcement) => {
    await api.put(`/update-announcement/${a._id}`, { isPublished: !a.isPublished });
    await load();
  };

  const currentType = (form.type || "general") as AnnouncementType;
  const typeMeta = TYPE_META[currentType];

  return (
    <AuthGuard>
      <DashboardShell title="Announcements">
        <div className="space-y-4 max-w-4xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Push targeted, actionable messages to users on their dashboard.
            </p>
            <Button size="sm" onClick={openAdd}><Plus size={14} /> New announcement</Button>
          </div>

          <Card padding={false}>
            {loading ? (
              <Spinner text="Loading announcements..." />
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <Megaphone size={32} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No announcements yet.</p>
                <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Create your first announcement</Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((a) => {
                  const meta = TYPE_META[(a.type || "general") as AnnouncementType] || TYPE_META.general;
                  const Icon = meta.Icon;
                  return (
                    <div key={a._id} className="px-5 py-4 flex items-start gap-4">
                      <div className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${meta.color}15` }}>
                        <Icon size={15} style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: meta.color }}>{meta.label}</span>
                          <p className="font-medium text-ink text-sm">{a.title}</p>
                          {a.isPinned && <Pin size={11} className="text-amber-500" />}
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-surface text-muted border border-border"}`}>
                            {a.isPublished ? "Published" : "Draft"}
                          </span>
                        </div>
                        <p className="text-sm text-muted line-clamp-2 mb-1">{a.body}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(a.targetGrades || []).length > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                              Grade {(a.targetGrades || []).join(", ")}
                            </span>
                          )}
                          {(a.targetGrades || []).length === 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-surface text-muted">All grades</span>
                          )}
                          {a.expiresAt && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700">
                              Expires {new Date(a.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                          {a.ctaLabel && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-primary-light text-primary">
                              CTA: {a.ctaLabel}
                            </span>
                          )}
                        </div>
                        {a.createdAt && (
                          <p className="text-xs text-subtle mt-1">{new Date(a.createdAt).toLocaleDateString()}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => togglePublish(a)} title={a.isPublished ? "Unpublish" : "Publish"}
                          className={`p-1.5 rounded-lg transition-colors ${a.isPublished ? "text-emerald-600 hover:bg-emerald-50" : "text-subtle hover:text-emerald-600 hover:bg-emerald-50"}`}>
                          {a.isPublished ? <X size={14} /> : <Check size={14} />}
                        </button>
                        <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-subtle hover:text-ink transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => handleDelete(a._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ── Form panel ── */}
        <SlidePanel open={panelOpen} onClose={closePanel}
          title={editing ? "Edit announcement" : "New announcement"} width="lg">
          <div className="space-y-5">

            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Type</label>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(TYPE_META) as [AnnouncementType, typeof TYPE_META[AnnouncementType]][]).map(([t, m]) => {
                  const Icon = m.Icon;
                  const active = currentType === t;
                  return (
                    <button key={t} type="button" onClick={() => setType(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${active ? "text-white border-transparent" : "border-border text-muted hover:border-gray-400"}`}
                      style={active ? { backgroundColor: m.color, borderColor: m.color } : {}}>
                      <Icon size={12} /> {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content picker — shows when type links to content */}
            {(currentType === "exam" || currentType === "contest" || currentType === "course") && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">
                  Linked {currentType === "exam" ? "assessment" : currentType === "contest" ? "contest" : "course"}
                </label>
                <select value={form.contentId || ""}
                  onChange={(e) => sf("contentId", e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                  <option value="">Choose one...</option>
                  {(currentType === "exam" ? exams : currentType === "contest" ? contests : courses).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title || c.name}
                      {(c as ContentOption).numberOfQuestions ? ` (${(c as ContentOption).numberOfQuestions} questions)` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Title</label>
              <input value={form.title || ""} onChange={(e) => sf("title", e.target.value)}
                placeholder="e.g. GH STEM Olympiad 2025 is now open"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
            </div>

            {/* Body */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Message</label>
              <textarea value={form.body || ""} onChange={(e) => sf("body", e.target.value)} rows={4}
                placeholder="What do you want students to know and do?"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none" />
            </div>

            {/* CTA */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Button label</label>
                <input value={form.ctaLabel || ""} onChange={(e) => sf("ctaLabel", e.target.value)}
                  placeholder={typeMeta.defaultCta || "e.g. Register now"}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink flex items-center gap-1">
                  <LinkIcon size={11} /> Custom URL
                  <span className="font-normal text-subtle">(results / external)</span>
                </label>
                <input value={form.ctaLink || ""} onChange={(e) => sf("ctaLink", e.target.value)}
                  placeholder="https://... or /route"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
            </div>

            {/* Grade targeting */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Target grades
                <span className="font-normal text-subtle ml-1">(leave empty to reach all grades)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {GRADES.map((g) => {
                  const active = (form.targetGrades || []).includes(g);
                  return (
                    <button key={g} type="button" onClick={() => toggleGrade(g)}
                      className={`px-2.5 py-1 rounded text-xs border font-medium transition-colors ${active ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"}`}>
                      Grade {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track targeting */}
            {tracks.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink">Target tracks
                  <span className="font-normal text-subtle ml-1">(leave empty to reach all tracks)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {tracks.map((t) => {
                    const active = (form.targetTracks || []).includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => toggleTrack(t.id)}
                        className={`px-2.5 py-1 rounded text-xs border font-medium transition-colors ${active ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"}`}>
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Publish date</label>
                <input type="date" value={form.publishDate || ""} onChange={(e) => sf("publishDate", e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Expiry date
                  <span className="font-normal text-subtle ml-1">(optional)</span>
                </label>
                <input type="date" value={form.expiresAt ? form.expiresAt.split("T")[0] : ""} onChange={(e) => sf("expiresAt", e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div onClick={() => sf("isPublished", !form.isPublished)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isPublished ? "bg-primary" : "bg-border"}`}>
                  <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isPublished ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm text-ink">Published</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <div onClick={() => sf("isPinned", !form.isPinned)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isPinned ? "bg-amber-500" : "bg-border"}`}>
                  <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isPinned ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm text-ink flex items-center gap-1"><Pin size={12} /> Pinned
                  <span className="font-normal text-subtle">(cannot be dismissed)</span>
                </span>
              </label>
            </div>

            {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Create announcement"}
              </Button>
              <Button variant="secondary" onClick={closePanel}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
