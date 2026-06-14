"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Users, Trophy, BookOpen, ClipboardList,
  Users2, Star, Zap, Brain, Layers, Map, BarChart3,
  MessageSquare, Package, CreditCard, Calendar, X,
  ChevronDown, LogOut, Megaphone, ClipboardCheck, Award, Medal, GraduationCap,
  Shield, BookMarked, Hash, History,
} from "lucide-react";
import { clearToken } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/users", label: "All Users", icon: Users },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/competitions", label: "Competitions", icon: Trophy },
      { href: "/learning", label: "Courses", icon: BookOpen },
      { href: "/assessment", label: "Assessments", icon: ClipboardList },
      { href: "/flashcards", label: "Flash Cards", icon: Zap },
      { href: "/timed-challenges", label: "Timed Challenges", icon: Brain },
      { href: "/exam-mode", label: "Exam Mode", icon: Layers },
      { href: "/pathways", label: "Pathways", icon: Map },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/community", label: "Groups", icon: Users2 },
      { href: "/interests", label: "Interests", icon: Star },
    ],
  },
  {
    label: "Engagement",
    items: [
      { href: "/announcements", label: "Announcements", icon: Megaphone },
      { href: "/registrations", label: "Registrations", icon: ClipboardCheck },
      { href: "/leaderboard", label: "Leaderboard", icon: Medal },
      { href: "/badges", label: "Badges", icon: Award },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/quiz-scores", label: "Quiz Results", icon: BarChart3 },
      { href: "/enrollments", label: "Enrollments", icon: GraduationCap },
      { href: "/course-progress", label: "Course Progress", icon: GraduationCap },
      { href: "/course-reviews", label: "Course Activity", icon: BookMarked },
      { href: "/exam-scores", label: "Exam Scores", icon: Hash },
      { href: "/assessment-history", label: "Assessment History", icon: History },
      { href: "/feedback", label: "Feedback", icon: MessageSquare },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin-accounts", label: "Admin Accounts", icon: Shield },
      { href: "/transactions", label: "Transactions", icon: CreditCard },
      { href: "/addons", label: "Add-ons", icon: Package },
      { href: "/calendar", label: "Calendar", icon: Calendar },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) =>
    setCollapsed((c) => ({ ...c, [label]: !c[label] }));

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full w-56 bg-sidebar z-40 flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 lg:static lg:z-auto
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">G</span>
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">Gifted Admin</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-white/40 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
          {NAV.map((group) => {
            const isOpen = !collapsed[group.label];
            return (
              <div key={group.label} className="mb-1">
                <button
                  onClick={() => toggle(group.label)}
                  className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-semibold text-white/35 uppercase tracking-widest hover:text-white/60 transition-colors"
                >
                  {group.label}
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-150 ${isOpen ? "" : "-rotate-90"}`}
                  />
                </button>

                {isOpen && (
                  <div className="space-y-0.5 mt-0.5">
                    {group.items.map(({ href, label, icon: Icon }) => {
                      const active = isActive(href);
                      return (
                        <Link
                          key={href}
                          href={href}
                          onClick={onClose}
                          className={`
                            flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all
                            ${active
                              ? "bg-primary text-white font-medium"
                              : "text-white/55 hover:text-white hover:bg-white/6"
                            }
                          `}
                        >
                          <Icon size={15} className="shrink-0" />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-2 pb-3 border-t border-white/8 pt-3 shrink-0">
          <button
            onClick={() => { clearToken(); window.location.href = "/login"; }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-white/40 hover:text-white hover:bg-white/6 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
