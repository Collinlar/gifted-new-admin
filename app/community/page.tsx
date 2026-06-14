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
import { Plus, Eye, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface Group {
  _id: string;
  name?: string;
  title?: string;
  description?: string;
  members?: unknown[];
}

export default function CommunityPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-groups");
      setGroups(res.data.allGroups || res.data.groups || []);
    } catch { setGroups([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this community?")) return;
    await api.delete(`/delete-group/${id}`);
    setGroups((p) => p.filter((g) => g._id !== id));
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("Give this community a name.");
    setSaving(true);
    try {
      await api.post("/add-group", form);
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
      <DashboardShell title="Communities">
        <Card
          title={`${groups.length} communit${groups.length !== 1 ? "ies" : "y"}`}
          action={<Button size="sm" onClick={() => setPanelOpen(true)}><Plus size={14} /> Add community</Button>}
          padding={false}
        >
          {loading ? (
            <Spinner text="Loading communities..." />
          ) : groups.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted text-sm">No communities yet.</p>
              <Button size="sm" className="mt-4" onClick={() => setPanelOpen(true)}><Plus size={14} /> Create one</Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Description", "Members", ""].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-muted font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-ink">{g.name || g.title}</td>
                    <td className="px-5 py-3.5 text-muted text-xs max-w-xs truncate">{g.description || "—"}</td>
                    <td className="px-5 py-3.5 text-muted">{g.members?.length ?? 0}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { localStorage.setItem("groupId", g._id); localStorage.setItem("group", JSON.stringify(g)); router.push("/community/group-details"); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-primary-light transition-colors font-medium"
                        >
                          <Eye size={13} /> View
                        </button>
                        <button onClick={() => handleDelete(g._id)} className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors">
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

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add community">
          <div className="space-y-4">
            <Input label="Community name" placeholder="e.g. Science Club" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What is this community about?" rows={3}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
            </div>
            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Create community"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
