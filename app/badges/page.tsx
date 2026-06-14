"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2, Edit2, Award } from "lucide-react";

interface Badge {
  _id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria?: string;
  criteriaValue?: number;
  type?: string;
  isActive?: boolean;
}

const BADGE_TYPES = ["Quiz Score", "Course Completion", "Contest Rank", "Streak", "Registration", "Manual"];
const COLORS = [
  { label: "Gold", value: "#F59E0B" },
  { label: "Silver", value: "#94A3B8" },
  { label: "Bronze", value: "#D97706" },
  { label: "Indigo", value: "#4F46E5" },
  { label: "Emerald", value: "#10B981" },
  { label: "Rose", value: "#F43F5E" },
];
const ICONS = ["🏆", "🥇", "🥈", "🥉", "⭐", "🎯", "📚", "🔬", "🧠", "💡", "🎖️", "🌟", "🔥", "💎"];

const blank = (): Partial<Badge> => ({
  name: "", description: "", icon: "🏆", color: "#F59E0B",
  criteria: "", criteriaValue: 0, type: "Quiz Score", isActive: true,
});

export default function BadgesPage() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);
  const [form, setForm] = useState<Partial<Badge>>(blank());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-badges");
      setBadges(res.data.badges || res.data || []);
    } catch {
      setBadges([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(blank()); setError(""); setPanelOpen(true); };
  const openEdit = (b: Badge) => { setEditing(b); setForm({ ...b }); setError(""); setPanelOpen(true); };
  const closePanel = () => { setPanelOpen(false); setEditing(null); setForm(blank()); };

  const handleSave = async () => {
    setError("");
    if (!form.name?.trim()) return setError("Give this badge a name.");
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/update-badge/${editing._id}`, form);
      } else {
        await api.post("/add-badge", form);
      }
      await load();
      closePanel();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this badge?")) return;
    await api.delete(`/delete-badge/${id}`);
    setBadges((p) => p.filter((b) => b._id !== id));
  };

  return (
    <AuthGuard>
      <DashboardShell title="Badges">
        <div className="space-y-4 max-w-4xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Define badges and the criteria for earning them.</p>
            <Button size="sm" onClick={openAdd}><Plus size={14} /> New badge</Button>
          </div>

          {loading ? (
            <Spinner text="Loading badges..." />
          ) : badges.length === 0 ? (
            <Card>
              <div className="py-16 text-center">
                <Award size={32} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No badges defined yet.</p>
                <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Create first badge</Button>
              </div>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {badges.map((b) => (
                <div key={b._id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: b.color ? b.color + "22" : "#F59E0B22" }}>
                    {b.icon || "🏆"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink text-sm">{b.name}</p>
                      {!b.isActive && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface text-subtle border border-border">Inactive</span>
                      )}
                    </div>
                    {b.description && <p className="text-xs text-muted mt-0.5">{b.description}</p>}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {b.type && <span className="text-xs px-2 py-0.5 rounded bg-primary-light text-primary font-medium">{b.type}</span>}
                      {b.criteria && <span className="text-xs text-muted">{b.criteria}{b.criteriaValue ? `: ${b.criteriaValue}` : ""}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(b)} className="p-1.5 rounded-lg text-subtle hover:text-ink transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(b._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SlidePanel open={panelOpen} onClose={closePanel} title={editing ? "Edit badge" : "New badge"} width="lg">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Badge name</label>
              <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Gold Olympian"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                placeholder="What does this badge mean?"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((ic) => (
                  <button key={ic} type="button" onClick={() => setForm({ ...form, icon: ic })}
                    className={`w-9 h-9 rounded-lg text-xl flex items-center justify-center border transition-colors ${form.icon === ic ? "border-primary bg-primary-light" : "border-border bg-white hover:border-primary/40"}`}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Color</label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button key={c.value} type="button" onClick={() => setForm({ ...form, color: c.value })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border font-medium transition-colors ${form.color === c.value ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}>
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.value }} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Type</label>
                <select value={form.type || "Quiz Score"} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                  {BADGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Criteria value</label>
                <input type="number" value={form.criteriaValue || ""} onChange={(e) => setForm({ ...form, criteriaValue: Number(e.target.value) })}
                  placeholder="e.g. 90 (for 90% score)"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Criteria description</label>
              <input value={form.criteria || ""} onChange={(e) => setForm({ ...form, criteria: e.target.value })}
                placeholder="e.g. Score 90% or above in any quiz"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setForm({ ...form, isActive: !form.isActive })}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isActive ? "bg-primary" : "bg-border"}`}>
                <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isActive ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-ink">Active</span>
            </label>

            {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create badge"}</Button>
              <Button variant="secondary" onClick={closePanel}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
