"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { BookOpen, ChevronDown, ChevronUp, Download } from "lucide-react";
import * as XLSX from "xlsx";

interface Course { _id: string; title: string; modules?: unknown[]; }
interface ProgressEntry {
  _id: string;
  userId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  completedModules?: number;
  totalModules?: number;
  progress?: number;
  lastActivity?: string;
  completed?: boolean;
}

export default function CourseProgressPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<Record<string, ProgressEntry[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loadingCourses, setLoadingCourses] = useState(true);

  useEffect(() => {
    api.get("/all-courses-admin-info").then((res) => {
      setCourses(res.data.courses || []);
    }).finally(() => setLoadingCourses(false));
  }, []);

  const toggle = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (progressData[id]) return;
    setLoading((l) => ({ ...l, [id]: true }));
    try {
      let data: ProgressEntry[] = [];
      try {
        const res = await api.get(`/course-progress-all/${id}`);
        data = res.data.progress || res.data.results || res.data || [];
      } catch {
        try {
          const res = await api.get(`/all-course-progress/${id}`);
          data = res.data.progress || res.data || [];
        } catch {
          data = [];
        }
      }
      setProgressData((p) => ({ ...p, [id]: Array.isArray(data) ? data : [] }));
    } finally {
      setLoading((l) => ({ ...l, [id]: false }));
    }
  };

  const getName = (r: ProgressEntry) =>
    r.name || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "—";

  const getPercent = (r: ProgressEntry) => {
    if (r.progress !== undefined) return Math.round(r.progress);
    if (r.completedModules !== undefined && r.totalModules) {
      return Math.round((r.completedModules / r.totalModules) * 100);
    }
    return r.completed ? 100 : 0;
  };

  const exportProgress = (title: string, id: string) => {
    const data = (progressData[id] || []).map((r) => ({
      Name: getName(r),
      Email: r.email || "",
      "Completed Modules": r.completedModules ?? "",
      "Total Modules": r.totalModules ?? "",
      "Progress %": getPercent(r),
      Completed: r.completed ? "Yes" : "No",
      "Last Activity": r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Progress");
    XLSX.writeFile(wb, `${title}_Progress.xlsx`);
  };

  return (
    <AuthGuard>
      <DashboardShell title="Course Progress">
        <div className="space-y-2 max-w-4xl">
          <p className="text-sm text-muted mb-4">Click any course to see how users are progressing through it.</p>

          {loadingCourses ? (
            <Spinner text="Loading courses..." />
          ) : courses.length === 0 ? (
            <Card><p className="text-muted text-sm py-8 text-center">No courses found.</p></Card>
          ) : (
            courses.map((course) => {
              const isOpen = expanded === course._id;
              const list = progressData[course._id] || [];
              const isLoading = loading[course._id];
              const completedCount = list.filter((r) => r.completed || getPercent(r) === 100).length;
              const avgProgress = list.length
                ? Math.round(list.reduce((sum, r) => sum + getPercent(r), 0) / list.length)
                : 0;

              return (
                <div key={course._id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
                  <button
                    onClick={() => toggle(course._id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <BookOpen size={15} className="text-emerald-600" />
                      </div>
                      <div>
                        <p className="font-medium text-ink text-sm">{course.title}</p>
                        {isOpen && list.length > 0 && (
                          <p className="text-xs text-muted mt-0.5">
                            {list.length} enrolled · <span className="text-emerald-600 font-medium">{completedCount} completed</span> · avg {avgProgress}%
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      {isOpen && list.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); exportProgress(course.title, course._id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-ink hover:border-primary/40 transition-colors"
                        >
                          <Download size={12} /> Export
                        </button>
                      )}
                      {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border">
                      {isLoading ? (
                        <Spinner text="Loading progress data..." />
                      ) : list.length === 0 ? (
                        <p className="text-muted text-sm py-8 text-center">No progress data yet for this course.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-surface/50">
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Student</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Email</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs w-48">Progress</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Status</th>
                              <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Last active</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((r) => {
                              const pct = getPercent(r);
                              const done = r.completed || pct === 100;
                              return (
                                <tr key={r._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                                  <td className="px-5 py-3 font-medium text-ink">{getName(r)}</td>
                                  <td className="px-5 py-3 text-muted text-sm">{r.email || "—"}</td>
                                  <td className="px-5 py-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-primary"}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <span className="text-xs text-muted w-8 text-right">{pct}%</span>
                                    </div>
                                  </td>
                                  <td className="px-5 py-3">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${done ? "bg-emerald-50 text-emerald-700" : "bg-primary-light text-primary"}`}>
                                      {done ? "Completed" : "In progress"}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 text-muted text-sm">
                                    {r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
