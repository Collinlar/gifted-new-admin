"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { CheckCircle, Download, ChevronDown, ChevronUp, Trophy, X, XCircle } from "lucide-react";
import * as XLSX from "xlsx";

interface Quiz { _id: string; title: string; contest?: boolean; questions?: unknown[]; }
interface ReviewItem {
  question: string;
  isCorrect: boolean;
  correctAnswer: string;
  selectedAnswer: string;
  explanation?: string;
}
interface Result {
  _id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  school?: string;
  grade?: string;
  correctAnswers?: number;
  totalQuestions?: number;
  createdAt?: string;
  review?: ReviewItem[];
}

function AnswerReviewPanel({ result, onClose }: { result: Result; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items: ReviewItem[] = result.review || [];
  const correct = items.filter((r) => r.isCorrect).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/20">
      <div ref={ref} className="h-full w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between shrink-0">
          <div>
            <p className="font-semibold text-ink text-sm">
              {result.name || `${result.firstName || ""} ${result.lastName || ""}`.trim() || "—"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {correct}/{items.length} correct · {result.school || ""} {result.grade ? `· Grade ${result.grade}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Score bar */}
        <div className="px-5 py-3 border-b border-border bg-surface/50 shrink-0">
          <div className="flex items-center justify-between text-xs text-muted mb-1.5">
            <span>Score</span>
            <span className="font-semibold text-ink">{items.length > 0 ? Math.round((correct / items.length) * 100) : 0}%</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: items.length > 0 ? `${(correct / items.length) * 100}%` : "0%" }}
            />
          </div>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No question data available.</p>
          ) : (
            items.map((item, i) => (
              <div key={i} className={`rounded-xl border p-4 ${item.isCorrect ? "border-emerald-100 bg-emerald-50/40" : "border-red-100 bg-red-50/40"}`}>
                <div className="flex items-start gap-2 mb-3">
                  {item.isCorrect
                    ? <CheckCircle size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                    : <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  }
                  <p className="text-sm font-medium text-ink leading-snug">{i + 1}. {item.question}</p>
                </div>
                <div className="space-y-1.5 pl-5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted w-28 shrink-0">Selected:</span>
                    <span className={`font-medium ${item.isCorrect ? "text-emerald-700" : "text-red-600"}`}>
                      {item.selectedAnswer || "—"}
                    </span>
                  </div>
                  {!item.isCorrect && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted w-28 shrink-0">Correct answer:</span>
                      <span className="font-medium text-emerald-700">{item.correctAnswer || "—"}</span>
                    </div>
                  )}
                  {item.explanation && (
                    <div className="flex items-start gap-2 text-xs mt-2">
                      <span className="text-muted w-28 shrink-0">Explanation:</span>
                      <span className="text-muted">{item.explanation}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuizScoresPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loadingQuizzes, setLoadingQuizzes] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [reviewing, setReviewing] = useState<Result | null>(null);

  const years = Array.from({ length: new Date().getFullYear() - 2015 + 1 }, (_, i) => 2015 + i).reverse();

  useEffect(() => {
    api.get("/all-exams-admin").then((res) => {
      setQuizzes(res.data.allExaminations || []);
    }).finally(() => setLoadingQuizzes(false));
  }, []);

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (results[id]) return;
    setLoading((l) => ({ ...l, [id]: true }));
    try {
      const res = await api.get(`/fetch-results/${id}/${year}`);
      const sorted = (res.data.results || []).sort(
        (a: Result, b: Result) => (b.correctAnswers ?? 0) - (a.correctAnswers ?? 0)
      );
      setResults((r) => ({ ...r, [id]: sorted }));
    } finally {
      setLoading((l) => ({ ...l, [id]: false }));
    }
  };

  // When year changes, clear cached results
  const handleYearChange = (y: number) => {
    setYear(y);
    setResults({});
    setExpanded(null);
  };

  const handleExport = (quizTitle: string, id: string) => {
    const data = (results[id] || []).map((r, i) => ({
      Rank: i + 1,
      Name: r.name || `${r.firstName || ""} ${r.lastName || ""}`.trim(),
      School: r.school || "",
      Grade: r.grade || "",
      Email: r.email,
      Score: r.correctAnswers,
      Total: r.totalQuestions,
      "Date Completed": r.createdAt ? new Date(r.createdAt).toLocaleString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, `${quizTitle}_Results_${year}.xlsx`);
  };

  const getName = (r: Result) =>
    r.name || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "—";

  return (
    <AuthGuard>
      <DashboardShell title="Quiz Results">
        <div className="space-y-4">
          {/* Year selector */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-body">Year:</span>
            <div className="flex gap-1">
              {years.slice(0, 5).map((y) => (
                <button
                  key={y}
                  onClick={() => handleYearChange(y)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${year === y ? "bg-primary text-white" : "bg-card border border-border text-muted hover:text-ink hover:border-primary/40"}`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          {/* Quiz list — expand to see results */}
          {loadingQuizzes ? (
            <Spinner text="Loading quizzes..." />
          ) : quizzes.length === 0 ? (
            <Card><p className="text-muted text-sm py-8 text-center">No quizzes found.</p></Card>
          ) : (
            <div className="space-y-2">
              {quizzes.map((q) => {
                const isOpen = expanded === q._id;
                const quizResults = results[q._id] || [];
                const isLoading = loading[q._id];

                return (
                  <div key={q._id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
                    {/* Quiz header — click to expand */}
                    <button
                      onClick={() => toggleExpand(q._id)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface/60 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${q.contest ? "bg-accent-light" : "bg-primary-light"}`}>
                          <Trophy size={15} className={q.contest ? "text-accent-dark" : "text-primary"} />
                        </div>
                        <div>
                          <p className="font-medium text-ink text-sm">{q.title}</p>
                          <p className="text-xs text-muted mt-0.5">
                            {q.contest ? "Contest" : "Quiz"} · {q.questions?.length ?? 0} questions
                            {isOpen && quizResults.length > 0 && ` · ${quizResults.length} submissions`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        {isOpen && quizResults.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExport(q.title, q._id); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-ink hover:border-primary/40 transition-colors"
                          >
                            <Download size={12} /> Export
                          </button>
                        )}
                        {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                      </div>
                    </button>

                    {/* Results — shown when expanded */}
                    {isOpen && (
                      <div className="border-t border-border">
                        {isLoading ? (
                          <Spinner text="Loading results..." />
                        ) : quizResults.length === 0 ? (
                          <p className="text-muted text-sm py-8 text-center">No submissions for {year}.</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-surface/50">
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Rank</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Name</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">School</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Grade</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Email</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Score</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date Completed</th>
                                <th className="px-5 py-2.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {quizResults.map((r, i) => (
                                <tr key={r._id || i} className="border-b border-border last:border-0 hover:bg-surface/40">
                                  <td className="px-5 py-2.5">
                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-slate-100 text-slate-600" : i === 2 ? "bg-orange-50 text-orange-600" : "text-subtle"}`}>
                                      {i + 1}
                                    </span>
                                  </td>
                                  <td className="px-5 py-2.5 font-medium text-ink text-sm">{getName(r)}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.school || "—"}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.grade || "—"}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.email || "—"}</td>
                                  <td className="px-5 py-2.5">
                                    <span className="font-semibold text-ink">{r.correctAnswers ?? "—"}</span>
                                    {r.totalQuestions && <span className="text-muted text-xs">/{r.totalQuestions}</span>}
                                  </td>
                                  <td className="px-5 py-2.5 text-muted text-sm">
                                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                                  </td>
                                  <td className="px-5 py-2.5">
                                    {r.review && r.review.length > 0 && (
                                      <button
                                        onClick={() => setReviewing(r)}
                                        className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
                                      >
                                        Review answers
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DashboardShell>
      {reviewing && <AnswerReviewPanel result={reviewing} onClose={() => setReviewing(null)} />}
    </AuthGuard>
  );
}
