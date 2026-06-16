"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";

interface Track {
  _id: string;
  name: string;
  slug: string;
}

interface TrackableItem {
  id: string;
  type: "competition" | "course" | "exam" | "camp";
  label: string;
  trackIds: string[];
}

const TYPE_LABELS: Record<TrackableItem["type"], string> = {
  competition: "Competitions",
  course: "Resources",
  exam: "Assessments",
  camp: "Camps",
};

export default function TrackTaggingPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [items, setItems] = useState<TrackableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [tracksRes, itemsRes] = await Promise.all([
        api.get("/all-tracks"),
        api.get("/trackable-items"),
      ]);
      setTracks(tracksRes.data.tracks || []);
      setItems(itemsRes.data.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleTrack = async (item: TrackableItem, trackId: string) => {
    const updated = item.trackIds.includes(trackId)
      ? item.trackIds.filter((id) => id !== trackId)
      : [...item.trackIds, trackId];

    const key = `${item.type}-${item.id}`;
    setItems((prev) => prev.map((i) => (i.id === item.id && i.type === item.type ? { ...i, trackIds: updated } : i)));
    setSavingKey(key);
    try {
      await api.put(`/set-item-tracks/${item.type}/${item.id}`, { trackIds: updated });
    } catch {
      // revert on failure
      setItems((prev) => prev.map((i) => (i.id === item.id && i.type === item.type ? { ...i, trackIds: item.trackIds } : i)));
    } finally {
      setSavingKey(null);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false
      if (search && !item.label?.toLowerCase().includes(search.toLowerCase())) return false
      return true
    });
  }, [items, typeFilter, search]);

  return (
    <AuthGuard>
      <DashboardShell title="Track Tagging">
        <Card
          title="Subject Tracks"
          subtitle="Tick the tracks each competition, resource, assessment, or camp belongs to. Changes save immediately."
          padding={false}
        >
          <div className="p-5 flex flex-wrap gap-3 border-b border-border">
            <Input
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-ink"
            >
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <Spinner text="Loading trackable content..." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 font-medium text-muted">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted">Name</th>
                    {tracks.map((track) => (
                      <th key={track._id} className="text-center px-4 py-3 font-medium text-muted whitespace-nowrap">{track.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const rowKey = `${item.type}-${item.id}`;
                    const isSaving = savingKey === rowKey;
                    return (
                      <tr key={rowKey} className="border-b border-border last:border-0" style={{ opacity: isSaving ? 0.6 : 1 }}>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{TYPE_LABELS[item.type]}</td>
                        <td className="px-4 py-3 text-ink">{item.label}</td>
                        {tracks.map((track) => (
                          <td key={track._id} className="text-center px-4 py-3">
                            <input
                              type="checkbox"
                              checked={item.trackIds.includes(track._id)}
                              disabled={isSaving}
                              onChange={() => toggleTrack(item, track._id)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={2 + tracks.length} className="px-4 py-10 text-center text-muted">No items match this search.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardShell>
    </AuthGuard>
  );
}
