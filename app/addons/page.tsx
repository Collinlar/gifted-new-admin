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
import { Plus, Trash2, Edit2, Package, Download } from "lucide-react";
import * as XLSX from "xlsx";

interface AddOn {
  _id: string;
  name?: string;
  description?: string;
  cost?: string;
  type?: string;
  image?: string;
  isActive?: boolean;
  createdAt?: string;
}

const EMPTY_FORM = {
  name: "", description: "", cost: "", type: "", image: "", isActive: true,
};

export default function AddOnsPage() {
  const [items, setItems] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<AddOn | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => { load(); }, []);

  const load = () => {
    setLoading(true);
    api.get("/all-addons")
      .then((res) => setItems(res.data.addons || res.data.allAddons || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setPanelOpen(true);
  };

  const openEdit = (a: AddOn) => {
    setEditing(a);
    setForm({
      name:        a.name        || "",
      description: a.description || "",
      cost:        a.cost        || "",
      type:        a.type        || "",
      image:       a.image       || "",
      isActive:    a.isActive    !== false,
    });
    setError("");
    setPanelOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description.trim() || null,
        cost:        form.cost.trim() || null,
        type:        form.type.trim() || null,
        image:       form.image.trim() || null,
        isActive:    form.isActive,
      };
      if (editing) {
        const res = await api.put(`/update-addon/${editing._id}`, payload);
        setItems((prev) => prev.map((x) => x._id === editing._id ? res.data.addon : x));
      } else {
        const res = await api.post("/add-addon", payload);
        setItems((prev) => [res.data.addon, ...prev]);
      }
      setPanelOpen(false);
    } catch {
      setError("Could not save add-on. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await api.delete(`/delete-addon/${id}`);
    setItems((prev) => prev.filter((a) => a._id !== id));
  };

  const toggleActive = async (a: AddOn) => {
    try {
      const res = await api.put(`/update-addon/${a._id}`, { isActive: !a.isActive });
      setItems((prev) => prev.map((x) => x._id === a._id ? res.data.addon : x));
    } catch { /* silent */ }
  };

  const handleExport = () => {
    const data = filtered.map((a, i) => ({
      "#": i + 1, Name: a.name || "—", Description: a.description || "—",
      Cost: a.cost || "Free", Type: a.type || "—",
      Active: a.isActive ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Add-ons");
    XLSX.writeFile(wb, "Gifted_AddOns.xlsx");
  };

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const filtered = search.trim()
    ? items.filter((a) =>
        (a.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.type || "").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  return (
    <AuthGuard>
      <DashboardShell title="Add-ons">
        <div className="space-y-4 max-w-4xl">
          <Card
            padding={false}
            title={`${filtered.length} add-on${filtered.length !== 1 ? "s" : ""}`}
            action={
              <div className="flex items-center gap-2">
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search add-ons..."
                  className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
                {items.length > 0 && (
                  <button onClick={handleExport}
                    className="p-2 rounded-lg border border-border text-muted hover:text-ink transition-colors">
                    <Download size={14} />
                  </button>
                )}
                <Button size="sm" onClick={openCreate}>
                  <Plus size={14} /> Add new
                </Button>
              </div>
            }
          >
            {loading ? (
              <Spinner text="Loading add-ons..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <Package size={28} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">{search ? "No add-ons match your search." : "No add-ons yet. Create the first one."}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Name</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Type</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Cost</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Status</th>
                    <th className="px-5 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                      <td className="px-5 py-3">
                        <p className="font-medium text-ink">{a.name}</p>
                        {a.description && <p className="text-xs text-muted mt-0.5 max-w-xs truncate">{a.description}</p>}
                      </td>
                      <td className="px-5 py-3 text-muted text-sm">{a.type || "—"}</td>
                      <td className="px-5 py-3 text-muted text-sm">{a.cost || "Free"}</td>
                      <td className="px-5 py-3">
                        <button onClick={() => toggleActive(a)}
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${a.isActive !== false ? "bg-emerald-50 text-emerald-700" : "bg-surface text-muted border border-border"}`}>
                          {a.isActive !== false ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => openEdit(a)} className="p-1.5 rounded text-muted hover:text-ink transition-colors">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => handleDelete(a._id, a.name || "")} className="p-1.5 rounded text-muted hover:text-danger transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? "Edit add-on" : "New add-on"}>
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="What's this add-on called?" />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)}
                rows={3} placeholder="What does this add-on include?"
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Cost" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="GHS 0 for free" />
              <Input label="Type" value={form.type} onChange={(e) => set("type", e.target.value)} placeholder="e.g. Study Pack, Mentorship" />
            </div>
            <Input label="Image URL" value={form.image} onChange={(e) => set("image", e.target.value)} placeholder="https://..." />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary" />
              <span className="text-sm text-ink">Active (visible to students)</span>
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving..." : editing ? "Save changes" : "Create add-on"}
              </Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
