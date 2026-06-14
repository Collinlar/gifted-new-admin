"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2, Edit2, Megaphone, CheckCircle, Clock, X, Check } from "lucide-react";

interface Announcement {
  _id: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaLink?: string;
  targetAudience?: string;
  publishDate?: string;
  isPublished?: boolean;
  createdAt?: string;
}

const AUDIENCES = ["All Users", "Students", "Parents", "Paid Users", "Free Users"];

const blank = (): Partial<Announcement> => ({
  title: "", body: "", ctaLabel: "", ctaLink: "",
  targetAudience: "All Users", publishDate: "", isPublished: false,
});

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState<Partial<Announcement>>(blank());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-announcements");
      setItems(res.data.announcements || res.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(blank()); setError(""); setPanelOpen(true); };
  const openEdit = (a: Announcement) => { setEditing(a); setForm({ ...a }); setError(""); setPanelOpen(true); };
  const closePanel = () => { setPanelOpen(false); setEditing(null); setForm(blank()); };

  const handleSave = async () => {
    setError("");
    if (!form.title?.trim()) return setError("Give this announcement a title.");
    if (!form.body?.trim()) return setError("Add the announcement body.");
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/update-announcement/${editing._id}`, form);
      } else {
        await api.post("/add-announcement", form);
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
    if (!confirm("Delete this announcement?")) return;
    await api.delete(`/delete-announcement/${id}`);
    setItems((p) => p.filter((a) => a._id !== id));
  };

  const togglePublish = async (a: Announcement) => {
    await api.put(`/update-announcement/${a._id}`, { isPublished: !a.isPublished });
    await load();
  };

  return (
    <AuthGuard>
      <DashboardShell title="Announcements">
        <div className="space-y-4 max-w-4xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Manage what users see in the announcement modal on their dashboard.
            </p>
            <Button size="sm" onClick={openAdd}><Plus size={14} /> New announcement</Button>
          </div>

          <Card padding={false}>
            {loading ? (
              <Spinner text="Loading announcements..." />
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <Megaphone size={32} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No announcements yet.</p>
                <Button size="sm" className="mt-4" onClick={openAdd}><Plus size={14} /> Create your first announcement</Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((a) => (
                  <div key={a._id} className="px-5 py-4 flex items-start gap-4">
                    <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.isPublished ? "bg-emerald-50" : "bg-surface"}`}>
                      {a.isPublished
                        ? <CheckCircle size={16} className="text-emerald-600" />
                        : <Clock size={16} className="text-subtle" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-ink text-sm">{a.title}</p>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-surface text-muted border border-border"}`}>
                          {a.isPublished ? "Published" : "Draft"}
                        </span>
                        {a.targetAudience && (
                          <span className="px-2 py-0.5 rounded text-xs bg-primary-light text-primary font-medium">{a.targetAudience}</span>
                        )}
                      </div>
                      <p className="text-sm text-muted mt-1 line-clamp-2">{a.body}</p>
                      {(a.ctaLabel || a.ctaLink) && (
                        <p className="text-xs text-primary mt-1">{a.ctaLabel || a.ctaLink}</p>
                      )}
                      {a.createdAt && (
                        <p className="text-xs text-subtle mt-1">{new Date(a.createdAt).toLocaleDateString()}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => togglePublish(a)}
                        title={a.isPublished ? "Unpublish" : "Publish"}
                        className={`p-1.5 rounded-lg transition-colors ${a.isPublished ? "text-emerald-600 hover:bg-emerald-50" : "text-subtle hover:text-emerald-600 hover:bg-emerald-50"}`}
                      >
                        {a.isPublished ? <X size={14} /> : <Check size={14} />}
                      </button>
                      <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-subtle hover:text-ink transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(a._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <SlidePanel open={panelOpen} onClose={closePanel} title={editing ? "Edit announcement" : "New announcement"} width="lg">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Title</label>
              <input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. GH STEM Olympiad 2025 is now open"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Body</label>
              <textarea value={form.body || ""} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4}
                placeholder="Write the announcement message..."
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">CTA button label</label>
                <input value={form.ctaLabel || ""} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                  placeholder="e.g. Register now"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">CTA link</label>
                <input value={form.ctaLink || ""} onChange={(e) => setForm({ ...form, ctaLink: e.target.value })}
                  placeholder="/programs"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Target audience</label>
                <select value={form.targetAudience || "All Users"} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                  {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Publish date</label>
                <input type="date" value={form.publishDate || ""} onChange={(e) => setForm({ ...form, publishDate: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setForm({ ...form, isPublished: !form.isPublished })}
                className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${form.isPublished ? "bg-primary" : "bg-border"}`}>
                <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isPublished ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-ink">Publish immediately</span>
            </label>

            {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create announcement"}</Button>
              <Button variant="secondary" onClick={closePanel}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
