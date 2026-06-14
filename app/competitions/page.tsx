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
import { Plus, ChevronRight, Trash2, Edit2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface Competition {
  _id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  cost?: string | number;
  materialCost?: string | number;
  assessmentCost?: string | number;
  link?: string;
  subTypes?: unknown[];
}

export default function CompetitionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editItem, setEditItem] = useState<Competition | null>(null);
  const [form, setForm] = useState({ name: "", description: "", startDate: "", endDate: "", cost: "", materialCost: "", assessmentCost: "", link: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-competitions");
      setItems(res.data.AllCompetitions || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditItem(null);
    setForm({ name: "", description: "", startDate: "", endDate: "", cost: "", materialCost: "", assessmentCost: "", link: "" });
    setFormError("");
    setPanelOpen(true);
  };

  const openEdit = (c: Competition) => {
    setEditItem(c);
    setForm({
      name: c.name,
      description: c.description || "",
      startDate: c.startDate || "",
      endDate: c.endDate || "",
      cost: String(c.cost || ""),
      materialCost: String(c.materialCost || ""),
      assessmentCost: String(c.assessmentCost || ""),
      link: c.link || "",
    });
    setFormError("");
    setPanelOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this competition?")) return;
    await api.delete(`/delete-competition/${id}`);
    setItems((p) => p.filter((c) => c._id !== id));
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Give this competition a name.");
    setSaving(true);
    try {
      if (editItem) {
        await api.put(`/update-competition/${editItem._id}`, form);
      } else {
        await api.post("/add-competition", form);
      }
      setPanelOpen(false);
      await load();
    } catch {
      setFormError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthGuard>
      <DashboardShell title="Competitions">
        <Card
          title={`${items.length} competition${items.length !== 1 ? "s" : ""}`}
          action={<Button size="sm" onClick={openAdd}><Plus size={14} /> Add competition</Button>}
          padding={false}
        >
          {loading ? (
            <Spinner text="Loading competitions..." />
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted text-sm">No competitions yet.</p>
              <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Add your first</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Start Date", "End Date", "Cost", "Sub-types", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-muted font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink">{c.name}</td>
                    <td className="px-5 py-3.5 text-muted">{c.startDate || "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{c.endDate || "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{c.cost ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-xs bg-primary-light text-primary font-medium">
                        {c.subTypes?.length ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/competitions/${c._id}`)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-primary-light transition-colors font-medium"
                        >
                          Details <ChevronRight size={13} />
                        </button>
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-surface transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => handleDelete(c._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors">
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

        <SlidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title={editItem ? `Edit: ${editItem.name}` : "Add competition"}
        >
          <div className="space-y-4">
            <Input label="Competition name" placeholder="e.g. Science Olympiad 2025" value={form.name} onChange={set("name")} />
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this competition..."
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" value={form.startDate} onChange={set("startDate")} />
              <Input label="End date" type="date" value={form.endDate} onChange={set("endDate")} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Registration cost" placeholder="0" type="number" value={form.cost} onChange={set("cost")} />
              <Input label="Material cost" placeholder="0" type="number" value={form.materialCost} onChange={set("materialCost")} />
              <Input label="Assessment cost" placeholder="0" type="number" value={form.assessmentCost} onChange={set("assessmentCost")} />
            </div>
            <Input label="Registration link" placeholder="https://..." value={form.link} onChange={set("link")} />
            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editItem ? "Save changes" : "Add competition"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
