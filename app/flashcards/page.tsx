"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import {
  Plus, Trash2, ChevronDown, ChevronUp, BookOpen, Download,
  Edit2, Check, X, Eye, EyeOff, Star, Layers,
} from "lucide-react";
import * as XLSX from "xlsx";

interface FlashCard {
  _id: string;
  question?: string;
  answer?: string;
  difficulty?: string;
  courseId?: string;
  courseTitle?: string;
  trackId?: string;
  trackName?: string;
  grade?: string;
  subject?: string;
  publish?: boolean;
  featured?: boolean;
  createdAt?: string;
}

interface Track { _id: string; id: string; name: string; }
interface Course { id: string; title: string; }

interface EditDraft {
  question: string;
  answer: string;
  difficulty: string;
  trackId: string;
  grade: string;
  subject: string;
}

interface CardDraft {
  question: string;
  answer: string;
  difficulty: string;
}

interface TrackGroup {
  trackId: string;
  trackName: string;
  cards: FlashCard[];
}

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

function diffColor(d?: string) {
  if (!d) return "bg-surface text-muted border-border";
  const lower = d.toLowerCase();
  if (lower === "easy") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (lower === "hard") return "bg-red-50 text-red-600 border-red-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function groupByTrack(cards: FlashCard[]): TrackGroup[] {
  const map = new Map<string, TrackGroup>();
  for (const c of cards) {
    const key = c.trackId || "__none__";
    if (!map.has(key)) {
      map.set(key, {
        trackId: key,
        trackName: c.trackName || (key === "__none__" ? "No track assigned" : key),
        cards: [],
      });
    }
    map.get(key)!.cards.push(c);
  }
  return [...map.values()].sort((a, b) => {
    if (a.trackId === "__none__") return 1;
    if (b.trackId === "__none__") return -1;
    return a.trackName.localeCompare(b.trackName);
  });
}

