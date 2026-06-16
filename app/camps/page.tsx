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
import { Plus, Trash2, Edit2, Tag, Eye, EyeOff } from "lucide-react";

interface Camp {
  _id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  isVirtual?: boolean;
  cost?: number;
  capacity?: number;
  type?: string[];
  image?: string;
  link?: string;
  publish?: boolean;
}

const CAMP_TYPES = ["Mathematics", "Science", "English", "ICT", "Geography", "Technology", "Literacy & Numeracy"];
const emptyForm = () => ({
  name: "", description: "", startDate: "", endDate: "", location: "",
  isVirtual: false, cost: "", capacity: "", type: [] as string[], image: "", link: "", publish: false,
});
type FormState = ReturnType<typeof emptyForm>;

export default function CampsPage() {
  const [items, setItems] = useState<Camp[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editItem, setEditItem] = useState<Camp | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-camps");
      setItems(res.data.camps || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditItem(null); setForm(emptyForm()); setFormError(""); setPanelOpen(true); };

  const openEdit = (c: Camp) => {
    setEditItem(c);
    setForm({
      name: c.name,
      description: c.description || "",
      startDate: c.startDate || "",
      endDate: c.endDate || "",
      location: c.location || "",
      isVirtual: c.isVirtual || false,
      cost: c.cost != null ? String(c.cost) : "",
      capacity: c.capacity != null ? String(c.capacity) : "",
      type: c.type || [],
      image: c.image || "",
      link: c.link || "",
      publish: c.publish || false,
    });
    setFormError("");
    setPanelOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this camp? Existing registrations for it will be removed too.")) return;
    await api.delete(`/delete-camp/${id}`);
    setItems((p) => p.filter((c) => c._id !== id));
  };

  const toggleType = (t: string) => {
    setForm((f) => ({ ...f, type: f.type.includes(t) ? f.type.filter((x) => x !== t) : [...f.type, t] }));
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Give this camp a name.");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        location: form.location.trim() || undefined,
        isVirtual: form.isVirtual,
        cost: form.cost || 0,
        capacity: form.capacity || null,
        type: form.type,
        image: form.image.trim() || undefined,
        link: form.link.trim() || undefined,
        publish: form.publish,
      };
      if (editItem) {
        await api.put(`/update-camp/${editItem._id}`, payload);
      } else {
        await api.post("/add-camp", payload);
      }
      setPanelOpen(false);
      await load();
    } catch {
      setFormError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthGuard>
      <DashboardShell title="Camps">
        <Card
          title={`${items.length} camp${items.length !== 1 ? "s" : ""}`}
          action={<Button size="sm" onClick={openAdd}><Plus size={14} /> Add camp</Button>}
          padding={false}
        >
          {loading ? (
            <Spinner text="Loading camps..." />
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted text-sm">No camps yet.</p>
              <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Add your first</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Dates", "Location", "Types", "Cost", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-muted font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink max-w-[200px]">
                      <p className="truncate">{c.name}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted text-xs">{c.startDate || "—"} – {c.endDate || "—"}</td>
                    <td className="px-5 py-3.5 text-muted text-xs">{c.isVirtual ? "Virtual" : c.location || "—"}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(c.type || []).map((t) => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-xs bg-primary-light text-primary font-medium">{t}</span>
                        ))}
                        {(!c.type || c.type.length === 0) && <span className="text-muted text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted text-xs">{(c.cost || 0) > 0 ? c.cost : "Free"}</td>
                    <td className="px-5 py-3.5">
                      {c.publish ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-50 text-green-700"><Eye size={11} /> Published</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-surface text-subtle border border-border"><EyeOff size={11} /> Draft</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
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

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editItem ? `Edit: ${editItem.name}` : "Add camp"} width="lg">
          <div className="space-y-5">
            <Input label="Camp name" placeholder="e.g. Summer Math Bootcamp 2026" value={form.name} onChange={set("name")} />

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Description</label>
              <textarea
                value={form.description}
                onChange={set("description")}
                placeholder="What happens at this camp..."
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" value={form.startDate} onChange={set("startDate")} />
              <Input label="End date" type="date" value={form.endDate} onChange={set("endDate")} />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setForm((f) => ({ ...f, isVirtual: !f.isVirtual }))}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isVirtual ? "bg-primary" : "bg-border"}`}>
                <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isVirtual ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-ink">Virtual camp</span>
            </label>

            {!form.isVirtual && (
              <Input label="Location" placeholder="e.g. Accra International School" value={form.location} onChange={set("location")} />
            )}

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Track / Subject</label>
              <div className="flex flex-wrap gap-2">
                {CAMP_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.type.includes(t) ? "bg-primary text-white border-primary" : "bg-surface text-ink border-border hover:border-primary/40"
                    }`}
                  >
                    <Tag size={12} />
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Cost (GHS)" placeholder="0" type="number" value={form.cost} onChange={set("cost")} />
              <Input label="Capacity" placeholder="Leave blank for unlimited" type="number" value={form.capacity} onChange={set("capacity")} />
            </div>

            <Input label="Image URL" placeholder="https://..." value={form.image} onChange={set("image")} />
            <Input label="External link" placeholder="https://... (optional)" value={form.link} onChange={set("link")} />

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setForm((f) => ({ ...f, publish: !f.publish }))}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.publish ? "bg-primary" : "bg-border"}`}>
                <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.publish ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-ink">Published (visible to students)</span>
            </label>

            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editItem ? "Save changes" : "Add camp"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
