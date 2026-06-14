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
import { Plus, Download, GraduationCap, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";

interface Enrollment {
  _id: string;
  userId?: string;
  courseId?: string;
  studentName?: string;
  studentEmail?: string;
  studentSchool?: string;
  courseTitle?: string;
  paymentReference?: string;
  amount?: string | number;
  status?: string;
  enrolledAt?: string;
  createdAt?: string;
}

interface Course { _id: string; title?: string; mongoId?: string; }

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-50 text-emerald-700",
  revoked:  "bg-red-50 text-red-700",
  refunded: "bg-amber-50 text-amber-700",
};

const EMPTY_FORM = { userId: "", courseId: "", paymentReference: "", amount: "", status: "active" };

export default function EnrollmentsPage() {
  const [items, setItems] = useState<Enrollment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);

  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const LIMIT = 100;

  useEffect(() => {
    api.get("/all-courses-admin-info")
      .then((res) => setCourses(res.data.courses || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(page, courseFilter);
  }, [page, courseFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = (p: number, course: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (course) params.set("course", course);
    api.get(`/all-enrollments?${params}`)
      .then((res) => {
        setItems(res.data.enrollments || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this enrollment record?")) return;
    await api.delete(`/delete-enrollment/${id}`);
    setItems((prev) => prev.filter((e) => e._id !== id));
    setTotal((t) => t - 1);
  };

  const revokeEnrollment = async (e: Enrollment) => {
    const next = e.status === "active" ? "revoked" : "active";
    try {
      const res = await api.put(`/update-enrollment/${e._id}`, { status: next });
      setItems((prev) => prev.map((x) => x._id === e._id ? { ...x, ...res.data.enrollment } : x));
    } catch { /* silent */ }
  };

  const handleCreate = async () => {
    if (!form.userId.trim() || !form.courseId.trim()) {
      setFormError("User ID and Course ID are required.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const res = await api.post("/add-enrollment", {
        userId:           form.userId.trim(),
        courseId:         form.courseId.trim(),
        paymentReference: form.paymentReference.trim() || null,
        amount:           form.amount ? parseFloat(form.amount) : null,
        status:           form.status,
      });
      setItems((prev) => [res.data.enrollment, ...prev]);
      setTotal((t) => t + 1);
      setPanelOpen(false);
      setForm(EMPTY_FORM);
    } catch {
      setFormError("Could not create enrollment. Check the IDs and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const data = filtered.map((e, i) => ({
      "#": i + 1,
      Student: e.studentName || "—",
      Email: e.studentEmail || "—",
      School: e.studentSchool || "—",
      Course: e.courseTitle || e.courseId || "—",
      Reference: e.paymentReference || "—",
      Amount: e.amount ? `GHS ${parseFloat(String(e.amount)).toLocaleString()}` : "—",
      Status: e.status || "—",
      "Enrolled on": e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString() : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Enrollments");
    XLSX.writeFile(wb, "Gifted_Enrollments.xlsx");
  };

  const set = (k: keyof typeof EMPTY_FORM, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const filtered = search.trim()
    ? items.filter((e) =>
        (e.studentName  || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.courseTitle  || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.studentEmail || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.paymentReference || "").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const totalRevenue = items.reduce((s, e) => s + (e.status === "active" ? parseFloat(String(e.amount || 0)) || 0 : 0), 0);

  return (
    <AuthGuard>
      <DashboardShell title="Course Enrollments">
        <div className="space-y-4 max-w-5xl">
          {/* Summary */}
          {!loading && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total enrollments", value: total.toLocaleString() },
                { label: "Active on this page", value: items.filter((e) => e.status === "active").length },
                { label: "Revenue (active, this page)", value: `GHS ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-xl px-4 py-3">
                  <p className="text-lg font-bold text-ink">{s.value}</p>
                  <p className="text-xs text-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <Card
            padding={false}
            title={`${total.toLocaleString()} enrollment${total !== 1 ? "s" : ""}`}
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, course or reference..."
                  className="border border-border rounded-lg px-3 py-2 text-sm w-60 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
                <select value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setPage(0); }}
                  className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary bg-white">
                  <option value="">All courses</option>
                  {courses.map((c) => (
                    <option key={c._id} value={c.mongoId || c._id}>{c.title}</option>
                  ))}
                </select>
                {items.length > 0 && (
                  <button onClick={handleExport}
                    className="p-2 rounded-lg border border-border text-muted hover:text-ink transition-colors">
                    <Download size={14} />
                  </button>
                )}
                <Button size="sm" onClick={() => { setPanelOpen(true); setFormError(""); setForm(EMPTY_FORM); }}>
                  <Plus size={14} /> Add enrollment
                </Button>
              </div>
            }
          >
            {loading ? (
              <Spinner text="Loading enrollments..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <GraduationCap size={28} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">{search ? "No enrollments match your search." : "No enrollments recorded yet."}</p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface/50">
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Student</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Course</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Amount</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Reference</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Status</th>
                      <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                      <th className="px-5 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink text-sm">{e.studentName || "Unknown"}</p>
                          {e.studentEmail  && <p className="text-xs text-muted">{e.studentEmail}</p>}
                          {e.studentSchool && <p className="text-xs text-subtle">{e.studentSchool}</p>}
                        </td>
                        <td className="px-5 py-3 text-muted text-sm max-w-[180px] truncate">
                          {e.courseTitle || e.courseId || "—"}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium text-ink">
                          {e.amount ? `GHS ${parseFloat(String(e.amount)).toLocaleString()}` : "—"}
                        </td>
                        <td className="px-5 py-3 text-muted text-xs font-mono">{e.paymentReference || "—"}</td>
                        <td className="px-5 py-3">
                          <button onClick={() => revokeEnrollment(e)}
                            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${STATUS_COLORS[e.status || "active"] || "bg-surface text-muted border border-border"}`}
                            title={e.status === "active" ? "Click to revoke" : "Click to reinstate"}>
                            {e.status || "active"}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-muted text-xs whitespace-nowrap">
                          {e.enrolledAt ? new Date(e.enrolledAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <button onClick={() => handleDelete(e._id)} className="p-1.5 rounded text-muted hover:text-danger transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {total > LIMIT && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                    <p className="text-xs text-muted">Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}</p>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>Previous</Button>
                      <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * LIMIT >= total}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add enrollment manually">
          <div className="space-y-4">
            <p className="text-sm text-muted">Use this to manually record a course enrollment, for example after an offline payment or a Paystack payment that was not captured automatically.</p>
            <Input label="User ID (MongoDB ID)" value={form.userId} onChange={(e) => set("userId", e.target.value)}
              placeholder="User's mongo_id from the Users table" />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Course</label>
              <select value={form.courseId} onChange={(e) => set("courseId", e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm">
                <option value="">Select a course...</option>
                {courses.map((c) => (
                  <option key={c._id} value={c.mongoId || c._id}>{c.title}</option>
                ))}
              </select>
            </div>
            <Input label="Paystack reference" value={form.paymentReference} onChange={(e) => set("paymentReference", e.target.value)}
              placeholder="e.g. T123456789" hint="Leave blank for offline/manual enrollments" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount (GHS)" value={form.amount} type="number" onChange={(e) => set("amount", e.target.value)} placeholder="0.00" />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink">Status</label>
                <select value={form.status} onChange={(e) => set("status", e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-ink focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm">
                  <option value="active">Active</option>
                  <option value="revoked">Revoked</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>
            </div>
            {formError && <p className="text-sm text-danger">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <Button onClick={handleCreate} disabled={saving} className="flex-1">
                {saving ? "Saving..." : "Record enrollment"}
              </Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
