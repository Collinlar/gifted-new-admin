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
import { Plus, ChevronRight, Trash2, Edit2, Tag } from "lucide-react";
import { useRouter } from "next/navigation";

interface Competition {
  _id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  year?: string;
  materialCost?: number;
  assessmentCost?: number;
  link?: string;
  customizableButton?: string;
  type?: string[];
  subTypes?: string[];
  assessments?: string[];
  courses?: string[];
}

const COMPETITION_TYPES = ["Mathematics", "Science", "English", "ICT", "Geography"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => String(CURRENT_YEAR + 2 - i));

const emptyForm = () => ({
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  year: String(CURRENT_YEAR),
  materialCost: "",
  assessmentCost: "",
  link: "",
  customizableButton: "",
  type: [] as string[],
  subTypes: "",
});

type FormState = ReturnType<typeof emptyForm>;

export default function CompetitionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editItem, setEditItem] = useState<Competition | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-competitions");
      setItems(res.data.AllCompetitions || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm());
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
      year: c.year || String(CURRENT_YEAR),
      materialCost: c.materialCost != null ? String(c.materialCost) : "",
      assessmentCost: c.assessmentCost != null ? String(c.assessmentCost) : "",
      link: c.link || "",
      customizableButton: c.customizableButton || "",
      type: c.type || [],
      subTypes: (c.subTypes || []).join(", "),
    });
    setFormError("");
    setPanelOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this competition?")) return;
    await api.delete(`/delete-competition/${id}`);
    setItems((p) => p.filter((c) => c._id !== id));
  };

  const toggleType = (t: string) => {
    setForm((f) => ({
      ...f,
      type: f.type.includes(t) ? f.type.filter((x) => x !== t) : [...f.type, t],
    }));
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Give this competition a name.");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        year: form.year,
        materialCost: form.materialCost || 0,
        assessmentCost: form.assessmentCost || 0,
        link: form.link.trim() || undefined,
        customizableButton: form.customizableButton.trim() || undefined,
        type: form.type,
        subTypes: form.subTypes
          ? form.subTypes.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      if (editItem) {
        await api.put(`/update-competition/${editItem._id}`, payload);
      } else {
        await api.post("/add-competition", payload);
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
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

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
                  {["Name", "Year", "Start Date", "End Date", "Types", "Costs", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-muted font-medium text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink max-w-[200px]">
                      <p className="truncate">{c.name}</p>
                      {c.customizableButton && (
                        <p className="text-xs text-primary mt-0.5">{c.customizableButton}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted">{c.year || "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{c.startDate || "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{c.endDate || "—"}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(c.type || []).map((t) => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-xs bg-primary-light text-primary font-medium">
                            {t}
                          </span>
                        ))}
                        {(!c.type || c.type.length === 0) && <span className="text-muted text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted text-xs">
                      {(c.materialCost || 0) > 0 && <p>Material: {c.materialCost}</p>}
                      {(c.assessmentCost || 0) > 0 && <p>Assessment: {c.assessmentCost}</p>}
                      {!(c.materialCost || 0) && !(c.assessmentCost || 0) && "Free"}
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
          width="lg"
        >
          <div className="space-y-5">
            <Input label="Competition name" placeholder="e.g. Science Olympiad 2025" value={form.name} onChange={set("name")} />

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Description</label>
              <textarea
                value={form.description}
                onChange={set("description")}
                placeholder="Brief description of this competition..."
                rows={3}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" value={form.startDate} onChange={set("startDate")} />
              <Input label="End date" type="date" value={form.endDate} onChange={set("endDate")} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Year</label>
              <select
                value={form.year}
                onChange={set("year")}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              >
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Type(s) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Type(s)</label>
              <div className="flex flex-wrap gap-2">
                {COMPETITION_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.type.includes(t)
                        ? "bg-primary text-white border-primary"
                        : "bg-surface text-ink border-border hover:border-primary/40"
                    }`}
                  >
                    <Tag size={12} />
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Material cost" placeholder="0" type="number" value={form.materialCost} onChange={set("materialCost")} />
              <Input label="Assessment cost" placeholder="0" type="number" value={form.assessmentCost} onChange={set("assessmentCost")} />
            </div>

            <Input label="Registration link" placeholder="https://..." value={form.link} onChange={set("link")} />
            <Input
              label="Button label"
              placeholder='e.g. "View Results" or "Register Now"'
              value={form.customizableButton}
              onChange={set("customizableButton")}
            />

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">Sub-types <span className="normal-case font-normal">(comma-separated)</span></label>
              <input
                value={form.subTypes}
                onChange={set("subTypes")}
                placeholder="e.g. Junior, Senior, Open"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editItem ? "Save changes" : "Add competition"}
              </Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
