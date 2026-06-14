"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";

interface Interest { _id: string; name: string; description?: string; }

export default function InterestsPage() {
  const [items, setItems] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-interest");
      setItems(res.data.allInterest || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this interest?")) return;
    await api.delete(`/delete-interest/${id}`);
    setItems((p) => p.filter((i) => i._id !== id));
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Give this interest a name.");
    setSaving(true);
    try {
      await api.post("/add-interest", form);
      setPanelOpen(false);
      setForm({ name: "", description: "" });
      await load();
    } catch {
      setFormError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell title="Interests">
        <Card
          title={`${items.length} interest${items.length !== 1 ? "s" : ""}`}
          action={<Button size="sm" onClick={() => setPanelOpen(true)}><Plus size={14} /> Add interest</Button>}
        >
          {loading ? (
            <Spinner text="Loading interests..." />
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted text-sm">No interests yet.</p>
              <Button size="sm" className="mt-4" onClick={() => setPanelOpen(true)}><Plus size={14} /> Add one</Button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map((item) => (
                <div key={item._id} className="flex items-start justify-between p-3 bg-surface rounded-xl border border-border hover:border-primary/30 transition-colors group">
                  <div>
                    <p className="font-medium text-ink text-sm">{item.name}</p>
                    {item.description && <p className="text-xs text-muted mt-0.5 line-clamp-2">{item.description}</p>}
                  </div>
                  <button onClick={() => handleDelete(item._id)} className="p-1 text-subtle hover:text-danger rounded ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add interest" width="md">
          <div className="space-y-4">
            <Input label="Name" placeholder="e.g. Mathematics" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description..." rows={3}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
            </div>
            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Add interest"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
