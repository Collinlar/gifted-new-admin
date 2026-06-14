"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";

interface Exam {
  _id: string;
  title: string;
  contest?: boolean;
  questions?: unknown[];
  duration?: string | number;
  [key: string]: unknown;
}

export default function ExamModePage() {
  const router = useRouter();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/all-exams-admin").then((res) => {
      setExams((res.data.allExaminations || []).filter((e: Exam) => e.contest === true));
    }).finally(() => setLoading(false));
  }, []);

  return (
    <AuthGuard>
      <DashboardShell title="Exam Mode">
        <Card title="Contest Exams">
          {loading ? (
            <Spinner text="Loading exams..." />
          ) : exams.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No contest exams found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Title", "Questions", "Duration", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exams.map((e) => (
                    <tr key={e._id} className="border-b border-border last:border-0 hover:bg-surface/50">
                      <td className="px-4 py-3 font-medium text-ink">{e.title}</td>
                      <td className="px-4 py-3 text-muted">{e.questions?.length ?? 0}</td>
                      <td className="px-4 py-3 text-muted">{e.duration ? `${e.duration} min` : "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { localStorage.setItem("id", e._id); router.push("/assessment/quiz-details"); }}
                          className="flex items-center gap-1 text-sm text-cobalt hover:text-ink"
                        >
                          <Eye size={13} /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardShell>
    </AuthGuard>
  );
}
