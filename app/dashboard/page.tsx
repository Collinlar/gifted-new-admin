"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import { Users, Trophy, BookOpen, ClipboardList, TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface RecentUser { firstName?: string; lastName?: string; email?: string; createdAt?: string; }
interface MonthBucket { month: number; count: number; }
interface Stats {
  totalUsers: number; newUsers: number;
  totalCompetitions: number; totalCourses: number;
  totalExams: number; contestExams: number;
  totalActiveUsers: number;
  recentUsers: RecentUser[];
  monthlyRegistrations: MonthBucket[];
  monthlyActive: MonthBucket[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    api.get("/dashboard-stats")
      .then((res) => setStats(res.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  const s = stats;

  const statCards = [
    { label: "Total Users", value: s?.totalUsers ?? 0, sub: `+${s?.newUsers ?? 0} this month`, icon: Users, color: "text-primary", bg: "bg-primary-light", href: "/users" },
    { label: "Active Users", value: s?.totalActiveUsers ?? 0, sub: "Submitted at least one quiz", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50", href: "/quiz-scores" },
    { label: "Competitions", value: s?.totalCompetitions ?? 0, sub: "Active programs", icon: Trophy, color: "text-amber-600", bg: "bg-amber-50", href: "/competitions" },
    { label: "Courses", value: s?.totalCourses ?? 0, sub: "Learning materials", icon: BookOpen, color: "text-emerald-600", bg: "bg-emerald-50", href: "/learning" },
    { label: "Assessments", value: s?.totalExams ?? 0, sub: `${s?.contestExams ?? 0} contests`, icon: ClipboardList, color: "text-violet-600", bg: "bg-violet-50", href: "/assessment" },
  ];

  const monthlyUsers = MONTHS.map((month, i) => ({
    month,
    "New registrations": s?.monthlyRegistrations?.find((b) => b.month === i)?.count ?? 0,
    "Active users": s?.monthlyActive?.find((b) => b.month === i)?.count ?? 0,
  }));

  const thisYear = new Date().getFullYear();

  const quizData = [
    { name: "Quizzes", count: (s?.totalExams ?? 0) - (s?.contestExams ?? 0) },
    { name: "Contests", count: s?.contestExams ?? 0 },
    { name: "Courses", count: s?.totalCourses ?? 0 },
    { name: "Programs", count: s?.totalCompetitions ?? 0 },
  ];

  const recentUsers = s?.recentUsers ?? [];

  const getName = (u: RecentUser) => `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";

  if (loading) {
    return (
      <AuthGuard>
        <DashboardShell title="Dashboard">
          <Spinner text="Loading dashboard..." />
        </DashboardShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <DashboardShell title="Dashboard">
        <div className="space-y-5">

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {statCards.map((card) => (
              <Link key={card.label} href={card.href}
                className="bg-card rounded-xl border border-border shadow-card p-5 hover:border-primary/30 hover:shadow-md transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className={`${card.bg} ${card.color} p-2.5 rounded-xl`}>
                    <card.icon size={18} />
                  </div>
                  <ArrowRight size={14} className="text-subtle group-hover:text-primary transition-colors mt-1" />
                </div>
                <p className="text-2xl font-bold text-ink">{card.value.toLocaleString()}</p>
                <p className="text-sm text-muted mt-0.5">{card.label}</p>
                <p className="text-xs text-subtle mt-1">{card.sub}</p>
              </Link>
            ))}
          </div>

          {/* Charts — only rendered client-side to avoid Recharts hydration mismatch */}
          {mounted && <div className="grid lg:grid-cols-3 gap-4">
            {/* Line chart — spans 2 cols */}
            <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold text-ink text-sm">User Registrations</p>
                  <p className="text-xs text-muted mt-0.5">{thisYear} monthly breakdown · {(s?.totalUsers ?? 0).toLocaleString()} all-time</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg font-medium">
                  <TrendingUp size={11} /> +{s?.newUsers ?? 0} this month
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={monthlyUsers}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #E2E8F0", boxShadow: "none", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="New registrations" stroke="#4F46E5" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Active users" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Bar chart */}
            <div className="bg-card border border-border rounded-xl shadow-card p-5">
              <p className="font-semibold text-ink text-sm mb-1">Content breakdown</p>
              <p className="text-xs text-muted mb-4">Records by type</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={quizData} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #E2E8F0", boxShadow: "none", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>}

          {/* Bottom row */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Recent users */}
            <div className="bg-card border border-border rounded-xl shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-semibold text-ink text-sm">Recent sign-ups</p>
                <Link href="/users" className="text-xs text-primary hover:underline font-medium">View all</Link>
              </div>
              {recentUsers.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">No users yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentUsers.map((u, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary-light flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {getName(u).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{getName(u)}</p>
                        <p className="text-xs text-muted truncate">{u.email || ""}</p>
                      </div>
                      {u.createdAt && (
                        <p className="text-xs text-subtle shrink-0">
                          {new Date(u.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="bg-card border border-border rounded-xl shadow-card p-5">
              <p className="font-semibold text-ink text-sm mb-4">Quick actions</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { href: "/assessment/add", label: "Create quiz", desc: "Add a new assessment", color: "text-violet-600", bg: "bg-violet-50" },
                  { href: "/announcements", label: "Announcement", desc: "Publish to users", color: "text-primary", bg: "bg-primary-light" },
                  { href: "/registrations", label: "Registrations", desc: "View sign-ups", color: "text-amber-600", bg: "bg-amber-50" },
                  { href: "/quiz-scores", label: "Quiz results", desc: "See all scores", color: "text-emerald-600", bg: "bg-emerald-50" },
                  { href: "/leaderboard", label: "Leaderboard", desc: "Contest rankings", color: "text-rose-600", bg: "bg-rose-50" },
                  { href: "/course-progress", label: "Course progress", desc: "Track completion", color: "text-cyan-600", bg: "bg-cyan-50" },
                ].map((a) => (
                  <Link key={a.href} href={a.href}
                    className="flex items-start gap-2.5 p-3 rounded-xl border border-border hover:border-primary/30 hover:shadow-sm transition-all group bg-surface">
                    <div className={`${a.bg} ${a.color} p-1.5 rounded-lg shrink-0 mt-0.5`}>
                      <ArrowRight size={11} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink group-hover:text-primary transition-colors">{a.label}</p>
                      <p className="text-xs text-subtle mt-0.5">{a.desc}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
