"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Trophy, Download, Medal } from "lucide-react";
import * as XLSX from "xlsx";

interface Quiz { _id: string; title: string; contest?: boolean; }
interface ContestEntry {
  _id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  correctAnswers?: number;
  totalQuestions?: number;
  score?: number;
  createdAt?: string;
}
interface QuizEntry {
  _id: string;
  studentName?: string;
  email?: string;
  school?: string;
  quizTitle?: string;
  score?: string | number;
  attemptsMade?: number;
  grade?: string;
  timeTaken?: string;
  achievement?: { title?: string; level?: string; color?: string };
  createdAt?: string;
}

type Tab = "contest" | "quiz";

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("contest");

  // Contest tab state
  const [contests, setContests] = useState<Quiz[]>([]);
  const [selected, setSelected] = useState<Quiz | null>(null);
  const [entries, setEntries] = useState<ContestEntry[]>([]);
  const [loadingContests, setLoadingContests] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  // Quiz leaderboard tab state
  const [quizEntries, setQuizEntries] = useState<QuizEntry[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizLoaded, setQuizLoaded] = useState(false);
  const [quizSearch, setQuizSearch] = useState("");

  const years = Array.from({ length: new Date().getFullYear() - 2020 + 1 }, (_, i) => 2020 + i).reverse();

  useEffect(() => {
    api.get("/all-exams-admin").then((res) => {
      const all: Quiz[] = res.data.allExaminations || [];
      const contestOnly = all.filter((q) => q.contest === true);
      setContests(contestOnly);
      if (contestOnly.length > 0) setSelected(contestOnly[0]);
    }).finally(() => setLoadingContests(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingEntries(true);
    const fetchData = async () => {
      try {
        let data: ContestEntry[] = [];
        try {
          const res = await api.get(`/fetch-contest-leaderboard/${selected._id}`);
          data = res.data.leaderboard || res.data.results || [];
        } catch {
          const res = await api.get(`/fetch-results/${selected._id}/${year}`);
          data = res.data.results || [];
        }
        setEntries([...data].sort((a, b) => (b.correctAnswers ?? b.score ?? 0) - (a.correctAnswers ?? a.score ?? 0)));
      } finally {
        setLoadingEntries(false);
      }
    };
    fetchData();
  }, [selected, year]);

  const loadQuizLeaderboard = async () => {
    if (quizLoaded) return;
    setQuizLoading(true);
    try {
      const res = await api.get("/all-leaderboards");
      setQuizEntries(res.data.leaderboards || []);
      setQuizLoaded(true);
    } finally {
      setQuizLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "quiz") loadQuizLeaderboard();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const getName = (r: ContestEntry) => r.name || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "—";
  const getScore = (r: ContestEntry) => r.correctAnswers ?? r.score ?? 0;
  const getTotal = (r: ContestEntry) => r.totalQuestions;

  const medalStyle = (i: number) => {
    if (i === 0) return "bg-yellow-400 text-white";
    if (i === 1) return "bg-slate-400 text-white";
    if (i === 2) return "bg-amber-600 text-white";
    return "bg-surface text-subtle border border-border";
  };

  const exportContest = () => {
    if (!selected) return;
    const data = entries.map((r, i) => ({
      Rank: i + 1, Name: getName(r), Email: r.email || "",
      Score: getScore(r), Total: getTotal(r) || "",
      Date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
    XLSX.writeFile(wb, `${selected.title}_Leaderboard_${year}.xlsx`);
  };

  const exportQuiz = () => {
    const data = filteredQuiz.map((r, i) => ({
      Rank: i + 1, Name: r.studentName || "—", Email: r.email || "",
      School: r.school || "—", Quiz: r.quizTitle || "—",
      Score: r.score ?? "—", Attempts: r.attemptsMade ?? "—",
      Grade: r.grade || "—", Achievement: r.achievement?.title || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quiz Leaderboard");
    XLSX.writeFile(wb, "Gifted_Quiz_Leaderboard.xlsx");
  };

  const filteredQuiz = quizSearch.trim()
    ? quizEntries.filter((r) =>
        (r.studentName || "").toLowerCase().includes(quizSearch.toLowerCase()) ||
        (r.quizTitle  || "").toLowerCase().includes(quizSearch.toLowerCase()) ||
        (r.school     || "").toLowerCase().includes(quizSearch.toLowerCase())
      )
    : quizEntries;

  return (
    <AuthGuard>
      <DashboardShell title="Leaderboard">
        <div className="space-y-4 max-w-4xl">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
            {([["contest", "Contest Exams"], ["quiz", "Quiz Leaderboard"]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-primary text-white shadow-sm" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Contest tab ── */}
          {tab === "contest" && (
            loadingContests ? <Spinner text="Loading contests..." /> :
            contests.length === 0 ? (
              <Card>
                <div className="py-12 text-center">
                  <Trophy size={32} className="text-subtle mx-auto mb-3" />
                  <p className="text-muted text-sm">No contests found. Create a contest quiz first.</p>
                </div>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted font-medium uppercase tracking-wide">Contest</p>
                      <select value={selected?._id || ""}
                        onChange={(e) => setSelected(contests.find((c) => c._id === e.target.value) || null)}
                        className="border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                        {contests.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
                      </select>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted font-medium uppercase tracking-wide">Year</p>
                      <div className="flex gap-1">
                        {years.slice(0, 4).map((y) => (
                          <button key={y} onClick={() => setYear(y)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${year === y ? "bg-primary text-white" : "bg-card border border-border text-muted hover:text-ink"}`}>
                            {y}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {entries.length > 0 && (
                    <button onClick={exportContest}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-muted hover:text-ink hover:border-primary/40 transition-colors">
                      <Download size={14} /> Export
                    </button>
                  )}
                </div>

                {!loadingEntries && entries.length >= 3 && (
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 0, 2].map((pos) => {
                      const entry = entries[pos];
                      if (!entry) return <div key={pos} />;
                      return (
                        <div key={pos} className={`bg-card border border-border rounded-xl p-4 text-center ${pos === 0 ? "ring-2 ring-yellow-400/40" : ""}`}>
                          <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center font-bold text-sm mb-2 ${medalStyle(pos)}`}>
                            {pos === 0 ? <Medal size={18} /> : pos + 1}
                          </div>
                          <p className="font-semibold text-ink text-sm truncate">{getName(entry)}</p>
                          <p className="text-2xl font-bold text-primary mt-1">{getScore(entry)}</p>
                          {getTotal(entry) && <p className="text-xs text-muted">/ {getTotal(entry)}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                <Card padding={false}>
                  {loadingEntries ? <Spinner text="Loading leaderboard..." /> :
                    entries.length === 0 ? <p className="text-muted text-sm py-12 text-center">No submissions yet for {year}.</p> : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface/50">
                            <th className="text-left px-5 py-2.5 text-muted font-medium text-xs w-16">Rank</th>
                            <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Name</th>
                            <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Email</th>
                            <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Score</th>
                            <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((r, i) => (
                            <tr key={r._id || i} className="border-b border-border last:border-0 hover:bg-surface/40">
                              <td className="px-5 py-3">
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${medalStyle(i)}`}>{i + 1}</span>
                              </td>
                              <td className="px-5 py-3 font-medium text-ink">{getName(r)}</td>
                              <td className="px-5 py-3 text-muted">{r.email || "—"}</td>
                              <td className="px-5 py-3">
                                <span className="font-semibold text-ink">{getScore(r)}</span>
                                {getTotal(r) && <span className="text-muted text-xs">/{getTotal(r)}</span>}
                              </td>
                              <td className="px-5 py-3 text-muted">
                                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                </Card>
              </>
            )
          )}

          {/* ── Quiz Leaderboard tab ── */}
          {tab === "quiz" && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  type="search"
                  value={quizSearch}
                  onChange={(e) => setQuizSearch(e.target.value)}
                  placeholder="Search by name, quiz or school..."
                  className="border border-border rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                />
                {filteredQuiz.length > 0 && (
                  <button onClick={exportQuiz}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-muted hover:text-ink hover:border-primary/40 transition-colors">
                    <Download size={14} /> Export
                  </button>
                )}
              </div>

              <Card padding={false} title={`${filteredQuiz.length} entries`}>
                {quizLoading ? <Spinner text="Loading quiz leaderboard..." /> :
                  filteredQuiz.length === 0 ? <p className="text-muted text-sm py-12 text-center">No quiz leaderboard entries yet.</p> : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface/50">
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs w-14">Rank</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Student</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Quiz</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Score</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Attempts</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Achievement</th>
                          <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQuiz.map((r, i) => (
                          <tr key={r._id || i} className="border-b border-border last:border-0 hover:bg-surface/40">
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${medalStyle(i)}`}>{i + 1}</span>
                            </td>
                            <td className="px-5 py-3">
                              <p className="font-medium text-ink text-sm">{r.studentName || "—"}</p>
                              {r.school && <p className="text-xs text-muted">{r.school}</p>}
                            </td>
                            <td className="px-5 py-3 text-muted text-sm max-w-[200px] truncate">{r.quizTitle || <span className="italic">Unknown quiz</span>}</td>
                            <td className="px-5 py-3">
                              <span className="font-semibold text-ink">{r.score ?? "—"}</span>
                            </td>
                            <td className="px-5 py-3 text-muted text-sm">{r.attemptsMade ?? "—"}</td>
                            <td className="px-5 py-3">
                              {r.achievement?.title ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-surface border border-border text-ink">
                                  {r.achievement.title}
                                </span>
                              ) : <span className="text-muted text-xs">—</span>}
                            </td>
                            <td className="px-5 py-3 text-muted text-sm">{r.grade || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </Card>
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
