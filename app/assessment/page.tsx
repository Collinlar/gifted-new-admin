"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Plus, Eye, Trash2, Search, UploadCloud, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";

interface Question { question: string; answers: string[]; correctAnswer: string; explanation: string; }
interface Quiz { _id: string; title: string; contest?: boolean; duration?: number; questions?: Question[]; publish?: boolean; grade?: string | string[]; }

export default function AssessmentPage() {
  const router = useRouter();
  const [items, setItems] = useState<Quiz[]>([]);
  const [tab, setTab] = useState<"normal" | "contests">("normal");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

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
    const matchStatus = status === "all" ? true
      : status === "published" ? q.publish === true : q.publish !== true;
    return matchTab && matchSearch && matchStatus;
  });

  // Publishing is what decides whether students can see an assessment at all,
  // so it belongs on the list rather than buried in the edit form.
  const setPublished = async (ids: string[], publish: boolean) => {
    if (ids.length === 0) return;
    setBusy(true); setNotice("");
    // Move the switch immediately; the list is the control surface and a
    // half-second of nothing happening reads as a broken toggle.
    setItems((p) => p.map((q) => (ids.includes(q._id) ? { ...q, publish } : q)));
    try {
      await Promise.all(ids.map((id) => api.put(`/update-exam/${id}`, { publish })));
      setNotice(
        ids.length === 1
          ? publish ? "Published. Students can see it now." : "Unpublished. Hidden from students."
          : `${ids.length} assessments ${publish ? "published" : "unpublished"}.`
      );
      setPicked(new Set());
    } catch {
      setNotice("Could not save that. Reloading.");
      load();
    } finally { setBusy(false); }
  };

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const counts = {
    published: items.filter((q) => q.publish === true).length,
    draft: items.filter((q) => q.publish !== true).length,
  };

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
              <Button variant="secondary" size="sm" onClick={() => router.push("/assessment/bulk")}>
                <UploadCloud size={14} /> Bulk upload
              </Button>
              <Button size="sm" onClick={() => router.push("/assessment/add")}>
                <Plus size={14} /> Add quiz
              </Button>
            </div>
          </div>

          {/* Status filter. Draft is where a half-built assessment sits, and it
              is worth being able to see that list on its own. */}
          <div className="flex items-center gap-2 flex-wrap">
            {([
              ["all", `Everything (${items.length})`],
              ["published", `Live for students (${counts.published})`],
              ["draft", `Draft (${counts.draft})`],
            ] as const).map(([v, label]) => (
              <button key={v} onClick={() => { setStatus(v); setPicked(new Set()); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  status === v ? "bg-primary text-white border-primary"
                               : "border-border text-muted hover:border-primary hover:text-primary"
                }`}>
                {label}
              </button>
            ))}
          </div>

          {notice && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
              {notice}
            </p>
          )}

          {picked.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap bg-primary-light/40 border border-border rounded-xl px-4 py-2.5">
              <span className="text-sm font-medium text-ink">{picked.size} selected</span>
              <Button size="sm" disabled={busy} onClick={() => setPublished([...picked], true)}>
                <Globe size={13} /> Publish
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPublished([...picked], false)}>
                <Lock size={13} /> Unpublish
              </Button>
              <button onClick={() => setPicked(new Set())} className="text-xs text-muted hover:text-ink ml-1">
                Clear
              </button>
            </div>
          )}

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
                    <th className="px-4 py-3 w-8">
                      <input type="checkbox"
                        checked={filtered.length > 0 && filtered.every((q) => picked.has(q._id))}
                        onChange={(e) => setPicked(e.target.checked ? new Set(filtered.map((q) => q._id)) : new Set())} />
                    </th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Title</th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Questions</th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Duration</th>
                    <th className="text-left px-5 py-3 text-muted font-medium">Visible to students</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((q) => (
                    <tr key={q._id} className={`border-b border-border last:border-0 hover:bg-surface/60 transition-colors ${q.publish ? "" : "bg-surface/30"}`}>
                      <td className="px-4 py-3.5">
                        <input type="checkbox" checked={picked.has(q._id)} onChange={() => toggle(q._id)} />
                      </td>
                      <td className="px-5 py-3.5 font-medium text-ink">
                        {q.title}
                        {!q.publish && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-surface text-muted border border-border">
                            Draft
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-muted">{q.questions?.length ?? 0}</td>
                      <td className="px-5 py-3.5 text-muted">{q.duration ? `${q.duration} min` : "—"}</td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => setPublished([q._id], !q.publish)}
                          disabled={busy}
                          title={q.publish ? "Hide from students" : "Make visible to students"}
                          className="flex items-center gap-2 group disabled:opacity-60"
                        >
                          <span className={`w-9 h-5 rounded-full transition-colors relative flex items-center shrink-0 ${q.publish ? "bg-emerald-500" : "bg-border"}`}>
                            <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${q.publish ? "translate-x-4" : "translate-x-0.5"}`} />
                          </span>
                          <span className={`text-xs font-medium ${q.publish ? "text-emerald-700" : "text-muted"}`}>
                            {q.publish ? "Live" : "Hidden"}
                          </span>
                        </button>
                      </td>
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
