"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Search, Download, Eye, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber?: string;
  school?: string;
  gender?: string;
  grade?: string;
  country?: string;
  purposeOfRegistration?: string | string[];
  [key: string]: unknown;
}

const PAGE_SIZE = 100;

const CATEGORY_OPTIONS = ["Student", "Parent", "University Graduate", "Working Professional"];
const GENDER_OPTIONS   = ["Male", "Female"];

const CATEGORY_COLORS: Record<string, string> = {
  Student:               "bg-blue-50 text-blue-700 border-blue-100",
  Parent:                "bg-purple-50 text-purple-700 border-purple-100",
  "University Graduate": "bg-emerald-50 text-emerald-700 border-emerald-100",
  "Working Professional":"bg-amber-50 text-amber-700 border-amber-100",
};

function FilterDropdown({
  label, value, options, onSelect,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
          value ? "border-primary text-primary bg-primary-light" : "border-border text-muted hover:text-ink hover:border-ink"
        }`}
      >
        {value || label}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg z-30 py-1 min-w-48">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onSelect(o); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors ${o === value ? "text-primary font-medium" : "text-ink"}`}
            >
              {o}
            </button>
          ))}
          {value && (
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => { onSelect(""); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-sm text-muted hover:bg-surface"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers]       = useState<User[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(0);
  const [loading, setLoading]   = useState(true);

  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("");
  const [gender,   setGender]   = useState("");
  const [grade,    setGrade]    = useState("");
  const [purpose,  setPurpose]  = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  const searchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gradeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load interests from Supabase for the purpose dropdown
  useEffect(() => {
    api.get("/all-interest").then((res) => {
      const data = res.data.interests || res.data.allInterest || [];
      setInterests(data.map((i: { name?: string }) => i.name).filter(Boolean).sort());
    }).catch(() => setInterests([]));
  }, []);

  const load = useCallback(async (
    p: number, q: string, cat: string, gen: string, gr: string, pur: string,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (q)   params.set("q", q);
      if (cat) params.set("category", cat);
      if (gen) params.set("gender", gen);
      if (gr)  params.set("grade", gr);
      if (pur) params.set("purpose", pur);
      const res = await api.get(`/all-users?${params.toString()}`);
      setUsers(res.data.users || []);
      setTotal(res.data.total ?? 0);
    } catch {
      setUsers([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0, "", "", "", "", ""); }, [load]);

  const handleSearch = (val: string) => {
    setSearch(val); setPage(0);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(0, val, category, gender, grade, purpose), 350);
  };

  const handleCategory = (val: string) => {
    setCategory(val); setPage(0);
    load(0, search, val, gender, grade, purpose);
  };

  const handleGender = (val: string) => {
    setGender(val); setPage(0);
    load(0, search, category, val, grade, purpose);
  };

  const handleGrade = (val: string) => {
    setGrade(val); setPage(0);
    if (gradeTimer.current) clearTimeout(gradeTimer.current);
    gradeTimer.current = setTimeout(() => load(0, search, category, gender, val, purpose), 350);
  };

  const handlePurpose = (val: string) => {
    setPurpose(val); setPage(0);
    load(0, search, category, gender, grade, val);
  };

  const clearFilters = () => {
    setSearch(""); setCategory(""); setGender(""); setGrade(""); setPurpose("");
    setPage(0);
    load(0, "", "", "", "", "");
  };

  const goPage = (p: number) => {
    setPage(p);
    load(p, search, category, gender, grade, purpose);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!(search || category || gender || grade || purpose);

  const handleDownload = () => {
    const exportRows = users.map((u, i) => ({
      "#": page * PAGE_SIZE + i + 1,
      Name: `${u.firstName} ${u.lastName}`,
      Email: u.email,
      Phone: u.mobileNumber || "—",
      DOB: (u.dob as string) || (u.DOB as string) || "—",
      Category: (u.category as string) || "—",
      School: u.school || "—",
      Gender: u.gender || "—",
      Grade: (u.grade as string) || "—",
      Country: u.country || "—",
      Purpose: Array.isArray(u.purposeOfRegistration)
        ? (u.purposeOfRegistration as string[]).join(", ")
        : (u.purposeOfRegistration as string) || "—",
      Joined: u.createdAt ? new Date(u.createdAt as string).toLocaleDateString() : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Users");
    XLSX.writeFile(wb, "Gifted_Users.xlsx");
  };

  const viewUser = (u: User) => {
    const { password, ...safe } = u as User & { password?: unknown };
    void password;
    localStorage.setItem("details", JSON.stringify(safe));
    router.push("/users/details");
  };

  const start = page * PAGE_SIZE + 1;
  const end   = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <AuthGuard>
      <DashboardShell title="All Users">
        <Card
          title={`${total.toLocaleString()} user${total !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : ""}`}
          padding={false}
          action={
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search users..."
                  className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary w-44"
                />
              </div>

              <FilterDropdown label="Category" value={category} options={CATEGORY_OPTIONS} onSelect={handleCategory} />
              <FilterDropdown label="Gender"   value={gender}   options={GENDER_OPTIONS}   onSelect={handleGender} />
              <FilterDropdown label="Purpose"  value={purpose}  options={interests}         onSelect={handlePurpose} />

              {/* Grade text search */}
              <input
                type="search"
                value={grade}
                onChange={(e) => handleGrade(e.target.value)}
                placeholder="Grade..."
                className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary w-28 transition-colors ${grade ? "border-primary bg-primary-light/20" : "border-border"}`}
              />

              {hasFilters && (
                <button onClick={clearFilters} className="text-sm text-muted hover:text-ink underline whitespace-nowrap">
                  Clear all
                </button>
              )}

              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download size={14} /> Export page
              </Button>
            </div>
          }
        >
          {loading ? (
            <Spinner text="Loading users..." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface/50">
                      {["#", "Name", "Email", "Phone", "DOB", "Category", "Grade", "Joined", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-muted font-medium text-xs whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-12 text-muted">No users match your search</td>
                      </tr>
                    ) : (
                      users.map((u, i) => {
                        const cat = u.category as string | undefined;
                        return (
                          <tr key={u._id} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                            <td className="px-4 py-3 text-muted text-xs">{page * PAGE_SIZE + i + 1}</td>
                            <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{u.firstName} {u.lastName}</td>
                            <td className="px-4 py-3 text-muted">{u.email}</td>
                            <td className="px-4 py-3 text-muted whitespace-nowrap">{u.mobileNumber || "—"}</td>
                            <td className="px-4 py-3 text-muted whitespace-nowrap">{(u.dob as string) || (u.DOB as string) || "—"}</td>
                            <td className="px-4 py-3">
                              {cat ? (
                                <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${CATEGORY_COLORS[cat] || "bg-surface text-muted border-border"}`}>
                                  {cat}
                                </span>
                              ) : <span className="text-muted text-xs">—</span>}
                            </td>
                            <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                              {u.grade ? (
                                <span className="px-2 py-0.5 rounded bg-surface border border-border">{u.grade as string}</span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                              {u.createdAt ? new Date(u.createdAt as string).toLocaleDateString() : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => viewUser(u)}
                                className="flex items-center gap-1.5 text-sm text-primary hover:opacity-75 transition-opacity"
                              >
                                <Eye size={14} /> View
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <p className="text-sm text-muted">
                    {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} users
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => goPage(page - 1)}
                      disabled={page === 0}
                      className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:border-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let p = i;
                      if (totalPages > 7) {
                        if (page < 4) p = i;
                        else if (page > totalPages - 4) p = totalPages - 7 + i;
                        else p = page - 3 + i;
                      }
                      return (
                        <button key={p} onClick={() => goPage(p)}
                          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? "bg-primary text-white" : "border border-border text-muted hover:text-ink hover:border-ink"}`}>
                          {p + 1}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => goPage(page + 1)}
                      disabled={page >= totalPages - 1}
                      className="p-1.5 rounded-lg border border-border text-muted hover:text-ink hover:border-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </DashboardShell>
    </AuthGuard>
  );
}
