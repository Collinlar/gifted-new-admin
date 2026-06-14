"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Star } from "lucide-react";

interface Feedback {
  _id: string;
  quizId?: string;
  userId?: string;
  content?: string;
  comment?: string;
  rating?: number;
  createdAt?: string;
}
interface Quiz { _id: string; mongoId?: string; title: string; }

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={12} className={s <= rating ? "text-amber-400 fill-amber-400" : "text-border"} />
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [all, setAll] = useState<Feedback[]>([]);
  const [filtered, setFiltered] = useState<Feedback[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get("/all-exams-admin"),
      api.get("/all-fedback"),
    ]).then(([q, f]) => {
      if (q.status === "fulfilled") {
        setQuizzes(q.value.data.allExaminations || q.value.data.exams || []);
      }
      if (f.status === "fulfilled") {
        const data = f.value.data.allFeedback || f.value.data.feedbacks || [];
        setAll(data);
        setFiltered(data);
      }
    }).finally(() => setLoading(false));
  }, []);

  const handleFilter = (val: string) => {
    setSelected(val);
    if (!val) { setFiltered(all); return; }
    // Match on quizId which stores the MongoDB ObjectId of the exam
    const quiz = quizzes.find((q) => q._id === val);
    const matchId = quiz?.mongoId || val;
    setFiltered(all.filter((fb) => fb.quizId === val || fb.quizId === matchId));
  };

  const avgRating = filtered.filter((f) => f.rating).length
    ? (filtered.reduce((s, f) => s + (f.rating || 0), 0) / filtered.filter((f) => f.rating).length).toFixed(1)
    : null;

  return (
    <AuthGuard>
      <DashboardShell title="Feedback">
        <div className="space-y-4 max-w-3xl">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="space-y-1 flex-1 min-w-48">
              <label className="text-sm font-medium text-ink">Filter by quiz</label>
              <select
                value={selected}
                onChange={(e) => handleFilter(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">All feedback ({all.length})</option>
                {quizzes.map((q) => <option key={q._id} value={q._id}>{q.title}</option>)}
              </select>
            </div>
            {avgRating && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-center shrink-0">
                <p className="text-xl font-bold text-amber-700">{avgRating}<span className="text-sm font-normal">/5</span></p>
                <p className="text-xs text-amber-600 mt-0.5">Avg rating</p>
              </div>
            )}
          </div>

          <Card title={`${filtered.length} submission${filtered.length !== 1 ? "s" : ""}`} padding={false}>
            {loading ? (
              <Spinner text="Loading feedback..." />
            ) : filtered.length === 0 ? (
              <p className="text-muted text-sm py-12 text-center">No feedback found.</p>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((fb, i) => (
                  <div key={fb._id || i} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink">{fb.content || fb.comment || <span className="text-muted italic">No comment</span>}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {fb.rating !== undefined && fb.rating > 0 && <StarRating rating={fb.rating} />}
                        {fb.createdAt && (
                          <span className="text-xs text-subtle">{new Date(fb.createdAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