export default function FlashCardsPage() {
  const [cards, setCards] = useState<FlashCard[]>([]);
  const [groups, setGroups] = useState<TrackGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  // Add form state
  const [selectedTrack, setSelectedTrack] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [drafts, setDrafts] = useState<CardDraft[]>([{ question: "", answer: "", difficulty: "Medium" }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    question: "", answer: "", difficulty: "Medium",
    trackId: "", grade: "", subject: "",
  });

  const load = useCallback(async () => {
    try {
      const [fcRes, trackRes, courseRes] = await Promise.all([
        api.get("/all-flashcards"),
        api.get("/all-tracks"),
        api.get("/all-courses-admin-info"),
      ]);
      const data: FlashCard[] = fcRes.data.allFlashCards || fcRes.data.flashcards || [];
      setCards(data);
      setGroups(groupByTrack(data));
      setTracks(trackRes.data.tracks || []);
      setCourses((courseRes.data.courses || []).map((c: { _id: string; id?: string; title: string }) => ({ id: c._id || c.id || "", title: c.title })));
    } catch {
      setCards([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const updateDraft = (i: number, k: keyof CardDraft, v: string) => {
    const next = [...drafts];
    next[i] = { ...next[i], [k]: v };
    setDrafts(next);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this flash card?")) return;
    await api.delete(`/delete-flashcard/${id}`);
    setCards((prev) => {
      const next = prev.filter((c) => c._id !== id);
      setGroups(groupByTrack(next));
      return next;
    });
  };

  const startEdit = (c: FlashCard) => {
    setEditingId(c._id);
    setEditDraft({
      question: c.question || "",
      answer: c.answer || "",
      difficulty: c.difficulty || "Medium",
      trackId: c.trackId || "",
      grade: c.grade || "",
      subject: c.subject || "",
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.put(`/update-flashcard/${editingId}`, {
        question: editDraft.question,
        answer: editDraft.answer,
        difficulty: editDraft.difficulty,
        trackId: editDraft.trackId || null,
        grade: editDraft.grade || null,
        subject: editDraft.subject || null,
      });
      await load();
      setEditingId(null);
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (card: FlashCard) => {
    const next = !card.publish;
    await api.put(`/update-flashcard/${card._id}`, { publish: next });
    setCards((prev) => {
      const updated = prev.map((c) => c._id === card._id ? { ...c, publish: next } : c);
      setGroups(groupByTrack(updated));
      return updated;
    });
  };

  const toggleFeatured = async (card: FlashCard) => {
    const next = !card.featured;
    await api.put(`/update-flashcard/${card._id}`, { featured: next });
    setCards((prev) => {
      const updated = prev.map((c) => c._id === card._id ? { ...c, featured: next } : c);
      setGroups(groupByTrack(updated));
      return updated;
    });
  };

  const handleSave = async () => {
    setFormError("");
    const valid = drafts.filter((d) => d.question.trim() && d.answer.trim());
    if (valid.length === 0) return setFormError("Add at least one question and answer.");
    setSaving(true);
    try {
      for (const d of valid) {
        await api.post("/add-flashcard", {
          question:  d.question.trim(),
          answer:    d.answer.trim(),
          difficulty: d.difficulty,
          trackId:   selectedTrack  || null,
          courseId:  selectedCourse || null,
          grade:     selectedGrade  || null,
          subject:   selectedSubject || null,
        });
      }
      setPanelOpen(false);
      setDrafts([{ question: "", answer: "", difficulty: "Medium" }]);
      setSelectedTrack("");
      setSelectedCourse("");
      setSelectedGrade("");
      setSelectedSubject("");
      await load();
    } catch {
      setFormError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const rows = cards.map((c, i) => ({
      "#": i + 1,
      Track:    c.trackName  || "",
      Subject:  c.subject    || "",
      Grade:    c.grade      || "",
      Question: c.question   || "",
      Answer:   c.answer     || "",
      Difficulty: c.difficulty || "",
      Published: c.publish ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Flash Cards");
    XLSX.writeFile(wb, "Gifted_FlashCards.xlsx");
  };

  const publishedTotal = cards.filter((c) => c.publish).length;

  return (
    <AuthGuard>
      <DashboardShell title="Flash Cards">
        <div className="space-y-4 max-w-4xl">
          {/* Summary + actions */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-muted">
              {cards.length} card{cards.length !== 1 ? "s" : ""} across {groups.filter(g => g.trackId !== "__none__").length} track{groups.filter(g => g.trackId !== "__none__").length !== 1 ? "s" : ""}
              {publishedTotal > 0 && <span className="ml-2 text-emerald-600">{publishedTotal} published</span>}
            </p>
            <div className="flex items-center gap-2">
              {cards.length > 0 && (
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  <Download size={14} /> Export
                </Button>
              )}
              <Button size="sm" onClick={() => setPanelOpen(true)}>
                <Plus size={14} /> Add cards
              </Button>
            </div>
          </div>

          {loading ? (
            <Spinner text="Loading flash cards..." />
          ) : groups.length === 0 ? (
            <Card padding>
              <div className="py-12 text-center">
                <Layers size={32} className="mx-auto text-muted mb-3 opacity-30" />
                <p className="text-muted text-sm">No flash cards yet.</p>
                <Button size="sm" className="mt-4" onClick={() => setPanelOpen(true)}>
                  <Plus size={14} /> Add your first cards
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const isOpen = expanded.has(group.trackId);
                const diffCounts = { Easy: 0, Medium: 0, Hard: 0 };
                let publishedCount = 0;
                group.cards.forEach((c) => {
                  const d = (c.difficulty || "Medium");
                  const key = (d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()) as keyof typeof diffCounts;
                  if (key in diffCounts) diffCounts[key]++;
                  if (c.publish) publishedCount++;
                });

                return (
                  <div key={group.trackId} className="bg-card border border-border rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggle(group.trackId)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                          <BookOpen size={14} className="text-primary" />
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-ink text-sm">{group.trackName}</p>
                          <p className="text-xs text-muted mt-0.5">
                            {group.cards.length} card{group.cards.length !== 1 ? "s" : ""}
                            {publishedCount > 0 && (
                              <span className="ml-2 text-emerald-600">{publishedCount} published</span>
                            )}
                            {publishedCount < group.cards.length && (
                              <span className="ml-1 text-muted">{group.cards.length - publishedCount} draft</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {diffCounts.Easy > 0 && (
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                            {diffCounts.Easy} easy
                          </span>
                        )}
                        {diffCounts.Medium > 0 && (
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                            {diffCounts.Medium} medium
                          </span>
                        )}
                        {diffCounts.Hard > 0 && (
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 border border-red-100">
                            {diffCounts.Hard} hard
                          </span>
                        )}
                        {isOpen
                          ? <ChevronUp size={16} className="text-muted ml-1" />
                          : <ChevronDown size={16} className="text-muted ml-1" />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border divide-y divide-border">
                        {group.cards.map((c, i) => (
                          <div key={c._id} className="px-5 py-3.5 hover:bg-surface/30 transition-colors">
                            {editingId === c._id ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-xs text-muted mb-1 font-medium uppercase tracking-wide block">Question</label>
                                    <textarea value={editDraft.question} onChange={(e) => setEditDraft((d) => ({ ...d, question: e.target.value }))}
                                      rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                                  </div>
                                  <div>
                                    <label className="text-xs text-muted mb-1 font-medium uppercase tracking-wide block">Answer</label>
                                    <textarea value={editDraft.answer} onChange={(e) => setEditDraft((d) => ({ ...d, answer: e.target.value }))}
                                      rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                  <div>
                                    <label className="text-xs text-muted mb-1 font-medium uppercase tracking-wide block">Track</label>
                                    <select value={editDraft.trackId} onChange={(e) => setEditDraft((d) => ({ ...d, trackId: e.target.value }))}
                                      className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30">
                                      <option value="">No track</option>
                                      {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs text-muted mb-1 font-medium uppercase tracking-wide block">Grade</label>
                                    <input value={editDraft.grade} onChange={(e) => setEditDraft((d) => ({ ...d, grade: e.target.value }))}
                                      placeholder="e.g. 11" className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                                  </div>
                                  <div>
                                    <label className="text-xs text-muted mb-1 font-medium uppercase tracking-wide block">Subject</label>
                                    <input value={editDraft.subject} onChange={(e) => setEditDraft((d) => ({ ...d, subject: e.target.value }))}
                                      placeholder="e.g. Biology" className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <select value={editDraft.difficulty} onChange={(e) => setEditDraft((d) => ({ ...d, difficulty: e.target.value }))}
                                    className={`text-xs font-medium border rounded-lg px-2 py-1 focus:outline-none ${diffColor(editDraft.difficulty)}`}>
                                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                                  </select>
                                  <button onClick={saveEdit} disabled={saving}
                                    className="flex items-center gap-1 text-xs px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                                    <Check size={12} /> {saving ? "Saving..." : "Save"}
                                  </button>
                                  <button onClick={cancelEdit}
                                    className="flex items-center gap-1 text-xs px-3 py-1.5 border border-border text-muted rounded-lg hover:text-ink transition-colors">
                                    <X size={12} /> Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-4">
                                <span className="text-xs text-muted mt-0.5 w-5 shrink-0 text-right">{i + 1}</span>
                                <div className="flex-1 grid grid-cols-2 gap-4 min-w-0">
                                  <div>
                                    <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Question</p>
                                    <p className="text-sm text-ink">{c.question || ""}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Answer</p>
                                    <p className="text-sm text-ink">{c.answer || ""}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {c.grade && (
                                    <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                      G{c.grade}
                                    </span>
                                  )}
                                  {c.difficulty && (
                                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${diffColor(c.difficulty)}`}>
                                      {c.difficulty}
                                    </span>
                                  )}
                                  <button
                                    onClick={() => toggleFeatured(c)}
                                    title={c.featured ? "Remove from featured" : "Mark as featured"}
                                    className={`p-1.5 rounded-lg transition-colors ${c.featured ? "text-amber-500 bg-amber-50 hover:bg-amber-100" : "text-subtle hover:text-amber-500 hover:bg-amber-50"}`}
                                  >
                                    <Star size={13} fill={c.featured ? "currentColor" : "none"} />
                                  </button>
                                  <button
                                    onClick={() => togglePublish(c)}
                                    title={c.publish ? "Unpublish" : "Publish"}
                                    className={`p-1.5 rounded-lg transition-colors ${c.publish ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" : "text-subtle hover:text-emerald-600 hover:bg-emerald-50"}`}
                                  >
                                    {c.publish ? <Eye size={13} /> : <EyeOff size={13} />}
                                  </button>
                                  <button onClick={() => startEdit(c)}
                                    className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-surface transition-colors">
                                    <Edit2 size={13} />
                                  </button>
                                  <button onClick={() => handleDelete(c._id)}
                                    className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add cards panel */}
        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add flash cards" width="lg">
          <div className="space-y-5">
            {/* Track + metadata */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Track</label>
                <select
                  value={selectedTrack}
                  onChange={(e) => setSelectedTrack(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="">No track</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Course (optional)</label>
                <select
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  <option value="">No course</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Grade (optional)</label>
                <input
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  placeholder="e.g. 11"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Subject (optional)</label>
                <input
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  placeholder="e.g. Biology"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>

            <p className="text-xs text-muted">
              All cards in this batch share the same track, grade, and subject. You can change individual cards after saving.
            </p>

            {/* Card drafts */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink">
                  Cards <span className="text-muted font-normal">({drafts.length})</span>
                </label>
                <button
                  onClick={() => setDrafts([...drafts, { question: "", answer: "", difficulty: "Medium" }])}
                  className="text-sm text-primary font-medium flex items-center gap-1 hover:opacity-80 transition-opacity"
                >
                  <Plus size={13} /> Add another
                </button>
              </div>

              {drafts.map((d, i) => (
                <div key={i} className="p-4 bg-surface rounded-xl border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted uppercase tracking-wide">Card {i + 1}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={d.difficulty}
                        onChange={(e) => updateDraft(i, "difficulty", e.target.value)}
                        className={`text-xs font-medium border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/20 ${diffColor(d.difficulty)}`}
                      >
                        {DIFFICULTIES.map((dif) => (
                          <option key={dif} value={dif}>{dif}</option>
                        ))}
                      </select>
                      {drafts.length > 1 && (
                        <button
                          onClick={() => setDrafts(drafts.filter((_, idx) => idx !== i))}
                          className="p-1 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="block text-xs text-muted mb-1">Question</label>
                      <textarea
                        value={d.question}
                        onChange={(e) => updateDraft(i, "question", e.target.value)}
                        placeholder="What is the question?"
                        rows={2}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Answer</label>
                      <textarea
                        value={d.answer}
                        onChange={(e) => updateDraft(i, "answer", e.target.value)}
                        placeholder="What is the answer?"
                        rows={2}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {formError && (
              <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving cards..." : `Save ${drafts.filter((d) => d.question.trim()).length || ""} card${drafts.filter((d) => d.question.trim()).length !== 1 ? "s" : ""}`}
              </Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
