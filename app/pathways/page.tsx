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
import { Plus, Trash2, Edit2, BookOpen, Eye, EyeOff } from "lucide-react";

interface Pathway {
  _id: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  courses?: string[];
  grade?: string[];
  category?: string[];
  tags?: string[];
  cost?: string;
  publish?: boolean;
  featured?: boolean;
  createdAt?: string;
}

const EMPTY_FORM = {
  title: "", description: "", thumbnail: "", courses: "",
  grade: "", category: "", tags: "", cost: "",
  publish: false, featured: false,
};

export default function PathwaysPage() {
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Pathway | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    setLoading(true);
    api.get("/all-pathways")
      .then((res) => setPathways(res.data.pathways || res.data.allPathways || []))
      .catch(() => setPathways([]))
      .finally(() => setLoading(false));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setPanelOpen(true);
  };

  const openEdit = (p: Pathway) => {
    setEditing(p);
    setForm({
      title:       p.title       || "",
      description: p.description || "",
      thumbnail:   p.thumbnail   || "",
      courses:     (p.courses    || []).join(", "),
      grade:       (p.grade      || []).join(", "),
      category:    (p.category   || []).join(", "),
      tags:        (p.tags       || []).join(", "),
      cost:        p.cost        || "",
      publish:     p.publish     || false,
      featured:    p.featured    || false,
    });
    setError("");
    setPanelOpen(true);
  };

  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const handleSave = async () => {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        title:       form.title.trim(),
        description: form.description.trim() || null,
        thumbnail:   form.thumbnail.trim()   || null,
        courses:     split(form.courses),
        grade:       split(form.grade),
        category:    split(form.category),
        tags:        split(form.tags),
        cost:        form.cost.trim() || null,
        publish:     form.publish,
        featured:    form.featured,
      };
      if (editing) {
        const res = await api.put(`/update-pathway/${editing._id}`, payload);
        const updated = res.data.pathway;
        setPathways((prev) => prev.map((p) => p._id === editing._id ? updated : p));
      } else {
        const res = await api.post("/add-pathway", payload);
        setPathways((prev) => [res.data.pathway, ...prev]);
      }
      setPanelOpen(false);
    } catch {
      setError("Could not save pathway. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await api.delete(`/delete-pathway/${id}`);
    setPathways((prev) => prev.filter((p) => p._id !== id));
  };

  const togglePublish = async (p: Pathway) => {
    try {
      const res = await api.put(`/update-pathway/${p._id}`, { publish: !p.publish });
      const updated = res.data.pathway;
      setPathways((prev) => prev.map((x) => x._id === p._id ? updated : x));
    } catch { /* silent */ }
  };

  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <AuthGuard>
      <DashboardShell title="Pathway Manager">
        <div className="space-y-4 max-w-4xl">
          <Card
            padding={false}
            title={`${pathways.length} pathway${pathways.length !== 1 ? "s" : ""}`}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus size={14} /> Add pathway
              </Button>
            }
          >
            {loading ? (
              <Spinner text="Loading pathways..." />
            ) : pathways.length === 0 ? (
              <div className="py-16 text-center">
                <BookOpen size={28} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No pathways yet. Create the first one.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Title</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Courses</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Cost</th>
                    <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Status</th>
                    <th className="px-5 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {pathways.map((p) => (
                    <tr key={p._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                      <td className="px-5 py-3">
                        <p className="font-medium text-ink">{p.title}</p>
                        {p.description && <p className="text-xs text-muted mt-0.5 max-w-xs truncate">{p.description}</p>}
                      </td>
                      <td className="px-5 py-3 text-muted text-sm">{(p.courses || []).length}</td>
                      <td className="px-5 py-3 text-muted text-sm">{p.cost || "Free"}</td>
                      <td className="px-5 py-3">
                        <button onClick={() => togglePublish(p)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${p.publish ? "bg-emerald-50 text-emerald-700" : "bg-surface text-muted border border-border"}`}>
                          {p.publish ? <Eye size={11} /> : <EyeOff size={11} />}
                          {p.publish ? "Published" : "Draft"}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded text-muted hover:text-ink transition-colors">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => handleDelete(p._id, p.title || "")} className="p-1.5 rounded text-muted hover:text-danger transition-colors">
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

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? "Edit pathway" : "New pathway"} width="lg">
          <div className="space-y-4">
            <Input label="Title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What's this pathway called?" />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)}
                rows={3} placeholder="What will students learn?"
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-sm resize-none" />
            </div>
            <Input label="Thumbnail URL" value={form.thumbnail} onChange={(e) => set("thumbnail", e.target.value)} placeholder="https://..." />
            <Input label="Course IDs (comma-separated)" value={form.courses} onChange={(e) => set("courses", e.target.value)}
              placeholder="mongo_id_1, mongo_id_2, ..." hint="Enter the MongoDB IDs of the courses in order" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Grade levels" value={form.grade} onChange={(e) => set("grade", e.target.value)} placeholder="JHS, SHS, ..." />
              <Input label="Categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="STEM, Arts, ..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="math, science, ..." />
              <Input label="Cost" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="GHS 0 for free" />
            </div>
            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.publish} onChange={(e) => set("publish", e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-primary" />
                <span className="text-sm text-ink">Published</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-primary" />
                <span className="text-sm text-ink">Featured</span>
              </label>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving..." : editing ? "Save changes" : "Create pathway"}
              </Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
