"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { ArrowLeft, Users } from "lucide-react";

interface SubType {
  _id?: string;
  name: string;
  startDate?: string;
  endDate?: string;
  cost?: string | number;
  paid?: number;
  registered?: unknown[];
}

interface Competition {
  _id: string;
  name: string;
  subTypes?: SubType[];
}

export default function CompetitionDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/all-competitions").then((res) => {
      const all: Competition[] = res.data.AllCompetitions || [];
      const found = all.find((c) => c._id === params.id);
      setCompetition(found || null);
    }).finally(() => setLoading(false));
  }, [params.id]);

  return (
    <AuthGuard>
      <DashboardShell title={competition?.name || "Competition Details"}>
        <div className="space-y-4 max-w-4xl">
          <Button variant="ghost" size="sm" onClick={() => router.push("/competitions")}>
            <ArrowLeft size={14} /> Back to competitions
          </Button>

          <Card title="Sub-categories" padding={false}>
            {loading ? (
              <Spinner text="Loading details..." />
            ) : !competition ? (
              <p className="text-muted text-sm py-8 text-center px-5">Competition not found.</p>
            ) : (competition.subTypes?.length ?? 0) === 0 ? (
              <p className="text-muted text-sm py-8 text-center px-5">No sub-categories for this competition.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Name", "Start Date", "End Date", "Cost", "Paid", "Registered"].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {competition.subTypes!.map((s, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/60">
                      <td className="px-5 py-3.5 font-medium text-ink">{s.name}</td>
                      <td className="px-5 py-3.5 text-muted">{s.startDate || "—"}</td>
                      <td className="px-5 py-3.5 text-muted">{s.endDate || "—"}</td>
                      <td className="px-5 py-3.5 text-muted">{s.cost ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700 font-medium">
                          {s.paid ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-1.5 text-muted text-sm">
                          <Users size={13} />
                          {(s.registered as unknown[] | undefined)?.length ?? 0}
                        </span>
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
