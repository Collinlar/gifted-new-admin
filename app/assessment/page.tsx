"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Plus, Eye, Trash2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

interface Question { question: string; answers: string[]; correctAnswer: string; explanation: string; }
interface Quiz { _id: string; title: string; contest?: boolean; duration?: number; questions?: Question[]; }

export default function AssessmentPage() {
  const router = useRouter();
  const [items, setItems] = useState<Quiz[]>([]);
  const [tab, setTab] = useState<"normal" | "contests">("normal");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await api.get("/all-exams-admin");
      setItems(res.data.allExaminations || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter((q) => {
    const matchTab = tab === "contests" ? q.contest === true : !q.contest;
    const matchSearch = !search.trim() || q.title?.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this quiz? This cannot be undone.")) return;
    await api.delete(`/delete-exam/${id}`);
    setItems((p) => p.filter((q) => q._id !== id));
  };

  const viewDetails = (q: Quiz) => {
    localStorage.setItem("id", q._id);
    router.push("/assessment/quiz-details");
  };

  const tabCounts = {
    normal: items.filter((q) => !q.contest).length,
    contests: items.filter((q) => q.contest === true).length,
  };

  return (
    <AuthGuard>
      <DashboardShell title="Assessments">
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
              {(["normal", "contests"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-primary text-white shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {t === "normal" ? "Quizzes" : "Contests"}
                  <span className={`ml-1.5 text-xs ${tab === t ? "text-white/70" : "text-subtle"}`}>
                    {tabCounts[t]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search quizzes..."
                  className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-44"
                />
              </div>
              <Button size="sm" onClick={() => router.push("/assessment/add")}>
                <Plus size={14} /> Add quiz
              </Button>
            </div>
          </div>

          {/* Table */}
          <Card padding={false}>
            {loading ? (
              <Spinner text="Loading quizzes..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-muted text-sm">
                  {search ? `No quizzes matching "${search}"` : `No ${tab === "contests" ? "contest" : ""} quizzes yet.`}
                </p>
                <Button size="sm" className="mt-4" onClick={() => router.push("/assessment/add")}>
                  <Plus size={14} /> Add your first quiz
                </Button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 text-muted font-medium">Title</th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Questions</th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Duration</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((q) => (
                    <tr key={q._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-ink">{q.title}</td>
                      <td className="px-5 py-3.5 text-muted">{q.questions?.length ?? 0}</td>
                      <td className="px-5 py-3.5 text-muted">{q.duration ? `${q.duration} min` : "—"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => viewDetails(q)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-primary-light transition-colors font-medium"
                          >
                            <Eye size={13} /> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(q._id)}
                            className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
