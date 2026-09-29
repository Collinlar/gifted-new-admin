"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2, Check } from "lucide-react";

interface Question { question: string; answers: string[]; correctAnswer: string; }
interface Challenge {
  _id: string; title?: string; duration?: number; questions?: unknown[];
  courseId?: string; trackId?: string; courseTitle?: string; trackName?: string;
  grade?: string; subject?: string; publish?: boolean;
}
interface Course { _id?: string; mongoId?: string; title?: string; }
interface Track  { _id?: string; id?: string; name?: string; }

const emptyQ = (): Question => ({ question: "", answers: ["", "", "", ""], correctAnswer: "" });
const emptyForm = { title: "", duration: "", courseId: "", trackId: "", grade: "", subject: "", publish: false };

export default function TimedChallengesPage() {
  const [items, setItems] = useState<Challenge[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [questions, setQuestions] = useState<Question[]>([emptyQ()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const [res, trackRes, courseRes] = await Promise.all([
        api.get("/all-timed-challenges"),
        api.get("/all-tracks"),
        api.get("/all-courses-admin-info"),
      ]);
      setItems(res.data.allTimedChallenges || res.data.timedChallenges || []);
      setTracks(trackRes.data.tracks || []);
      setCourses(courseRes.data.courses || []);
    } catch { setItems([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Nothing reaches a student until it is published, so this is the switch
  // that matters most on this screen.
  const togglePublish = async (c: Challenge) => {
    const next = !c.publish;
    setItems((p) => p.map((x) => (x._id === c._id ? { ...x, publish: next } : x)));
    try {
      await api.post(`/update-timed-challenge/${c._id}`, { publish: next });
    } catch {
      setItems((p) => p.map((x) => (x._id === c._id ? { ...x, publish: !next } : x)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this challenge?")) return;
    await api.delete(`/delete-timed-challenge/${id}`);
    setItems((p) => p.filter((c) => c._id !== id));
  };

  const updateQ = (i: number, k: "question" | "correctAnswer", v: string) => {
    const qs = [...questions]; qs[i] = { ...qs[i], [k]: v }; setQuestions(qs);
  };
  const updateAnswer = (qi: number, ai: number, v: string) => {
    const qs = [...questions]; const a = [...qs[qi].answers]; a[ai] = v; qs[qi] = { ...qs[qi], answers: a }; setQuestions(qs);
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.title.trim()) return setFormError("Give this challenge a title.");
    // Without one of these the challenge sits in the table where no student
    // can ever match it, which is how this feature stayed invisible.
    if (!form.courseId && !form.trackId) {
      return setFormError("Attach this to a course or a track, or no student will see it.");
    }
    const usable = questions.filter((q) => q.question.trim() && q.answers.filter((a) => a.trim()).length > 1 && q.correctAnswer.trim());
    if (usable.length === 0) {
      return setFormError("Add at least one question with two options and the right answer ticked.");
    }
    if (usable.length < questions.length) {
      return setFormError(`${questions.length - usable.length} question(s) are missing options or a ticked answer. Students would never see those.`);
    }
    setSaving(true);
    try {
      await api.post("/add-timed-challenge", { ...form, duration: Number(form.duration) || 30, questions });
      setPanelOpen(false);
      setForm(emptyForm);
      setQuestions([emptyQ()]);
      await load();
    } catch {
      setFormError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell title="Timed Challenges">
        <Card
          title={`${items.length} challenge${items.length !== 1 ? "s" : ""}`}
          action={<Button size="sm" onClick={() => setPanelOpen(true)}><Plus size={14} /> Add challenge</Button>}
          padding={false}
        >
          {loading ? (
            <Spinner text="Loading challenges..." />
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted text-sm">No timed challenges yet.</p>
              <Button size="sm" className="mt-4" onClick={() => setPanelOpen(true)}><Plus size={14} /> Create one</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Title", "Shown to", "Time/question", "Questions", "Live", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-muted font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink">{c.title || "Untitled"}</td>
                    <td className="px-5 py-3.5 text-muted">
                      {c.courseTitle || c.trackName || <span className="text-danger">Nobody, not attached</span>}
                    </td>
                    <td className="px-5 py-3.5 text-muted">{c.duration ? `${c.duration}s` : "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{(c.questions as unknown[] | undefined)?.length ?? 0}</td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => togglePublish(c)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                          c.publish ? "bg-emerald-50 text-success" : "bg-surface text-muted hover:text-ink"
                        }`}>
                        {c.publish ? "Live" : "Hidden"}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => handleDelete(c._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add timed challenge" width="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Title" placeholder="Challenge title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input label="Seconds per question" type="number" placeholder="30" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
            </div>

            {/* Who sees it. A challenge with neither is unreachable. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Course</label>
                <select
                  value={form.courseId}
                  onChange={(e) => setForm({ ...form, courseId: e.target.value, trackId: e.target.value ? "" : form.trackId })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">No course</option>
                  {courses.map((c) => (
                    <option key={c._id} value={c.mongoId || c._id}>{c.title || "Untitled course"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Track</label>
                <select
                  value={form.trackId}
                  onChange={(e) => setForm({ ...form, trackId: e.target.value, courseId: e.target.value ? "" : form.courseId })}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">No track</option>
                  {tracks.map((t) => (
                    <option key={t._id} value={t._id}>{t.name || "Untitled track"}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Grade (optional)" placeholder="e.g. 5" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
              <Input label="Subject (optional)" placeholder="e.g. Mathematics" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.checked })}
                className="w-4 h-4 accent-primary" />
              Show this to students straight away
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">Questions ({questions.length})</p>
                <button onClick={() => setQuestions([...questions, emptyQ()])} className="text-sm text-primary font-medium flex items-center gap-1"><Plus size={13} /> Add question</button>
              </div>
              {questions.map((q, i) => (
                <div key={i} className="p-4 border border-border rounded-xl space-y-3 bg-surface/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted uppercase">Question {i + 1}</span>
                    {questions.length > 1 && <button onClick={() => setQuestions(questions.filter((_, idx) => idx !== i))} className="text-subtle hover:text-danger"><Trash2 size={13} /></button>}
                  </div>
                  <Input placeholder="Question text" value={q.question} onChange={(e) => updateQ(i, "question", e.target.value)} />
                  <div className="space-y-2">
                    {q.answers.map((a, ai) => (
                      <div key={ai} className="flex items-center gap-2">
                        <span className="text-xs font-bold text-subtle w-4 shrink-0">{String.fromCharCode(65 + ai)}</span>
                        <input value={a} onChange={(e) => updateAnswer(i, ai, e.target.value)} placeholder={`Option ${ai + 1}`}
                          className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors ${a && a === q.correctAnswer ? "border-success bg-emerald-50 focus:ring-success/20" : "border-border bg-white focus:ring-primary/20 focus:border-primary"}`} />
                        {a && (
                          <button type="button" onClick={() => updateQ(i, "correctAnswer", a)} className={`p-1.5 rounded-lg shrink-0 transition-colors ${a === q.correctAnswer ? "bg-success text-white" : "text-subtle hover:text-success border border-border"}`}>
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save challenge"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
