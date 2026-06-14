"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import api from "@/lib/api";
import { Download, FileText, TrendingUp, User, ChevronDown, ChevronUp } from "lucide-react";
import * as XLSX from "xlsx";

interface ReviewActivity {
  type: "file" | "progress" | "unknown";
  fileUrl?: string;
  progress?: number;
  raw?: unknown;
}

interface CourseReview {
  _id: string;
  userId?: string;
  courseId?: string;
  studentName?: string;
  studentSchool?: string;
  courseTitle?: string;
  review?: unknown;
  createdAt?: string;
}

// Parse the review array into meaningful activities
function parseActivities(review: unknown): ReviewActivity[] {
  if (!review) return [];
  const arr = Array.isArray(review) ? review : [review];
  return arr.map((item: unknown) => {
    if (!item || typeof item !== "object") return { type: "unknown", raw: item };
    const obj = item as Record<string, unknown>;

    // Case: file URL is a direct string at obj.file
    // e.g. {file: "https://...", status: true, courseId: "..."}
    if (typeof obj.file === "string" && obj.file) {
      return { type: "file", fileUrl: obj.file };
    }

    const reviewObj = obj.review as Record<string, unknown> | undefined;

    // Case: file URL inside obj.review.file
    // e.g. {review: {file: "https://...", status: true}, userId: "..."}
    if (reviewObj?.file && typeof reviewObj.file === "string") {
      return { type: "file", fileUrl: reviewObj.file };
    }

    // Case: progress inside obj.review.progress
    if (reviewObj?.progress !== undefined) {
      return { type: "progress", progress: Number(reviewObj.progress) };
    }

    // Case: direct progress at obj.progress
    if (obj.progress !== undefined) {
      return { type: "progress", progress: Number(obj.progress) };
    }

    return { type: "unknown", raw: item };
  });
}

function ActivityBadge({ act }: { act: ReviewActivity }) {
  if (act.type === "file") {
    const filename = act.fileUrl?.split("/").pop()?.split("?")[0] || "File";
    const decoded = decodeURIComponent(filename).replace(/^\d+-/, "");
    return (
      <a
        href={act.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors max-w-xs truncate"
        title={decoded}
      >
        <FileText size={11} className="shrink-0" />
        <span className="truncate">{decoded}</span>
      </a>
    );
  }
  if (act.type === "progress") {
    const pct = act.progress ?? 0;
    const color = pct >= 100 ? "bg-emerald-50 text-emerald-700 border-emerald-100"
      : pct >= 50 ? "bg-amber-50 text-amber-700 border-amber-100"
      : "bg-surface text-muted border-border";
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-xs font-medium ${color}`}>
        <TrendingUp size={11} />
        {pct}% progress
      </span>
    );
  }
  return <span className="text-xs text-muted italic">Unknown activity</span>;
}

export default function CourseReviewsPage() {
  const [all, setAll] = useState<CourseReview[]>([]);
  const [filtered, setFiltered] = useState<CourseReview[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get("/all-course-reviews").then((res) => {
      const data: CourseReview[] = res.data.reviews || res.data.courseReviews || [];
      setAll(data);
      setFiltered(data);

      // Build course list from the enriched data itself (no second request needed)
      const seen = new Map<string, string>();
      for (const r of data) {
        if (r.courseId && r.courseTitle && !seen.has(r.courseId)) {
          seen.set(r.courseId, r.courseTitle);
        }
      }
      setCourses([...seen.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)));
    }).catch(() => setAll([])).finally(() => setLoading(false));
  }, []);

  const handleFilter = (val: string) => {
    setSelected(val);
    setFiltered(val ? all.filter((r) => r.courseId === val) : all);
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    const rows = filtered.map((r, i) => {
      const acts = parseActivities(r.review);
      return {
        "#": i + 1,
        Student: r.studentName || "—",
        School: r.studentSchool || "—",
        Course: r.courseTitle || "—",
        Activities: acts.length,
        "File submissions": acts.filter((a) => a.type === "file").length,
        "Progress updates": acts.filter((a) => a.type === "progress").map((a) => `${a.progress}%`).join(", "),
        Date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Course Reviews");
    XLSX.writeFile(wb, "Gifted_CourseActivity.xlsx");
  };

  // Summary counts
  const fileCount = filtered.reduce((n, r) => n + parseActivities(r.review).filter((a) => a.type === "file").length, 0);
  const completions = filtered.filter((r) => parseActivities(r.review).some((a) => a.type === "progress" && (a.progress ?? 0) >= 100)).length;

  return (
    <AuthGuard>
      <DashboardShell title="Course Activity">
        <div className="space-y-4 max-w-4xl">
          {/* Summary row */}
          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total records", value: filtered.length },
                { label: "File submissions", value: fileCount },
                { label: "Completions (100%)", value: completions },
              ].map(({ label, value }) => (
                <div key={label} className="bg-card border border-border rounded-xl px-4 py-3">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-2xl font-bold text-ink mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filter + export */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selected}
              onChange={(e) => handleFilter(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary min-w-64 bg-card"
            >
              <option value="">All courses ({all.length} records)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            {filtered.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleExport}>
                <Download size={14} /> Export
              </Button>
            )}
          </div>

          <Card
            title={`${filtered.length} activity record${filtered.length !== 1 ? "s" : ""}${selected ? ` · ${courses.find(c => c.id === selected)?.title || ""}` : ""}`}
            padding={false}
          >
            {loading ? (
              <Spinner text="Loading course activity..." />
            ) : filtered.length === 0 ? (
              <p className="text-muted text-sm py-12 text-center">No records found.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">#</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Student</th>
                    {!selected && <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Course</th>}
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Activity</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                    <th className="px-5 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const acts = parseActivities(r.review);
                    const isOpen = expandedRows.has(r._id);
                    const primary = acts[0];
                    return (
                      <>
                        <tr
                          key={r._id}
                          className="border-b border-border hover:bg-surface/40 transition-colors cursor-pointer"
                          onClick={() => acts.length > 1 && toggleRow(r._id)}
                        >
                          <td className="px-5 py-3 text-muted text-xs">{i + 1}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                                <User size={11} className="text-primary" />
                              </div>
                              <div>
                                <p className="font-medium text-ink text-sm leading-tight">{r.studentName || "Unknown student"}</p>
                                {r.studentSchool && <p className="text-xs text-muted">{r.studentSchool}</p>}
                              </div>
                            </div>
                          </td>
                          {!selected && (
                            <td className="px-5 py-3 text-muted text-xs max-w-[180px] truncate">{r.courseTitle || "—"}</td>
                          )}
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              {primary ? <ActivityBadge act={primary} /> : <span className="text-xs text-muted">—</span>}
                              {acts.length > 1 && (
                                <span className="text-xs text-muted">+{acts.length - 1} more</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-muted text-xs">
                            {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {acts.length > 1 && (
                              isOpen ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />
                            )}
                          </td>
                        </tr>
                        {isOpen && acts.slice(1).map((act, j) => (
                          <tr key={`${r._id}-${j}`} className="border-b border-border bg-surface/30">
                            <td className="px-5 py-2" />
                            <td className="px-5 py-2" />
                            {!selected && <td className="px-5 py-2" />}
                            <td className="px-5 py-2" colSpan={3}>
                              <ActivityBadge act={act} />
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
