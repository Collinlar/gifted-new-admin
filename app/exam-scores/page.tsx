"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import api from "@/lib/api";
import { Download, ChevronDown, ChevronUp, ClipboardList, TrendingUp, Users, Award } from "lucide-react";
import * as XLSX from "xlsx";

interface ExamScore {
  _id: string;
  quizId?: string;
  examTitle?: string;
  grade?: string;
  score?: string;
  createdAt?: string;
}

interface ExamStats {
  title: string;
  quizId: string;
  scores: ExamScore[];
  total: number;
  avg: number;
  highest: number;
  lowest: number;
  passRate: number;
  maxPossible: number;
  gradeBreakdown: Record<string, number>;
}

function parseScore(score: string | undefined): { earned: number; possible: number } {
  if (!score) return { earned: 0, possible: 0 };
  const parts = score.split("/");
  if (parts.length === 2) return { earned: parseInt(parts[0]) || 0, possible: parseInt(parts[1]) || 0 };
  return { earned: parseFloat(score) || 0, possible: 0 };
}

function buildStats(title: string, quizId: string, scores: ExamScore[]): ExamStats {
  const parsed = scores.map((s) => parseScore(s.score));
  const possibles = parsed.map((p) => p.possible).filter(Boolean);
  const maxPossible = possibles.length ? Math.max(...possibles) : 0;
  const earnedValues = parsed.map((p) => p.earned);
  const total = scores.length;
  const avg = total ? Math.round((earnedValues.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0;
  const highest = total ? Math.max(...earnedValues) : 0;
  const lowest = total ? Math.min(...earnedValues) : 0;
  const passing = maxPossible ? earnedValues.filter((e) => e / maxPossible >= 0.5).length : 0;
  const passRate = total ? Math.round((passing / total) * 100) : 0;

  const gradeBreakdown: Record<string, number> = {};
  for (const s of scores) {
    const g = s.grade || "Unknown";
    gradeBreakdown[g] = (gradeBreakdown[g] || 0) + 1;
  }

  return { title, quizId, scores, total, avg, highest, lowest, passRate, maxPossible, gradeBreakdown };
}

export default function ExamScoresPage() {
  const [stats, setStats] = useState<ExamStats[]>([]);
  const [totalScores, setTotalScores] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.get("/all-exam-scores").then((res) => {
      const all: ExamScore[] = res.data.examScores || res.data.scores || [];
      setTotalScores(all.length);
      const map: Record<string, ExamScore[]> = {};
      for (const s of all) {
        const key = s.quizId || "unknown";
        if (!map[key]) map[key] = [];
        map[key].push(s);
      }
      const built = Object.entries(map)
        .map(([qid, rows]) => buildStats(rows[0].examTitle || "Unknown exam", qid, rows))
        .sort((a, b) => b.total - a.total);
      setStats(built);
    }).catch(() => setStats([])).finally(() => setLoading(false));
  }, []);

  const handleExport = (s: ExamStats) => {
    const rows = s.scores.map((r, i) => ({
      "#": i + 1,
      Exam: s.title,
      Grade: r.grade || "—",
      Score: r.score || "—",
      Date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Exam Scores");
    XLSX.writeFile(wb, `ExamScores_${s.title.replace(/[^a-z0-9]/gi, "_")}.xlsx`);
  };

  const scoreColor = (pct: number) => {
    if (pct >= 70) return "text-emerald-600 bg-emerald-50";
    if (pct >= 50) return "text-amber-600 bg-amber-50";
    return "text-red-600 bg-red-50";
  };

  return (
    <AuthGuard>
      <DashboardShell title="Exam Scores">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {totalScores} attempt records across {stats.length} exam{stats.length !== 1 ? "s" : ""}. Note: individual student names are not available for this data set.
          </p>

          {loading ? (
            <Spinner text="Loading exam scores..." />
          ) : stats.length === 0 ? (
            <Card><p className="text-muted text-sm py-8 text-center">No exam scores found.</p></Card>
          ) : (
            <div className="space-y-2">
              {stats.map((s) => {
                const isOpen = expanded === s.quizId;
                const avgPct = s.maxPossible ? Math.round((s.avg / s.maxPossible) * 100) : 0;

                return (
                  <div key={s.quizId} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
                    {/* Header */}
                    <button
                      onClick={() => setExpanded(isOpen ? null : s.quizId)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface/60 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                          <ClipboardList size={15} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink text-sm truncate">{s.title}</p>
                          <p className="text-xs text-muted mt-0.5">{s.total} attempt{s.total !== 1 ? "s" : ""}</p>
                        </div>
                      </div>

                      {/* Summary chips */}
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        {s.maxPossible > 0 && (
                          <>
                            <span className={`hidden sm:inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold ${scoreColor(avgPct)}`}>
                              Avg {s.avg}/{s.maxPossible}
                            </span>
                            <span className="hidden sm:inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold text-muted bg-surface border border-border">
                              {s.passRate}% pass
                            </span>
                          </>
                        )}
                        {isOpen && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExport(s); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-ink hover:border-primary/40 transition-colors"
                          >
                            <Download size={12} /> Export
                          </button>
                        )}
                        {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                      </div>
                    </button>

                    {/* Expanded: stats + grade breakdown + raw rows */}
                    {isOpen && (
                      <div className="border-t border-border">
                        {/* Stat cards */}
                        {s.maxPossible > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
                            {[
                              { label: "Attempts", value: s.total, icon: Users },
                              { label: "Average score", value: `${s.avg}/${s.maxPossible}`, icon: TrendingUp },
                              { label: "Highest score", value: `${s.highest}/${s.maxPossible}`, icon: Award },
                              { label: "Pass rate (≥50%)", value: `${s.passRate}%`, icon: TrendingUp },
                            ].map(({ label, value, icon: Icon }) => (
                              <div key={label} className="bg-card px-5 py-4">
                                <p className="text-xs text-muted font-medium">{label}</p>
                                <p className="text-xl font-bold text-ink mt-1">{value}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Grade breakdown */}
                        {Object.keys(s.gradeBreakdown).length > 1 && (
                          <div className="px-5 py-4 border-b border-border">
                            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Attempts by grade</p>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(s.gradeBreakdown)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([grade, count]) => (
                                  <div key={grade} className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded-lg border border-border">
                                    <span className="text-sm font-medium text-ink">{grade}</span>
                                    <span className="text-xs text-muted">{count} attempt{count !== 1 ? "s" : ""}</span>
                                    {/* Mini score bar */}
                                    <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-primary rounded-full"
                                        style={{ width: `${Math.round((count / s.total) * 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Score rows */}
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-surface/50">
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">#</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Grade</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Score</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.scores.map((r, i) => {
                              const { earned, possible } = parseScore(r.score);
                              const pct = possible ? Math.round((earned / possible) * 100) : 0;
                              return (
                                <tr key={r._id || i} className="border-b border-border last:border-0 hover:bg-surface/40">
                                  <td className="px-5 py-2.5 text-muted text-xs">{i + 1}</td>
                                  <td className="px-5 py-2.5 font-medium text-ink">{r.grade || "—"}</td>
                                  <td className="px-5 py-2.5">
                                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${scoreColor(pct)}`}>
                                      {r.score || "—"}
                                    </span>
                                  </td>
                                  <td className="px-5 py-2.5 text-muted text-xs">
                                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
