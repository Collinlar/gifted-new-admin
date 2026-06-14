"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import { ArrowLeft, Edit2, Check, X } from "lucide-react";
import api from "@/lib/api";

interface Module { title: string; description?: string; duration?: string; [key: string]: unknown; }
interface Course {
  _id: string;
  title: string;
  level?: string;
  program?: string | string[];
  category?: string | string[];
  cost?: string | number;
  duration?: string;
  description?: string;
  instructor?: string;
  tags?: string[];
  features?: string[];
  modules?: Module[];
  publish?: boolean;
  featured?: boolean;
  thumbnail?: string;
  grade?: string | string[];
  [key: string]: unknown;
}

const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
};

export default function CourseDetailsPage() {
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("courseInfo");
    if (!stored) { router.push("/learning/courses"); return; }
    const c: Course = JSON.parse(stored);
    setCourse(c);
    resetForm(c);
  }, [router]);

  const resetForm = (c: Course) => {
    setForm({
      title: c.title || "",
      description: c.description || "",
      level: c.level || "",
      instructor: c.instructor || "",
      duration: c.duration || "",
      cost: c.cost ? String(c.cost) : "",
      program: arr(c.program).join(", "),
      category: arr(c.category).join(", "),
      grade: arr(c.grade).join(", "),
      tags: arr(c.tags).join(", "),
      features: arr(c.features).join(", "),
      publish: !!c.publish,
      featured: !!c.featured,
    });
  };

  const handleSave = async () => {
    if (!course?._id) return;
    setSaving(true);
    setSaveError("");
    try {
      const split = (v: unknown) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
      const payload = {
        title: form.title,
        description: form.description,
        level: form.level,
        instructor: form.instructor,
        duration: form.duration,
        cost: form.cost,
        program: split(form.program),
        category: split(form.category),
        grade: split(form.grade),
        tags: split(form.tags),
        features: split(form.features),
        publish: form.publish,
        featured: form.featured,
      };
      const res = await api.put(`/update-course/${course._id}`, payload);
      const updated = { ...course, ...res.data.course };
      setCourse(updated);
      localStorage.setItem("courseInfo", JSON.stringify(updated));
      setEditing(false);
    } catch {
      setSaveError("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (course) resetForm(course);
    setSaveError("");
    setEditing(false);
  };

  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!course) return null;

  return (
    <AuthGuard>
      <DashboardShell title={course.title}>
        <div className="space-y-5 max-w-3xl">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => router.push("/learning/courses")}>
              <ArrowLeft size={14} /> Back to courses
            </Button>
            {!editing ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Edit2 size={13} /> Edit course
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Check size={13} /> {saving ? "Saving..." : "Save changes"}
                </Button>
                <Button variant="secondary" size="sm" onClick={cancelEdit}>
                  <X size={13} /> Cancel
                </Button>
              </div>
            )}
          </div>

          {saveError && (
            <p className="text-sm text-danger bg-red-50 rounded-lg px-4 py-2">{saveError}</p>
          )}

          {editing ? (
            <div className="space-y-4">
              <Card title="Basic info">
                <div className="space-y-4">
                  <Input label="Title" value={String(form.title || "")} onChange={setF("title")} />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted uppercase tracking-wide">Description</label>
                    <textarea
                      value={String(form.description || "")}
                      onChange={setF("description")}
                      rows={4}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Instructor" value={String(form.instructor || "")} onChange={setF("instructor")} />
                    <Input label="Duration" placeholder="e.g. 4 weeks" value={String(form.duration || "")} onChange={setF("duration")} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Level" placeholder="e.g. Beginner" value={String(form.level || "")} onChange={setF("level")} />
                    <Input label="Cost (GHS)" type="number" value={String(form.cost || "")} onChange={setF("cost")} />
                  </div>
                </div>
              </Card>

              <Card title="Classification">
                <div className="space-y-4">
                  <Input label="Program (comma-separated)" placeholder="e.g. Science Olympiad, NJSO" value={String(form.program || "")} onChange={setF("program")} />
                  <Input label="Category (comma-separated)" placeholder="e.g. Science, Mathematics" value={String(form.category || "")} onChange={setF("category")} />
                  <Input label="Grade (comma-separated)" placeholder="e.g. 7, 8, 9" value={String(form.grade || "")} onChange={setF("grade")} />
                  <Input label="Tags (comma-separated)" placeholder="e.g. Biology, Ecology" value={String(form.tags || "")} onChange={setF("tags")} />
                  <Input label="Features (comma-separated)" placeholder="e.g. Video lessons, Quizzes" value={String(form.features || "")} onChange={setF("features")} />
                </div>
              </Card>

              <Card title="Visibility">
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.publish}
                      onChange={(e) => setForm((f) => ({ ...f, publish: e.target.checked }))}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <span className="text-sm text-ink">Published</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form.featured}
                      onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <span className="text-sm text-ink">Featured</span>
                  </label>
                </div>
              </Card>
            </div>
          ) : (
            <>
              <Card title="Course overview">
                {course.description && <p className="text-sm text-muted mb-5">{course.description}</p>}
                <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                  {([
                    ["Level", course.level],
                    ["Program", arr(course.program).join(", ")],
                    ["Category", arr(course.category).join(", ")],
                    ["Grade", arr(course.grade).join(", ")],
                    ["Cost", course.cost ? `GHS ${course.cost}` : null],
                    ["Duration", course.duration],
                    ["Instructor", course.instructor],
                    ["Status", course.publish ? "Published" : "Draft"],
                    ["Featured", course.featured ? "Yes" : "No"],
                  ] as [string, unknown][]).filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted uppercase tracking-wide font-medium">{label}</dt>
                      <dd className="mt-0.5 text-sm text-ink">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {course.tags && course.tags.length > 0 && (
                <Card title="Tags">
                  <div className="flex flex-wrap gap-2">
                    {course.tags.map((tag) => (
                      <span key={tag} className="px-2.5 py-1 rounded-lg text-xs bg-surface text-muted border border-border">{tag}</span>
                    ))}
                  </div>
                </Card>
              )}

              {course.modules && course.modules.length > 0 && (
                <Card title={`${course.modules.length} module${course.modules.length !== 1 ? "s" : ""}`}>
                  <div className="space-y-3">
                    {course.modules.map((m, i) => (
                      <div key={i} className="p-3 bg-surface rounded-xl">
                        <p className="font-medium text-ink text-sm">{i + 1}. {m.title}</p>
                        {m.description && <p className="text-xs text-muted mt-0.5">{m.description}</p>}
                        {m.duration && <p className="text-xs text-muted mt-1">{m.duration}</p>}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
