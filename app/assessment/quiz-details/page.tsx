"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Edit2, Check, X } from "lucide-react";

interface Question {
  question: string;
  answers: string[];
  correctAnswer: string;
  explanation?: string;
}

interface Quiz {
  _id: string;
  title: string;
  duration?: number;
  contest?: boolean;
  featured?: boolean;
  published?: boolean;
  questions?: Question[];
  [key: string]: unknown;
}

export default function QuizDetailsPage() {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | "meta" | null>(null);
  const [form, setForm] = useState<Partial<Quiz & { questionIndex: number }>>({});
  const [saving, setSaving] = useState(false);
  const [newQ, setNewQ] = useState<Question>({ question: "", answers: ["", "", "", ""], correctAnswer: "", explanation: "" });
  const [addingQ, setAddingQ] = useState(false);

  const load = async () => {
    const id = localStorage.getItem("id");
    if (!id) { router.push("/assessment/quizzes"); return; }
    const res = await api.get(`/all-exams/${id}`);
    setQuiz(res.data.exam);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const startEdit = (index: number | "meta") => {
    if (!quiz) return;
    if (index === "meta") {
      setForm({ title: quiz.title, duration: quiz.duration, contest: quiz.contest, featured: quiz.featured, published: quiz.published });
    } else {
      const q = quiz.questions?.[index];
      if (q) setForm({ ...q, questionIndex: index });
    }
    setEditing(index);
  };

  const cancelEdit = () => { setEditing(null); setForm({}); };

  const saveEdit = async () => {
    if (!quiz) return;
    setSaving(true);
    try {
      if (editing === "meta") {
        await api.put(`/update-exam/${quiz._id}`, { title: form.title, duration: form.duration, contest: form.contest, featured: form.featured, published: form.published });
      } else if (typeof editing === "number") {
        const questions = [...(quiz.questions || [])];
        questions[editing] = { question: form.question as string, answers: form.answers as string[], correctAnswer: form.correctAnswer as string, explanation: form.explanation as string | undefined };
        await api.put(`/update-exam/${quiz._id}`, { questions });
      }
      await load();
      setEditing(null);
      setForm({});
    } finally {
      setSaving(false);
    }
  };

  const deleteQuestion = async (index: number) => {
    if (!quiz || !confirm("Delete this question?")) return;
    const questions = [...(quiz.questions || [])];
    questions.splice(index, 1);
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

  if (loading) return <AuthGuard><DashboardShell title="Quiz Details"><Spinner text="Loading quiz..." /></DashboardShell></AuthGuard>;
  if (!quiz) return null;

  return (
    <AuthGuard>
      <DashboardShell title={quiz.title}>
        <div className="space-y-5 max-w-3xl">
          <Button variant="ghost" size="sm" onClick={() => router.push("/assessment/quizzes")}>
            <ArrowLeft size={14} /> Back
          </Button>

          {/* Meta */}
          <Card
            title="Quiz details"
            action={
              editing !== "meta" ? (
                <Button variant="ghost" size="sm" onClick={() => startEdit("meta")}><Edit2 size={13} /> Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : <><Check size={13} /> Save</>}</Button>
                  <Button variant="ghost" size="sm" onClick={cancelEdit}><X size={13} /> Cancel</Button>
                </div>
              )
            }
          >
            {editing === "meta" ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Title</label>
                  <input value={String(form.title || "")} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Duration (minutes)</label>
                  <input type="number" value={String(form.duration || "")} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}
                    className="w-32 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal" />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!form.contest} onChange={(e) => setForm({ ...form, contest: e.target.checked })} />
                    Contest mode
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
                    Featured
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
                    Published
                  </label>
                </div>
              </div>
            ) : (
              <dl className="grid sm:grid-cols-4 gap-4">
                {[
                  ["Title", quiz.title],
                  ["Duration", quiz.duration ? `${quiz.duration} min` : "—"],
                  ["Mode", quiz.contest ? "Contest" : "Normal"],
                  ["Status", [quiz.featured ? "Featured" : null, quiz.published ? "Published" : "Draft"].filter(Boolean).join(", ") || "Draft"],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-xs text-muted uppercase tracking-wide font-medium">{k}</dt>
                    <dd className="mt-0.5 text-sm text-ink">{v as string}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {/* Questions */}
          <Card
            title={`${quiz.questions?.length ?? 0} question${quiz.questions?.length !== 1 ? "s" : ""}`}
            action={
              !addingQ && (
                <Button size="sm" onClick={() => setAddingQ(true)}><Plus size={13} /> Add question</Button>
              )
            }
          >
            <div className="space-y-4">
              {quiz.questions?.map((q, i) => (
                <div key={i} className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-surface px-4 py-3 flex items-start justify-between gap-4">
                    <span className="text-sm font-medium text-ink flex-1">{i + 1}. {q.question}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {editing === i ? (
                        <>
                          <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? "..." : <Check size={12} />}</Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit}><X size={12} /></Button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(i)} className="p-1.5 text-muted hover:text-ink rounded"><Edit2 size={13} /></button>
                          <button onClick={() => deleteQuestion(i)} className="p-1.5 text-muted hover:text-red-600 rounded"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  {editing === i ? (
                    <div className="p-4 space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Question</label>
                        <textarea value={String(form.question || "")} onChange={(e) => setForm({ ...form, question: e.target.value })} rows={2}
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal resize-none" />
                      </div>
                      {(form.answers as string[] || []).map((ans, ai) => (
                        <div key={ai} className="space-y-1">
                          <label className="text-xs font-medium text-muted">Option {ai + 1}</label>
                          <input value={ans} onChange={(e) => {
                            const a = [...(form.answers as string[])];
                            a[ai] = e.target.value;
                            setForm({ ...form, answers: a });
                          }} className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal" />
                        </div>
                      ))}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted">Correct answer</label>
                        <select value={String(form.correctAnswer || "")} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal">
                          <option value="">Select correct answer</option>
                          {(form.answers as string[] || []).map((a, ai) => a && <option key={ai} value={a}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 space-y-1">
                      {q.answers.map((a, ai) => (
                        <div key={ai} className={`flex items-center gap-2 text-sm py-1 px-2 rounded-lg ${a === q.correctAnswer ? "bg-teal-light text-teal-dark font-medium" : "text-muted"}`}>
                          <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs shrink-0">{String.fromCharCode(65 + ai)}</span>
                          {a}
                          {a === q.correctAnswer && <Check size={12} className="ml-auto" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Add new question inline */}
              {addingQ && (
                <div className="border border-teal/40 rounded-xl p-4 bg-teal-light/20 space-y-3">
                  <p className="text-sm font-semibold text-ink">New question</p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted">Question text</label>
                    <textarea value={newQ.question} onChange={(e) => setNewQ({ ...newQ, question: e.target.value })} rows={2}
                      placeholder="Type the question..."
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal resize-none" />
                  </div>
                  {newQ.answers.map((a, ai) => (
                    <div key={ai} className="space-y-1">
                      <label className="text-xs font-medium text-muted">Option {ai + 1}</label>
                      <input value={a} onChange={(e) => { const answers = [...newQ.answers]; answers[ai] = e.target.value; setNewQ({ ...newQ, answers }); }}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal" />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted">Correct answer</label>
                    <select value={newQ.correctAnswer} onChange={(e) => setNewQ({ ...newQ, correctAnswer: e.target.value })}
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal/40 focus:border-teal">
                      <option value="">Select correct option</option>
                      {newQ.answers.map((a, ai) => a && <option key={ai} value={a}>{a}</option>)}
                    </select>
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
