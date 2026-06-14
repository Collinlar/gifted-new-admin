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
import { Plus, Eye, Trash2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

interface Course {
  _id: string;
  title: string;
  level?: string;
  program?: string | string[];
  cost?: string | number;
  duration?: string;
}

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));

export default function LearningPage() {
  const router = useRouter();
  const [items, setItems] = useState<Course[]>([]);
  const [filtered, setFiltered] = useState<Course[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [selectedProgram, setSelectedProgram] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  // Add form
  const [form, setForm] = useState({
    title: "", description: "", level: "", cost: "", duration: "",
    instructor: "", grade: [] as string[], program: [] as string[],
    category: [] as string[], tags: [] as string[], type: "Learning",
  });
  const [modules, setModules] = useState<{ title: string; description: string; duration: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-courses-admin-info");
      const courses: Course[] = res.data.courses || [];
      setItems(courses);
      setFiltered(courses);
      const allP = courses.flatMap((c) => Array.isArray(c.program) ? c.program : [c.program]).filter(Boolean) as string[];
      setPrograms(Array.from(new Set(allP)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    let result = [...items];
    if (selectedProgram) result = result.filter((c) => {
      const p = Array.isArray(c.program) ? c.program : [c.program];
      return p.includes(selectedProgram);
    });
    if (search.trim()) result = result.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));
    setFiltered(result);
  }, [search, selectedProgram, items]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this course?")) return;
    await api.delete(`/delete-course/${id}`);
    setItems((p) => p.filter((c) => c._id !== id));
  };

  const toggleGrade = (g: string) => {
    setForm((f) => ({ ...f, grade: f.grade.includes(g) ? f.grade.filter((x) => x !== g) : [...f.grade, g] }));
  };

  const addModule = () => setModules([...modules, { title: "", description: "", duration: "" }]);

  const handleSave = async () => {
    setFormError("");
    if (!form.title.trim()) return setFormError("Give this course a title.");
    setSaving(true);
    try {
      await api.post("/add-course", { ...form, modules });
      setPanelOpen(false);
      setForm({ title: "", description: "", level: "", cost: "", duration: "", instructor: "", grade: [], program: [], category: [], tags: [], type: "Learning" });
      setModules([]);
      await load();
    } catch {
      setFormError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell title="Courses">
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                <input
                  type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search courses..."
                  className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-44"
                />
              </div>
              {programs.length > 0 && (
                <select value={selectedProgram} onChange={(e) => setSelectedProgram(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="">All programs</option>
                  {programs.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
            </div>
            <Button size="sm" onClick={() => setPanelOpen(true)}>
              <Plus size={14} /> Add course
            </Button>
          </div>

          <Card padding={false}>
            {loading ? (
              <Spinner text="Loading courses..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-muted text-sm">{search ? `No courses matching "${search}"` : "No courses yet."}</p>
                <Button size="sm" className="mt-4" onClick={() => setPanelOpen(true)}><Plus size={14} /> Add your first course</Button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Title", "Level", "Program", "Duration", "Cost", ""].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c._id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-ink">{c.title}</td>
                      <td className="px-5 py-3.5">
                        {c.level && <span className="px-2 py-0.5 rounded text-xs bg-primary-light text-primary font-medium">{c.level}</span>}
                      </td>
                      <td className="px-5 py-3.5 text-muted text-xs">{Array.isArray(c.program) ? c.program.join(", ") : c.program || "—"}</td>
                      <td className="px-5 py-3.5 text-muted">{c.duration || "—"}</td>
                      <td className="px-5 py-3.5 text-muted">{c.cost ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { localStorage.setItem("courseInfo", JSON.stringify(c)); router.push("/learning/course-details"); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-primary hover:bg-primary-light transition-colors font-medium">
                            <Eye size={13} /> View
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
        </div>

        {/* Add Course Panel */}
        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add new course" width="xl">
          <div className="space-y-5">
            <Input label="Course title" placeholder="e.g. Introduction to Physics" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What will students learn?" rows={3}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Level</label>
                <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                  <option value="">Select level</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <Input label="Duration" placeholder="e.g. 4 weeks" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
              <Input label="Cost" type="number" placeholder="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              <Input label="Instructor" placeholder="Instructor name" value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-ink">Grade levels</label>
              <div className="flex flex-wrap gap-1.5">
                {GRADES.map((g) => (
                  <button key={g} type="button" onClick={() => toggleGrade(g)}
                    className={`px-2.5 py-1 rounded text-xs border font-medium transition-colors ${form.grade.includes(g) ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"}`}>
                    Gr. {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink">Modules ({modules.length})</label>
                <button type="button" onClick={addModule} className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1">
                  <Plus size={13} /> Add module
                </button>
              </div>
              {modules.map((m, i) => (
                <div key={i} className="p-3 border border-border rounded-xl space-y-2 bg-surface/40">
                  <Input placeholder={`Module ${i + 1} title`} value={m.title} onChange={(e) => {
                    const u = [...modules]; u[i] = { ...u[i], title: e.target.value }; setModules(u);
                  }} />
                  <Input placeholder="Duration" value={m.duration} onChange={(e) => {
                    const u = [...modules]; u[i] = { ...u[i], duration: e.target.value }; setModules(u);
                  }} />
                  <button onClick={() => setModules(modules.filter((_, idx) => idx !== i))} className="text-xs text-danger hover:underline">Remove</button>
                </div>
              ))}
            </div>

            {formError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save course"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
