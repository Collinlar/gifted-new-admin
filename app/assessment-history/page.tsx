"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { ChevronLeft, ChevronRight, Download, ChevronDown, ChevronUp, User, CheckCircle, XCircle } from "lucide-react";
import * as XLSX from "xlsx";

interface AttemptDetail {
  title?: string;
  quizId?: string;
  score?: number;
  totalQuestions?: number;
  completed?: boolean;
  date?: string;
}

interface AssessmentRecord {
  _id: string;
  userId?: string;
  studentName?: string;
  studentSchool?: string;
  details?: AttemptDetail[] | unknown;
  createdAt?: string;
}

const PAGE_SIZE = 100;

function parseDetails(raw: unknown): AttemptDetail[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((item: unknown) => {
    if (!item || typeof item !== "object") return {};
    const d = item as Record<string, unknown>;
    return {
      title: (d.title as string) || undefined,
      quizId: (d.quizId as string) || undefined,
      score: typeof d.score === "number" ? d.score : (d.score ? Number(d.score) : undefined),
      totalQuestions: typeof d.totalQuestions === "number" ? d.totalQuestions : (d.totalQuestions ? Number(d.totalQuestions) : undefined),
      completed: Boolean(d.completed),
      date: (d.date as string) || undefined,
    };
  });
}

function ScoreBadge({ score, total }: { score?: number; total?: number }) {
  if (score === undefined) return <span className="text-muted text-xs">—</span>;
  // When score > totalQuestions the quiz uses weighted points (e.g. 4pts per question).
  // In that case showing "44/25" is misleading — display just the points tally instead.
  const isWeighted = total !== undefined && score > total;
  const pct = (!isWeighted && total) ? Math.round((score / total) * 100) : null;
  const color = pct === null
    ? (score === 0 ? "bg-red-50 text-red-600 border-red-100" : "bg-surface text-ink border-border")
    : pct >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : pct >= 50 ? "bg-amber-50 text-amber-700 border-amber-100"
    : "bg-red-50 text-red-600 border-red-100";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold border ${color}`}>
      {isWeighted
        ? <>{score} <span className="ml-0.5 font-normal opacity-60">pts</span></>
        : <>{score}{total ? `/${total}` : ""}</>
      }
      {pct !== null && <span className="ml-1 opacity-60">({pct}%)</span>}
    </span>
  );
}

export default function AssessmentHistoryPage() {
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/all-assessments?page=${p}&limit=${PAGE_SIZE}`);
      setRecords(res.data.assessments || []);
      setTotal(res.data.total || 0);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleExport = () => {
    const exportRows: Record<string, unknown>[] = [];
    records.forEach((r, i) => {
      const attempts = parseDetails(r.details);
      if (attempts.length === 0) {
        exportRows.push({
          "#": page * PAGE_SIZE + i + 1,
          Student: r.studentName || r.userId || "—",
          School: r.studentSchool || "—",
          Quiz: "—", Score: "—", Total: "—", "Pass?": "—", Date: "—",
          "Record Date": r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—",
        });
      } else {
        attempts.forEach((a) => {
          exportRows.push({
            "#": page * PAGE_SIZE + i + 1,
            Student: r.studentName || r.userId || "—",
            School: r.studentSchool || "—",
            Quiz: a.title || "—",
            Score: a.score ?? "—",
            Total: a.totalQuestions ?? "—",
            "Pass?": a.completed ? "Yes" : "No",
            Date: a.date || (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"),
          });
        });
      }
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assessment History");
    XLSX.writeFile(wb, `Gifted_Assessments_p${page + 1}.xlsx`);
  };

  return (
    <AuthGuard>
      <DashboardShell title="Assessment History">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {total.toLocaleString()} assessment records. Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()}.
            Click a row to see attempt details.
          </p>

          <Card
            title={`${total.toLocaleString()} records`}
            padding={false}
            action={
              records.length > 0 && (
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  <Download size={14} /> Export page
                </Button>
              )
            }
          >
            {loading ? (
              <Spinner text="Loading assessment history..." />
            ) : records.length === 0 ? (
              <p className="text-muted text-sm py-12 text-center">No records found.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface/50">
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">#</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Student</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Attempts</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Latest quiz</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Score</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                      <th className="px-5 py-2.5 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => {
                      const attempts = parseDetails(r.details);
                      const latest = attempts[attempts.length - 1];
                      const isOpen = expanded.has(r._id);
                      const hasName = Boolean(r.studentName);

                      return (
                        <>
                          <tr
                            key={r._id}
                            onClick={() => attempts.length > 0 && toggle(r._id)}
                            className="border-b border-border hover:bg-surface/40 transition-colors cursor-pointer"
                          >
                            <td className="px-5 py-3 text-muted text-xs">{page * PAGE_SIZE + i + 1}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                                  <User size={12} className="text-primary" />
                                </div>
                                <div>
                                  <p className={`text-sm font-medium leading-tight ${hasName ? "text-ink" : "text-muted font-mono text-xs"}`}>
                                    {r.studentName || r.userId || "—"}
                                  </p>
                                  {r.studentSchool && (
                                    <p className="text-xs text-muted">{r.studentSchool}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className="px-2 py-0.5 bg-surface border border-border rounded-lg text-xs font-medium text-ink">
                                {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-ink text-sm max-w-[220px] truncate">
                              {latest?.title || <span className="text-muted">—</span>}
                            </td>
                            <td className="px-5 py-3">
                              <ScoreBadge score={latest?.score} total={latest?.totalQuestions} />
                            </td>
                            <td className="px-5 py-3 text-muted text-xs">
                              {latest?.date || (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—")}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {attempts.length > 0 && (
                                isOpen
                                  ? <ChevronUp size={14} className="text-muted" />
                                  : <ChevronDown size={14} className="text-muted" />
                              )}
                            </td>
                          </tr>

                          {isOpen && attempts.map((a, j) => (
                            <tr key={`${r._id}-${j}`} className="border-b border-border bg-surface/30">
                              <td className="px-5 py-2.5" />
                              <td className="px-5 py-2.5" colSpan={2}>
                                <div className="flex items-center gap-1.5">
                                  {a.completed
                                    ? <CheckCircle size={12} className="text-emerald-500 shrink-0" />
                                    : <XCircle size={12} className="text-red-400 shrink-0" />
                                  }
                                  <span className="text-xs text-muted">{a.completed ? "Completed" : "Incomplete"}</span>
                                </div>
                              </td>
                              <td className="px-5 py-2.5 text-sm text-ink font-medium">{a.title || "—"}</td>
                              <td className="px-5 py-2.5">
                                <ScoreBadge score={a.score} total={a.totalQuestions} />
                              </td>
                              <td className="px-5 py-2.5 text-xs text-muted" colSpan={2}>{a.date || "—"}</td>
                            </tr>
                          ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-4 border-t border-border">
                    <span className="text-sm text-muted">Page {page + 1} of {totalPages}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                        const start = Math.max(0, Math.min(page - 3, totalPages - 7));
                        const pg = start + i;
                        return (
                          <button key={pg} onClick={() => setPage(pg)}
                            className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${pg === page ? "bg-primary text-white" : "text-muted hover:text-ink hover:bg-surface border border-border"}`}>
                            {pg + 1}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
