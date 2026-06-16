"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";

interface TrackCount { id: string; name: string; userCount: number }
interface CampCount { id: string; name: string; registeredCount: number }

export default function TrackInsightsPage() {
  const [trackCounts, setTrackCounts] = useState<TrackCount[]>([]);
  const [campCounts, setCampCounts] = useState<CampCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/track-analytics").then((res) => {
      setTrackCounts(res.data.trackCounts || []);
      setCampCounts(res.data.campCounts || []);
    }).finally(() => setLoading(false));
  }, []);

  const maxTrack = Math.max(1, ...trackCounts.map((t) => t.userCount));
  const maxCamp = Math.max(1, ...campCounts.map((c) => c.registeredCount));

  return (
    <AuthGuard>
      <DashboardShell title="Track Insights">
        {loading ? (
          <Spinner text="Loading insights..." />
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Students per track" subtitle="How many students have selected each track">
              <div className="space-y-3">
                {trackCounts.length === 0 && <p className="text-sm text-muted">No tracks yet.</p>}
                {trackCounts.map((t) => (
                  <div key={t.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-ink font-medium">{t.name}</span>
                      <span className="text-muted">{t.userCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(t.userCount / maxTrack) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Camp registrations" subtitle="Sign-ups per camp (excludes cancelled)">
              <div className="space-y-3">
                {campCounts.length === 0 && <p className="text-sm text-muted">No camps yet.</p>}
                {campCounts.map((c) => (
                  <div key={c.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-ink font-medium">{c.name}</span>
                      <span className="text-muted">{c.registeredCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(c.registeredCount / maxCamp) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </DashboardShell>
    </AuthGuard>
  );
}
