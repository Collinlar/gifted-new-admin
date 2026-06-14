"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Download, CheckCircle, Clock, Search, ChevronDown, ChevronUp } from "lucide-react";
import * as XLSX from "xlsx";

interface Competition { _id: string; title: string; }
interface Registration {
  _id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  school?: string;
  grade?: string;
  paymentStatus?: string;
  paid?: boolean;
  createdAt?: string;
  programName?: string;
}

export default function RegistrationsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [regs, setRegs] = useState<Record<string, Registration[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loadingComps, setLoadingComps] = useState(true);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get("/all-competitions").then((res) => {
      setCompetitions(res.data.competitions || res.data.allCompetitions || []);
    }).finally(() => setLoadingComps(false));
  }, []);

  const toggle = async (id: string, title: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (regs[id]) return;
    setLoading((l) => ({ ...l, [id]: true }));
    try {
      // Try multiple endpoint patterns
      let data: Registration[] = [];
      try {
        const res = await api.get(`/fetch-registered-programs/${encodeURIComponent(title)}/paid`);
        data = res.data.registrations || res.data.users || res.data || [];
      } catch {
        try {
          const res = await api.get(`/all-registrations/${id}`);
          data = res.data.registrations || res.data || [];
        } catch {
          data = [];
        }
      }
      setRegs((r) => ({ ...r, [id]: Array.isArray(data) ? data : [] }));
    } finally {
      setLoading((l) => ({ ...l, [id]: false }));
    }
  };

  const markPaid = async (compId: string, regId: string) => {
    try {
      await api.put(`/update-pay-after-invoice`, { invoiceId: regId, paid: true });
      setRegs((r) => ({
        ...r,
        [compId]: r[compId].map((reg) =>
          reg._id === regId ? { ...reg, paid: true, paymentStatus: "paid" } : reg
        ),
      }));
    } catch {
      alert("Could not update payment status.");
    }
  };

  const getName = (r: Registration) =>
    r.name || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "—";

  const isPaid = (r: Registration) =>
    r.paid === true || r.paymentStatus === "paid" || r.paymentStatus === "Paid";

  const exportRegs = (title: string, id: string) => {
    const data = (regs[id] || []).map((r) => ({
      Name: getName(r),
      Email: r.email || "",
      Phone: r.phone || "",
      School: r.school || "",
      Grade: r.grade || "",
      Paid: isPaid(r) ? "Yes" : "No",
      Date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registrations");
    XLSX.writeFile(wb, `${title}_Registrations.xlsx`);
  };

  return (
    <AuthGuard>
      <DashboardShell title="Program Registrations">
        <div className="space-y-2 max-w-4xl">
          {loadingComps ? (
            <Spinner text="Loading competitions..." />
          ) : competitions.length === 0 ? (
            <Card><p className="text-muted text-sm py-8 text-center">No competitions found.</p></Card>
          ) : (
            competitions.map((comp) => {
              const isOpen = expanded === comp._id;
              const list = regs[comp._id] || [];
              const isLoading = loading[comp._id];
              const q = search[comp._id] || "";
              const f = filter[comp._id] || "all";

              const filtered = list.filter((r) => {
                const matchSearch = !q.trim() || getName(r).toLowerCase().includes(q.toLowerCase()) || (r.email || "").toLowerCase().includes(q.toLowerCase());
                const matchFilter = f === "all" || (f === "paid" && isPaid(r)) || (f === "unpaid" && !isPaid(r));
                return matchSearch && matchFilter;
              });

              const paidCount = list.filter(isPaid).length;

              return (
                <div key={comp._id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
                  <button
                    onClick={() => toggle(comp._id, comp.title)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface/60 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium text-ink text-sm">{comp.title}</p>
                      {isOpen && list.length > 0 && (
                        <p className="text-xs text-muted mt-0.5">
                          {list.length} registered · <span className="text-emerald-600 font-medium">{paidCount} paid</span> · <span className="text-amber-600 font-medium">{list.length - paidCount} unpaid</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      {isOpen && list.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); exportRegs(comp.title, comp._id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted border border-border hover:text-ink hover:border-primary/40 transition-colors"
                        >
                          <Download size={12} /> Export
                        </button>
                      )}
                      {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border">
                      {isLoading ? (
                        <Spinner text="Loading registrations..." />
                      ) : list.length === 0 ? (
                        <p className="text-muted text-sm py-8 text-center">No registrations yet.</p>
                      ) : (
                        <>
                          {/* Filters */}
                          <div className="px-5 py-3 border-b border-border flex items-center gap-3 bg-surface/40">
                            <div className="relative flex-1 max-w-xs">
                              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                              <input
                                value={q}
                                onChange={(e) => setSearch((s) => ({ ...s, [comp._id]: e.target.value }))}
                                placeholder="Search by name or email..."
                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 bg-white"
                              />
                            </div>
                            <div className="flex gap-1">
                              {(["all", "paid", "unpaid"] as const).map((opt) => (
                                <button key={opt} onClick={() => setFilter((f) => ({ ...f, [comp._id]: opt }))}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${f === opt ? "bg-primary text-white" : "bg-white border border-border text-muted hover:text-ink"}`}>
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>

                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-surface/30">
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Name</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Email</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">School</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Grade</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Status</th>
                                <th className="text-left px-5 py-2.5 text-muted font-medium text-xs">Date</th>
                                <th className="px-5 py-2.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map((r) => (
                                <tr key={r._id} className="border-b border-border last:border-0 hover:bg-surface/40">
                                  <td className="px-5 py-2.5 font-medium text-ink text-sm">{getName(r)}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.email || "—"}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.school || "—"}</td>
                                  <td className="px-5 py-2.5 text-muted text-sm">{r.grade || "—"}</td>
                                  <td className="px-5 py-2.5">
                                    {isPaid(r) ? (
                                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                                        <CheckCircle size={11} /> Paid
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                                        <Clock size={11} /> Unpaid
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-5 py-2.5 text-muted text-sm">
                                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                                  </td>
                                  <td className="px-5 py-2.5">
                                    {!isPaid(r) && (
                                      <button
                                        onClick={() => markPaid(comp._id, r._id)}
                                        className="text-xs text-primary hover:underline font-medium"
                                      >
                                        Mark paid
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
