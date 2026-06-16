"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2, Edit2, Compass } from "lucide-react";

interface Track {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const COLORS = [
  { label: "Teal", value: "#1D9E75" },
  { label: "Gold", value: "#E8A020" },
  { label: "Blue", value: "#185FA5" },
  { label: "Navy", value: "#0A0E1A" },
  { label: "Rose", value: "#F43F5E" },
  { label: "Indigo", value: "#4F46E5" },
];
const ICONS = ["🧮", "📖", "🔬", "💻", "🌍", "🚀", "🎯", "🏆"];

const blank = (): Partial<Track> => ({
  name: "", slug: "", description: "", icon: "🧮", color: "#1D9E75", sortOrder: 0, isActive: true,
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [form, setForm] = useState<Partial<Track>>(blank());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-tracks");
      setTracks(res.data.tracks || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(blank()); setError(""); setPanelOpen(true); };
  const openEdit = (t: Track) => { setEditing(t); setForm({ ...t }); setError(""); setPanelOpen(true); };
  const closePanel = () => { setPanelOpen(false); setEditing(null); setForm(blank()); };

  const handleNameChange = (name: string) => {
    setForm((f) => ({ ...f, name, slug: editing ? f.slug : slugify(name) }));
  };

  const handleSave = async () => {
    setError("");
    if (!form.name?.trim()) return setError("Give this track a name.");
    setSaving(true);
    try {
      const payload = { ...form, slug: form.slug || slugify(form.name) };
      if (editing) {
        await api.put(`/update-track/${editing._id}`, payload);
      } else {
        await api.post("/add-track", payload);
      }
      await load();
      closePanel();
    } catch {
      setError("Could not save — the slug may already be in use.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this track? Content tagged into it will be untagged, and any students who picked it will lose that selection.")) return;
    await api.delete(`/delete-track/${id}`);
    setTracks((p) => p.filter((t) => t._id !== id));
  };

  return (
    <AuthGuard>
      <DashboardShell title="Tracks">
        <div className="space-y-4 max-w-4xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">The subject pathways students choose from on signup and in &quot;My Tracks&quot;.</p>
            <Button size="sm" onClick={openAdd}><Plus size={14} /> New track</Button>
          </div>

          {loading ? (
            <Spinner text="Loading tracks..." />
          ) : tracks.length === 0 ? (
            <Card>
              <div className="py-16 text-center">
                <Compass size={32} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No tracks defined yet.</p>
                <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Create first track</Button>
              </div>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {tracks.map((t) => (
                <div key={t._id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: t.color ? t.color + "22" : "#1D9E7522" }}>
                    {t.icon || "🧮"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink text-sm">{t.name}</p>
                      {!t.isActive && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface text-subtle border border-border">Inactive</span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5">/track/{t.slug}</p>
                    {t.description && <p className="text-xs text-muted mt-1">{t.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-subtle hover:text-ink transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(t._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SlidePanel open={panelOpen} onClose={closePanel} title={editing ? "Edit track" : "New track"} width="lg">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Track name</label>
              <input value={form.name || ""} onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Mathematics"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Slug</label>
              <input value={form.slug || ""} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
                placeholder="mathematics"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              <p className="text-xs text-muted">Used in the student app URL: /track/{form.slug || "..."}</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                placeholder="What this track covers..."
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

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Sort order</label>
              <input type="number" value={form.sortOrder ?? 0} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              <p className="text-xs text-muted">Lower numbers appear first in the student app.</p>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setForm({ ...form, isActive: !form.isActive })}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isActive ? "bg-primary" : "bg-border"}`}>
                <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isActive ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-ink">Active (visible to students)</span>
            </label>

            {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create track"}</Button>
              <Button variant="secondary" onClick={closePanel}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
