"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import { Plus, Trash2, Shield } from "lucide-react";

interface Admin {
  _id: string;
  email: string;
  createdAt?: string;
}

export default function AdminAccountsPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/all-admins");
      setAdmins(res.data.admins || []);
    } catch { setAdmins([]); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setError("");
    if (!form.email.trim()) return setError("Email is required.");
    if (!form.password.trim()) return setError("Password is required.");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setSaving(true);
    try {
      await api.post("/add-admin", { email: form.email, password: form.password });
      await load();
      setPanelOpen(false);
      setForm({ email: "", password: "", confirmPassword: "" });
    } catch {
      setError("Could not create admin. The email may already be in use.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, email: string) => {
    if (admins.length <= 1) return alert("Cannot delete the last admin account.");
    if (!confirm(`Remove admin access for ${email}?`)) return;
    await api.delete(`/delete-admin/${id}`);
    setAdmins((p) => p.filter((a) => a._id !== id));
  };

  return (
    <AuthGuard>
      <DashboardShell title="Admin Accounts">
        <div className="space-y-4 max-w-2xl">
          <p className="text-sm text-muted">
            Manage who has admin access to this dashboard. At least one account must remain.
          </p>

          <Card
            title={`${admins.length} admin account${admins.length !== 1 ? "s" : ""}`}
            padding={false}
            action={
              <Button size="sm" onClick={() => { setError(""); setForm({ email: "", password: "", confirmPassword: "" }); setPanelOpen(true); }}>
                <Plus size={14} /> Add admin
              </Button>
            }
          >
            {loading ? (
              <Spinner text="Loading admins..." />
            ) : admins.length === 0 ? (
              <p className="text-muted text-sm py-12 text-center">No admin accounts found.</p>
            ) : (
              <div className="divide-y divide-border">
                {admins.map((a) => (
                  <div key={a._id} className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                        <Shield size={15} className="text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">{a.email}</p>
                        {a.createdAt && (
                          <p className="text-xs text-muted mt-0.5">
                            Added {new Date(a.createdAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(a._id, a.email)}
                      disabled={admins.length <= 1}
                      className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove admin"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Add admin account" width="md">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Email address</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@gifted.com"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min. 8 characters"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Confirm password</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Repeat password"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3 pt-2 border-t border-border">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Creating..." : "Create admin"}</Button>
              <Button variant="secondary" onClick={() => setPanelOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SlidePanel>
      </DashboardShell>
    </AuthGuard>
  );
}
