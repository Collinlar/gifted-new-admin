"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Edit2, Check, X, Image as ImageIcon } from "lucide-react";

interface Question {
  question: string;
  answers: string[];
  correctAnswer: string;
  explanation?: string;
  image?: string;
}

interface Quiz {
  _id: string;
  title: string;
  description?: string;
  time?: number | string;
  numberOfQuestions?: number;
  grade?: string | string[];
  level?: string;
  difficulty?: string;
  instructor?: string;
  program?: string;
  tags?: string[];
  image?: string;
  contest?: boolean;
  featured?: boolean;
  publish?: boolean;
  attemptsAllowed?: number;
  allowQuizReview?: boolean;
  displayScores?: boolean;
  showFeedbackForm?: boolean;
  shuffleQuestions?: boolean;
  questions?: Question[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
};

export default function QuizDetailsPage() {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const [editingQ, setEditingQ] = useState<number | null>(null);
  const [qForm, setQForm] = useState<Question>({ question: "", answers: ["", "", "", ""], correctAnswer: "", explanation: "" });
  const [addingQ, setAddingQ] = useState(false);
  const [newQ, setNewQ] = useState<Question>({ question: "", answers: ["", "", "", ""], correctAnswer: "", explanation: "" });

  const load = async () => {
    const id = localStorage.getItem("id");
    if (!id) { router.push("/assessment"); return; }
    setLoading(true);
    try {
      const res = await api.get(`/all-exams/${id}`);
      setQuiz(res.data.exam);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startMetaEdit = () => {
    if (!quiz) return;
    setMetaForm({
      title:            quiz.title || "",
      description:      quiz.description || "",
      time:             quiz.time || "",
      numberOfQuestions: quiz.numberOfQuestions || "",
      grade:            arr(quiz.grade).join(", "),
      level:            quiz.level || "",
      difficulty:       quiz.difficulty || "",
      instructor:       quiz.instructor || "",
      program:          quiz.program || "",
      tags:             arr(quiz.tags).join(", "),
      image:            quiz.image || "",
      contest:          !!quiz.contest,
      featured:         !!quiz.featured,
      publish:          !!quiz.publish,
      attemptsAllowed:  quiz.attemptsAllowed ?? 1,
      allowQuizReview:  !!quiz.allowQuizReview,
      displayScores:    !!quiz.displayScores,
      showFeedbackForm: !!quiz.showFeedbackForm,
      shuffleQuestions: !!quiz.shuffleQuestions,
    });
    setEditingMeta(true);
  };

  const saveMeta = async () => {
    if (!quiz) return;
    setSaving(true);
    try {
      const split = (v: unknown) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      await api.put(`/update-exam/${quiz._id}`, {
        title:            metaForm.title,
        description:      metaForm.description,
        time:             metaForm.time || null,
        numberOfQuestions: metaForm.numberOfQuestions ? Number(metaForm.numberOfQuestions) : null,
        grade:            split(metaForm.grade),
        level:            metaForm.level || null,
        difficulty:       metaForm.difficulty || null,
        instructor:       metaForm.instructor || null,
        program:          metaForm.program || null,
        tags:             split(metaForm.tags),
        image:            metaForm.image || null,
        contest:          metaForm.contest,
        featured:         metaForm.featured,
        publish:          metaForm.publish,
        attemptsAllowed:  Number(metaForm.attemptsAllowed) || 1,
        allowQuizReview:  metaForm.allowQuizReview,
        displayScores:    metaForm.displayScores,
        showFeedbackForm: metaForm.showFeedbackForm,
        shuffleQuestions: metaForm.shuffleQuestions,
      });
      await load();
      setEditingMeta(false);
    } finally {
      setSaving(false);
    }
  };

  const startQEdit = (i: number) => {
    const q = quiz?.questions?.[i];
    if (!q) return;
    setQForm({ ...q, answers: [...(q.answers || ["", "", "", ""])] });
    setEditingQ(i);
  };

  const saveQ = async () => {
    if (!quiz || editingQ === null) return;
    setSaving(true);
    try {
      const questions = [...(quiz.questions || [])];
      questions[editingQ] = qForm;
      await api.put(`/update-exam/${quiz._id}`, { questions });
      await load();
      setEditingQ(null);
    } finally {
      setSaving(false);
    }
  };

  const deleteQ = async (i: number) => {
    if (!quiz || !confirm("Delete this question?")) return;
    const questions = [...(quiz.questions || [])];
    questions.splice(i, 1);
    await api.put(`/update-exam/${quiz._id}`, { questions });
    await load();
  };

  const addQuestion = async () => {
    if (!quiz || !newQ.question.trim()) return;
    setSaving(true);
    try {
      const questions = [...(quiz.questions || []), newQ];
      await api.put(`/update-exam/${quiz._id}`, { questions });
      await load();
      setNewQ({ question: "", answers: ["", "", "", ""], correctAnswer: "", explanation: "" });
      setAddingQ(false);
    } finally {
      setSaving(false);
    }
  };

  const setM = (k: string, v: unknown) => setMetaForm((f) => ({ ...f, [k]: v }));

  if (loading) return (
    <AuthGuard><DashboardShell title="Quiz Details"><Spinner text="Loading quiz..." /></DashboardShell></AuthGuard>
  );
  if (!quiz) return null;

  const gradeDisplay = arr(quiz.grade).join(", ");

  return (
    <AuthGuard>
      <DashboardShell title={quiz.title}>
        <div className="space-y-5 max-w-3xl">
          <Button variant="ghost" size="sm" onClick={() => router.push("/assessment")}>
            <ArrowLeft size={14} /> Back to assessments
          </Button>

          {/* Meta card */}
          <Card
            title="Quiz details"
            action={
              !editingMeta ? (
                <Button variant="ghost" size="sm" onClick={startMetaEdit}><Edit2 size={13} /> Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveMeta} disabled={saving}><Check size={13} /> {saving ? "Saving..." : "Save"}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingMeta(false)}><X size={13} /> Cancel</Button>
                </div>
              )
            }
          >
            {editingMeta ? (
              <div className="space-y-4">
                <Input label="Title" value={String(metaForm.title || "")} onChange={(e) => setM("title", e.target.value)} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-ink">Description</label>
                  <textarea value={String(metaForm.description || "")} onChange={(e) => setM("description", e.target.value)}
                    rows={3} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Time (minutes)" type="number" value={String(metaForm.time || "")} onChange={(e) => setM("time", e.target.value)} />
                  <Input label="Number of questions" type="number" value={String(metaForm.numberOfQuestions || "")} onChange={(e) => setM("numberOfQuestions", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Grade (comma-separated)" value={String(metaForm.grade || "")} onChange={(e) => setM("grade", e.target.value)} placeholder="7, 8, 9" />
                  <Input label="Level" value={String(metaForm.level || "")} onChange={(e) => setM("level", e.target.value)} placeholder="JHS, SHS..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Difficulty" value={String(metaForm.difficulty || "")} onChange={(e) => setM("difficulty", e.target.value)} placeholder="Easy, Medium, Hard" />
                  <Input label="Attempts allowed" type="number" value={String(metaForm.attemptsAllowed || 1)} onChange={(e) => setM("attemptsAllowed", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Instructor" value={String(metaForm.instructor || "")} onChange={(e) => setM("instructor", e.target.value)} />
                  <Input label="Program" value={String(metaForm.program || "")} onChange={(e) => setM("program", e.target.value)} />
                </div>
                <Input label="Tags (comma-separated)" value={String(metaForm.tags || "")} onChange={(e) => setM("tags", e.target.value)} placeholder="Math, Science..." />
                <Input label="Image URL" value={String(metaForm.image || "")} onChange={(e) => setM("image", e.target.value)} placeholder="https://..." />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-1">
                  {([
                    ["contest", "Contest mode"],
                    ["featured", "Featured"],
                    ["publish", "Published"],
                    ["allowQuizReview", "Allow quiz review"],
                    ["displayScores", "Display scores"],
                    ["showFeedbackForm", "Show feedback form"],
                    ["shuffleQuestions", "Shuffle questions"],
                  ] as [string, string][]).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!metaForm[k]} onChange={(e) => setM(k, e.target.checked)}
                        className="w-4 h-4 rounded border-border accent-primary" />
                      <span className="text-sm text-ink">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                  {([
                    ["Title", quiz.title],
                    ["Description", quiz.description],
                    ["Time", quiz.time ? `${quiz.time} min` : null],
                    ["Number of questions", quiz.numberOfQuestions],
                    ["Grade", gradeDisplay || null],
                    ["Level", quiz.level],
                    ["Difficulty", quiz.difficulty],
                    ["Instructor", quiz.instructor],
                    ["Program", quiz.program],
                    ["Attempts allowed", quiz.attemptsAllowed],
                    ["Status", quiz.publish ? "Published" : "Draft"],
                    ["Contest mode", quiz.contest ? "Yes" : "No"],
                    ["Featured", quiz.featured ? "Yes" : "No"],
                    ["Allow quiz review", quiz.allowQuizReview ? "Yes" : "No"],
                    ["Display scores", quiz.displayScores ? "Yes" : "No"],
                    ["Show feedback form", quiz.showFeedbackForm ? "Yes" : "No"],
                    ["Shuffle questions", quiz.shuffleQuestions ? "Yes" : "No"],
                    ["Created", quiz.createdAt ? new Date(quiz.createdAt).toLocaleString() : null],
                    ["Updated", quiz.updatedAt ? new Date(quiz.updatedAt).toLocaleString() : null],
                  ] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([label, value]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-muted uppercase tracking-wide font-medium">{label}</dt>
                      <dd className="mt-0.5 text-sm text-ink">{String(value)}</dd>
                    </div>
                  ))}
                </dl>

                {quiz.image && (
                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide font-medium mb-2">Image</p>
                    <img src={quiz.image} alt="Quiz" className="w-48 h-32 object-cover rounded-xl border border-border" />
                  </div>
                )}

                {quiz.tags && quiz.tags.length > 0 && (
                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide font-medium mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {quiz.tags.map((t) => (
                        <span key={t} className="px-2.5 py-1 rounded-lg text-xs bg-surface text-muted border border-border">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Questions */}
          <Card
            title={`${quiz.questions?.length ?? 0} question${quiz.questions?.length !== 1 ? "s" : ""}`}
            action={!addingQ && (
              <Button size="sm" onClick={() => setAddingQ(true)}><Plus size={13} /> Add question</Button>
            )}
          >
            <div className="space-y-4">
              {quiz.questions?.map((q, i) => (
                <div key={i} className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-surface px-4 py-3 flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <span className="text-sm font-medium text-ink">{i + 1}. {q.question}</span>
                      {q.image && <img src={q.image} alt="" className="mt-2 h-24 rounded-lg object-contain border border-border" />}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {editingQ === i ? (
                        <>
                          <Button size="sm" onClick={saveQ} disabled={saving}>{saving ? "..." : <Check size={12} />}</Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingQ(null)}><X size={12} /></Button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startQEdit(i)} className="p-1.5 text-muted hover:text-ink rounded"><Edit2 size={13} /></button>
                          <button onClick={() => deleteQ(i)} className="p-1.5 text-muted hover:text-red-600 rounded"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>

                  {editingQ === i ? (
                    <div className="p-4 space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Question</label>
                        <textarea value={qForm.question} onChange={(e) => setQForm({ ...qForm, question: e.target.value })} rows={2}
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Image URL (optional)</label>
                        <input value={qForm.image || ""} onChange={(e) => setQForm({ ...qForm, image: e.target.value })}
                          placeholder="https://..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </div>
                      {qForm.answers.map((ans, ai) => (
                        <div key={ai} className="space-y-1">
                          <label className="text-xs font-medium text-muted">Option {ai + 1}</label>
                          <input value={ans} onChange={(e) => { const a = [...qForm.answers]; a[ai] = e.target.value; setQForm({ ...qForm, answers: a }); }}
                            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        </div>
                      ))}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Correct answer</label>
                        <select value={qForm.correctAnswer} onChange={(e) => setQForm({ ...qForm, correctAnswer: e.target.value })}
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30">
                          <option value="">Select correct answer</option>
                          {qForm.answers.filter(Boolean).map((a, ai) => <option key={ai} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Explanation</label>
                        <textarea value={qForm.explanation || ""} onChange={(e) => setQForm({ ...qForm, explanation: e.target.value })} rows={2}
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 space-y-1">
                      {q.answers.map((a, ai) => (
                        <div key={ai} className={`flex items-center gap-2 text-sm py-1 px-2 rounded-lg ${a === q.correctAnswer ? "bg-emerald-50 text-emerald-800 font-medium" : "text-muted"}`}>
                          <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs shrink-0">{String.fromCharCode(65 + ai)}</span>
                          {a}
                          {a === q.correctAnswer && <Check size={12} className="ml-auto" />}
                        </div>
                      ))}
                      {q.explanation && (
                        <p className="text-xs text-muted mt-2 pt-2 border-t border-border italic">{q.explanation}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {addingQ && (
                <div className="border border-primary/30 rounded-xl p-4 bg-primary-light/20 space-y-3">
                  <p className="text-sm font-semibold text-ink">New question</p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted">Question text</label>
                    <textarea value={newQ.question} onChange={(e) => setNewQ({ ...newQ, question: e.target.value })} rows={2}
                      placeholder="Type the question..."
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted flex items-center gap-1"><ImageIcon size={11} /> Image URL (optional)</label>
                    <input value={newQ.image || ""} onChange={(e) => setNewQ({ ...newQ, image: e.target.value })}
                      placeholder="https://..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </div>
                  {newQ.answers.map((a, ai) => (
                    <div key={ai} className="space-y-1">
                      <label className="text-xs font-medium text-muted">Option {ai + 1}</label>
                      <input value={a} onChange={(e) => { const answers = [...newQ.answers]; answers[ai] = e.target.value; setNewQ({ ...newQ, answers }); }}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted">Correct answer</label>
                    <select value={newQ.correctAnswer} onChange={(e) => setNewQ({ ...newQ, correctAnswer: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30">
                      <option value="">Select correct option</option>
                      {newQ.answers.filter(Boolean).map((a, ai) => <option key={ai} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted">Explanation (optional)</label>
                    <textarea value={newQ.explanation || ""} onChange={(e) => setNewQ({ ...newQ, explanation: e.target.value })} rows={2}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={addQuestion} disabled={saving}>{saving ? "Saving..." : "Add question"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setAddingQ(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
