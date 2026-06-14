"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import api from "@/lib/api";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";

interface Transaction {
  _id: string;
  name?: string;
  amount?: string | number;
  description?: string;
  status?: string;
  generatedOn?: string;
  paidOn?: string;
  createdAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700",
  Paid: "bg-emerald-50 text-emerald-700",
  success: "bg-emerald-50 text-emerald-700",
  Pending: "bg-amber-50 text-amber-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  Failed: "bg-red-50 text-red-700",
};

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [filtered, setFiltered] = useState<Transaction[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/all-transactions")
      .then((res) => {
        const data = res.data.transactions || res.data.allTransactions || [];
        setItems(data);
        setFiltered(data);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const applyFilter = (status: string) => {
    setStatusFilter(status);
    setFiltered(status ? items.filter((t) => t.status?.toLowerCase() === status.toLowerCase()) : items);
  };

  const handleExport = () => {
    const rows = filtered.map((t, i) => ({
      "#": i + 1,
      Name: t.name || "—",
      Amount: t.amount ?? "—",
      Description: t.description || "—",
      Status: t.status || "—",
      "Generated On": t.generatedOn || "—",
      "Paid On": t.paidOn || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, "Gifted_Transactions.xlsx");
  };

  const statuses = [...new Set(items.map((t) => t.status).filter(Boolean))] as string[];
  const totalAmount = filtered.reduce((sum, t) => sum + (parseFloat(String(t.amount || 0)) || 0), 0);

  return (
    <AuthGuard>
      <DashboardShell title="Transactions">
        <div className="space-y-4 max-w-5xl">
          {/* Summary strip */}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total transactions", value: items.length.toLocaleString() },
                { label: "Shown / filtered", value: filtered.length.toLocaleString() },
                { label: "Total amount (filtered)", value: `GHS ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-xl px-4 py-3">
                  <p className="text-lg font-bold text-ink">{s.value}</p>
                  <p className="text-xs text-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <Card
            title={`${filtered.length} transaction${filtered.length !== 1 ? "s" : ""}${statusFilter ? ` · ${statusFilter}` : ""}`}
            padding={false}
            action={
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => applyFilter(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button variant="secondary" size="sm" onClick={handleExport}>
                  <Download size={14} /> Export
                </Button>
              </div>
            }
          >
            {loading ? (
              <Spinner text="Loading transactions..." />
            ) : filtered.length === 0 ? (
              <p className="text-muted text-sm py-12 text-center">No transactions found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["#", "Name", "Amount", "Description", "Status", "Generated", "Paid On"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => (
                      <tr key={t._id} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-3 text-muted text-xs">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-ink">{t.name || "—"}</td>
                        <td className="px-4 py-3 font-semibold text-ink">
                          {t.amount ? `GHS ${parseFloat(String(t.amount)).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted max-w-xs truncate">{t.description || "—"}</td>
                        <td className="px-4 py-3">
                          {t.status ? (
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] || "bg-surface text-muted"}`}>
                              {t.status}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{t.generatedOn || "—"}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{t.paidOn || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
