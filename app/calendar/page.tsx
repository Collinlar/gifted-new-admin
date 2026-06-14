"use client";

import { useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import { ChevronLeft, ChevronRight } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function CalendarPage() {
  const today = new Date();
  const [current, setCurrent] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const firstDay = new Date(current.year, current.month, 1).getDay();
  const daysInMonth = new Date(current.year, current.month + 1, 0).getDate();

  const prev = () => setCurrent((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 });
  const next = () => setCurrent((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 });

  const isToday = (d: number) => d === today.getDate() && current.month === today.getMonth() && current.year === today.getFullYear();

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <AuthGuard>
      <DashboardShell title="Calendar">
        <Card className="max-w-xl">
          <div className="flex items-center justify-between mb-6">
            <button onClick={prev} className="p-2 rounded-lg hover:bg-surface transition-colors text-muted hover:text-ink">
              <ChevronLeft size={18} />
            </button>
            <span className="font-semibold text-ink">{MONTHS[current.month]} {current.year}</span>
            <button onClick={next} className="p-2 rounded-lg hover:bg-surface transition-colors text-muted hover:text-ink">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-2">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-muted py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => (
              <div key={i} className="aspect-square flex items-center justify-center">
                {day && (
                  <button className={`w-8 h-8 rounded-full text-sm transition-colors flex items-center justify-center ${isToday(day) ? "bg-teal text-white font-semibold" : "text-ink hover:bg-surface"}`}>
                    {day}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </DashboardShell>
    </AuthGuard>
  );
}
