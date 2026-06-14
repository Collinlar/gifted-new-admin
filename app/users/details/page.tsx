"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, Clock, ShieldCheck, Ban, KeyRound, Edit2, Check, X } from "lucide-react";

interface UserDetail {
  _id?: string;
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber?: string;
  DOB?: string; dob?: string;
  Category?: string; category?: string;
  School?: string; school?: string;
  gender?: string;
  grade?: string;
  country?: string;
  role?: string;
  isActive?: boolean;
  isSuspended?: boolean;
  purposeOfRegistration?: string | string[];
  [key: string]: unknown;
}

interface Registration {
  name?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  cost?: string | number;
  [key: string]: unknown;
}

const ROLES = ["student", "parent", "admin", "moderator"];

const CATEGORY_COLORS: Record<string, string> = {
  Student:               "bg-blue-50 text-blue-700",
  Parent:                "bg-purple-50 text-purple-700",
  "University Graduate": "bg-emerald-50 text-emerald-700",
  "Working Professional":"bg-amber-50 text-amber-700",
};

export default function UserDetailsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [paid, setPaid] = useState<Registration[]>([]);
  const [pending, setPending] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  // Role editing
  const [editingRole, setEditingRole] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [savingRole, setSavingRole] = useState(false);

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Password reset
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");

  // Suspend
  const [savingSuspend, setSavingSuspend] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("details");
    if (!stored) { router.push("/users"); return; }
    const u: UserDetail = JSON.parse(stored);
    setUser(u);
    setSelectedRole(u.role || "student");
    setProfileForm({
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      email: u.email || "",
      mobileNumber: (u.mobileNumber as string) || "",
      dob: (u.dob as string) || (u.DOB as string) || "",
      gender: (u.gender as string) || "",
      country: (u.country as string) || "",
      school: (u.school as string) || (u.School as string) || "",
      grade: (u.grade as string) || "",
      category: (u.category as string) || (u.Category as string) || "",
    });

    const fullName = `${u.firstName} ${u.lastName}`;
    Promise.allSettled([
      api.get(`/fetch-registered-programs/${fullName}/paid`),
      api.get(`/fetch-registered-programs/${fullName}/pending`),
    ]).then(([p, pen]) => {
      if (p.status === "fulfilled") setPaid(p.value.data.registered || []);
      if (pen.status === "fulfilled") setPending(pen.value.data.registered || []);
    }).finally(() => setLoading(false));
  }, [router]);

  const saveProfile = async () => {
    if (!user?._id) return;
    setSavingProfile(true);
    setProfileError("");
    try {
      await api.put(`/update-user/${user._id}`, profileForm);
      setUser({ ...user, ...profileForm });
      setEditingProfile(false);
    } catch {
      setProfileError("Could not save profile. Try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveRole = async () => {
    if (!user?._id) return;
    setSavingRole(true);
    try {
      await api.put(`/update-user/${user._id}`, { role: selectedRole });
      setUser({ ...user, role: selectedRole });
      setEditingRole(false);
    } catch {
      alert("Could not update role.");
    } finally {
      setSavingRole(false);
    }
  };

  const toggleSuspend = async () => {
    if (!user?._id) return;
    const isSuspended = !user.isSuspended;
    if (!confirm(`${isSuspended ? "Suspend" : "Reactivate"} this user?`)) return;
    setSavingSuspend(true);
    try {
      await api.put(`/update-user/${user._id}`, { isSuspended });
      setUser({ ...user, isSuspended });
    } catch {
      alert("Could not update user status.");
    } finally {
      setSavingSuspend(false);
    }
  };

  const resetPassword = async () => {
    if (!user?._id || !newPassword.trim()) return;
    if (newPassword.length < 6) return setPasswordMsg("Password must be at least 6 characters.");
    setSavingPassword(true);
    setPasswordMsg("");
    try {
      await api.put(`/update-user/${user._id}`, { password: newPassword });
      setPasswordMsg("Password updated.");
      setNewPassword("");
      setShowPasswordForm(false);
    } catch {
      setPasswordMsg("Could not reset password. Try again.");
    } finally {
      setSavingPassword(false);
    }
  };

  if (!user) return null;

  const fullName = `${user.firstName} ${user.lastName}`;
  const isSuspended = user.isSuspended || false;

  const fields = [
    ["Email", user.email],
    ["Phone", user.mobileNumber],
    ["Date of Birth", user.dob || user.DOB],
    ["Category", user.category || user.Category],
    ["School", user.school || user.School],
    ["Gender", user.gender],
    ["Grade", user.grade],
    ["Country", user.country],
    ["Purpose", Array.isArray(user.purposeOfRegistration) ? user.purposeOfRegistration.join(", ") : user.purposeOfRegistration],
  ].filter(([, v]) => v);

  return (
    <AuthGuard>
      <DashboardShell title={fullName}>
        <div className="space-y-5 max-w-3xl">
          <Button variant="ghost" size="sm" onClick={() => router.push("/users")}>
            <ArrowLeft size={14} /> Back to users
          </Button>

          {/* Status bar */}
          <div className="bg-card border border-border rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${isSuspended ? "bg-red-50 text-red-500" : "bg-primary-light text-primary"}`}>
                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-ink text-sm">{fullName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${isSuspended ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
                    {isSuspended ? <Ban size={10} /> : <CheckCircle size={10} />}
                    {isSuspended ? "Suspended" : "Active"}
                  </span>
                  {(user.category || user.Category) && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[(user.category || user.Category) as string] || "bg-primary-light text-primary"}`}>
                      {(user.category || user.Category) as string}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Role editor */}
              {editingRole ? (
                <div className="flex items-center gap-2">
                  <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
                    className="border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
                  </select>
                  <button onClick={saveRole} disabled={savingRole}
                    className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors">
                    <Check size={13} />
                  </button>
                  <button onClick={() => setEditingRole(false)} className="p-1.5 rounded-lg border border-border text-muted hover:text-ink transition-colors">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingRole(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:text-ink hover:border-primary/40 transition-colors">
                  <ShieldCheck size={13} /> Change role
                </button>
              )}

              <button onClick={() => { setShowPasswordForm(!showPasswordForm); setPasswordMsg(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:text-ink hover:border-primary/40 transition-colors">
                <KeyRound size={13} /> Reset password
              </button>

              <button onClick={toggleSuspend} disabled={savingSuspend}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${isSuspended ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
                {isSuspended ? <><CheckCircle size={13} /> Reactivate</> : <><Ban size={13} /> Suspend</>}
              </button>
            </div>
          </div>

          {/* Password reset form */}
          {showPasswordForm && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 space-y-3">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-2"><KeyRound size={14} /> Set new password for {user.firstName}</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min. 6 characters)"
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                />
                <Button size="sm" onClick={resetPassword} disabled={savingPassword}>
                  {savingPassword ? "Saving..." : "Set password"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowPasswordForm(false)}>Cancel</Button>
              </div>
              {passwordMsg && (
                <p className={`text-xs ${passwordMsg.includes("updated") ? "text-emerald-700" : "text-red-600"}`}>{passwordMsg}</p>
              )}
            </div>
          )}

          {/* Profile */}
          <Card title="Profile" action={
            editingProfile ? (
              <div className="flex items-center gap-2">
                <button onClick={saveProfile} disabled={savingProfile}
                  className="flex items-center gap-1 text-xs text-primary hover:opacity-75 font-medium transition-opacity">
                  <Check size={12} /> {savingProfile ? "Saving..." : "Save"}
                </button>
                <button onClick={() => { setEditingProfile(false); setProfileError(""); }}
                  className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
                  <X size={12} /> Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setEditingProfile(true)} className="flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors">
                <Edit2 size={12} /> Edit
              </button>
            )
          }>
            {profileError && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2 mb-4">{profileError}</p>}
            {editingProfile ? (
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="First name" value={profileForm.firstName} onChange={(e) => setProfileForm((f) => ({ ...f, firstName: e.target.value }))} />
                <Input label="Last name" value={profileForm.lastName} onChange={(e) => setProfileForm((f) => ({ ...f, lastName: e.target.value }))} />
                <Input label="Email" type="email" value={profileForm.email} onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))} />
                <Input label="Phone" value={profileForm.mobileNumber} onChange={(e) => setProfileForm((f) => ({ ...f, mobileNumber: e.target.value }))} />
                <Input label="Date of birth" type="date" value={profileForm.dob} onChange={(e) => setProfileForm((f) => ({ ...f, dob: e.target.value }))} />
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted uppercase tracking-wide">Gender</label>
                  <select value={profileForm.gender} onChange={(e) => setProfileForm((f) => ({ ...f, gender: e.target.value }))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="">Select</option>
                    <option>Male</option><option>Female</option>
                  </select>
                </div>
                <Input label="Country" value={profileForm.country} onChange={(e) => setProfileForm((f) => ({ ...f, country: e.target.value }))} />
                <Input label="School" value={profileForm.school} onChange={(e) => setProfileForm((f) => ({ ...f, school: e.target.value }))} />
                <Input label="Grade" value={profileForm.grade} onChange={(e) => setProfileForm((f) => ({ ...f, grade: e.target.value }))} />
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted uppercase tracking-wide">Category</label>
                  <select value={profileForm.category} onChange={(e) => setProfileForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="">Select</option>
                    <option>Student</option><option>Parent</option>
                    <option>University Graduate</option><option>Working Professional</option>
                  </select>
                </div>
              </div>
            ) : (
              <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
                {fields.map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-xs text-muted uppercase tracking-wide font-medium">{label}</dt>
                    <dd className="mt-0.5 text-sm text-ink">{value as string}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {/* Registrations */}
          {loading ? <Spinner text="Loading registrations..." /> : (
            <>
              <Card title={`Paid Registrations (${paid.length})`}>
                {paid.length === 0 ? (
                  <p className="text-sm text-muted">No paid registrations.</p>
                ) : (
                  <div className="space-y-0">
                    {paid.map((r, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                        <span className="text-sm text-ink font-medium">{r.name || r.title}</span>
                        <div className="flex items-center gap-2">
                          {r.cost && <span className="text-xs text-muted">GH₵{r.cost}</span>}
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle size={10} /> Paid
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title={`Pending Invoices (${pending.length})`}>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted">No pending invoices.</p>
                ) : (
                  <div className="space-y-0">
                    {pending.map((r, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                        <span className="text-sm text-ink font-medium">{r.name || r.title}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                          <Clock size={10} /> Pending
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
