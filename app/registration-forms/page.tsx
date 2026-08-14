"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import api from "@/lib/api";
import {
  STANDARD_FIELDS, FIELD_GROUPS, TYPE_LABELS, GRADES,
  fieldFromStandard, prefillableCount, uid,
  type FormField, type FieldType,
} from "@/lib/registrationFields";
import {
  Plus, ArrowLeft, Trash2, ClipboardList, Save, Copy, ChevronUp, ChevronDown,
  Sparkles, Users, Eye,
} from "lucide-react";

interface RegForm {
  id: string; title: string; description?: string;
  programType: string; programId?: string | null; programTitle?: string | null;
  fields: FormField[];
  opensAt?: string | null; closesAt?: string | null;
  capacity?: number | null; waitlistWhenFull: boolean;
  requiresPayment: boolean; feeAmount?: number | null; feeCurrency: string;
  status: "draft" | "open" | "closed";
  confirmationMessage?: string | null; referencePrefix?: string | null;
  counts?: Record<string, number>;
}

function serverMessage(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

const STATUS_CHIP: Record<string, string> = {
  draft:  "bg-surface text-muted border-border",
  open:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-red-50 text-danger border-red-200",
};

// ── List ───────────────────────────────────────────────────────────────────

export default function RegistrationFormsPage() {
  const [forms, setForms] = useState<RegForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/registration-forms");
      setForms(res.data.forms || []);
    } catch { setForms([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError("");
    try {
      const res = await api.post("/add-registration-form", {
        title: "New registration form",
        // Start with the fields nobody should ever have to type
        fields: STANDARD_FIELDS.filter((s) =>
          ["first_name", "last_name", "email", "mobile_number", "school_name", "grade"].includes(s.key)
        ).map(fieldFromStandard),
      });
      await load();
      setEditing(res.data.form.id);
    } catch (e) { setError(serverMessage(e, "Could not create the form.")); }
  };

  const duplicate = async (f: RegForm) => {
    try {
      const res = await api.post("/add-registration-form", {
        ...f, title: `${f.title} copy`, status: "draft",
        programType: f.programType, programId: f.programId, programTitle: f.programTitle,
        opensAt: null, closesAt: null,
      });
      await load();
      setEditing(res.data.form.id);
    } catch (e) { setError(serverMessage(e, "Could not copy that form.")); }
  };

  if (editing) {
    return <FormBuilder formId={editing} onBack={() => { setEditing(null); load(); }} />;
  }

  return (
    <AuthGuard>
      <DashboardShell title="Registrations">
        <div className="space-y-4 max-w-5xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              One intake form per programme. Everything the platform already knows is filled in
              for the student, so these stay short.
            </p>
            <Button size="sm" onClick={create}><Plus size={14} /> New form</Button>
          </div>

          {error && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          <Card padding={false}>
            {loading ? <Spinner text="Loading your registration forms..." /> : forms.length === 0 ? (
              <div className="py-16 text-center">
                <ClipboardList size={30} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No registration forms yet.</p>
                <Button size="sm" className="mt-4" onClick={create}>
                  <Plus size={14} /> Build your first form
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {forms.map((f) => {
                  const c = f.counts || {};
                  return (
                    <div key={f.id} className="px-5 py-4 flex items-center gap-4">
                      <button onClick={() => setEditing(f.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-medium text-ink text-sm">{f.title}</p>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_CHIP[f.status]}`}>
                            {f.status === "open" ? "Open" : f.status === "closed" ? "Closed" : "Draft"}
                          </span>
                          {f.requiresPayment && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                              {f.feeCurrency} {f.feeAmount}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted">
                          <span>{(f.fields || []).length} questions</span>
                          <span className="text-emerald-600">
                            {prefillableCount(f.fields || [])} filled in automatically
                          </span>
                          <span>{c.total || 0} registered</span>
                          {(c.accepted || 0) > 0 && <span className="text-emerald-600">{c.accepted} accepted</span>}
                          {(c.waitlisted || 0) > 0 && <span className="text-amber-600">{c.waitlisted} waitlisted</span>}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(f.id)}>Open</Button>
                        <button onClick={() => duplicate(f)} title="Copy for another year"
                          className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-surface">
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Builder ────────────────────────────────────────────────────────────────

function FormBuilder({ formId, onBack }: { formId: string; onBack: () => void }) {
  const [form, setForm] = useState<RegForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"questions" | "settings" | "submissions">("questions");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    api.get(`/registration-form/${formId}`)
      .then((r) => setForm(r.data.form))
      .catch(() => setError("Could not load this form."))
      .finally(() => setLoading(false));
  }, [formId]);

  const set = (patch: Partial<RegForm>) => { setForm((f) => f && { ...f, ...patch }); setDirty(true); };
  const fields = form?.fields || [];

  const patchField = (id: string, p: Partial<FormField>) =>
    set({ fields: fields.map((f) => (f.id === id ? { ...f, ...p } : f)) });

  const removeField = (id: string) => set({ fields: fields.filter((f) => f.id !== id) });

  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    set({ fields: next });
  };

  const addCustom = (type: FieldType) => set({
    fields: [...fields, {
      id: uid(), key: `custom_${uid()}`, label: "New question", type,
      required: false, remember: false, source: null,
      options: type === "select" || type === "multiselect" ? ["Option one"] : undefined,
    }],
  });

  const save = async () => {
    if (!form) return;
    setError(""); setSaving(true);
    try {
      await api.put(`/update-registration-form/${formId}`, form);
      setDirty(false);
    } catch (e) { setError(serverMessage(e, "Could not save this form.")); }
    finally { setSaving(false); }
  };

  const usedKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

  if (loading) {
    return <AuthGuard><DashboardShell title="Registration form"><Spinner text="Loading..." /></DashboardShell></AuthGuard>;
  }
  if (!form) {
    return <AuthGuard><DashboardShell title="Registration form"><p className="text-sm text-danger">{error}</p></DashboardShell></AuthGuard>;
  }

  const auto = prefillableCount(fields);

  return (
    <AuthGuard>
      <DashboardShell title={form.title}>
        <div className="space-y-4 max-w-5xl pb-16">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => {
              if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
              onBack();
            }}>
              <ArrowLeft size={14} /> All forms
            </Button>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
              <select value={form.status} onChange={(e) => set({ status: e.target.value as RegForm["status"] })}
                className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                <option value="draft">Draft</option>
                <option value="open">Open for registration</option>
                <option value="closed">Closed</option>
              </select>
              <Button size="sm" onClick={save} disabled={saving}>
                <Save size={13} /> {saving ? "Saving..." : "Save form"}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

          <div className="flex items-center gap-1 border-b border-border">
            {([["questions", "Questions", ClipboardList],
               ["settings", "Settings", Sparkles],
               ["submissions", "Submissions", Users]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === v ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {tab === "questions" && (
            <>
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <Sparkles size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-800">
                  <strong>{auto} of {fields.length}</strong> questions are answered for the student before
                  they see this form, from their profile or from something they have told us before.
                  They confirm rather than type.
                </p>
              </div>

              <Card title={`Questions (${fields.length})`}
                action={
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => setPicker(true)}><Plus size={13} /> Add a question</Button>
                  </div>
                }
                padding={false}
              >
                {fields.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-sm text-muted">No questions yet.</p>
                    <Button size="sm" className="mt-3" onClick={() => setPicker(true)}>
                      <Plus size={13} /> Add the first one
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {fields.map((f, i) => (
                      <FieldRow key={f.id} field={f} index={i} total={fields.length}
                        onPatch={(p) => patchField(f.id, p)}
                        onRemove={() => removeField(f.id)}
                        onMove={(d) => moveField(i, d)} />
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}

          {tab === "settings" && <SettingsTab form={form} set={set} />}
          {tab === "submissions" && <SubmissionsTab formId={formId} form={form} />}
        </div>

        {picker && (
          <FieldPicker
            usedKeys={usedKeys}
            onClose={() => setPicker(false)}
            onPickStandard={(s) => { set({ fields: [...fields, fieldFromStandard(s)] }); setPicker(false); }}
            onPickCustom={(t) => { addCustom(t); setPicker(false); }}
          />
        )}
      </DashboardShell>
    </AuthGuard>
  );
}

// ── One question ───────────────────────────────────────────────────────────

function FieldRow({ field, index, total, onPatch, onRemove, onMove }: {
  field: FormField; index: number; total: number;
  onPatch: (p: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const auto = field.source ? "From their profile" : field.remember ? "Remembered from a previous form" : null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 pt-1 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0}
            className="p-0.5 rounded text-subtle hover:text-ink disabled:opacity-30"><ChevronUp size={13} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1}
            className="p-0.5 rounded text-subtle hover:text-ink disabled:opacity-30"><ChevronDown size={13} /></button>
        </div>

        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-ink">{field.label}</p>
            {field.required && <span className="text-xs text-danger">Required</span>}
            {auto && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                {auto}
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">
            {TYPE_LABELS[field.type]} · <code className="font-mono">{field.key}</code>
          </p>
        </button>

        <button onClick={onRemove} className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50 shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {open && (
        <div className="mt-3 ml-8 space-y-3 border-l-2 border-border pl-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Question" value={field.label} onChange={(e) => onPatch({ label: e.target.value })} />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Answer type</label>
              <select value={field.type} onChange={(e) => onPatch({ type: e.target.value as FieldType })}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <Input label="Help text (optional)" value={field.help || ""} onChange={(e) => onPatch({ help: e.target.value })} />

          {(field.type === "select" || field.type === "multiselect") && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Choices, one per line</label>
              <textarea
                value={(field.options || []).join("\n")}
                onChange={(e) => onPatch({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                rows={4}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-y"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle label="Required" value={!!field.required} onChange={(v) => onPatch({ required: v })} />
            <Toggle label="Half width" value={!!field.half} onChange={(v) => onPatch({ half: v })} />
            <Toggle label="Remember this answer for future forms"
              value={!!field.remember} onChange={(v) => onPatch({ remember: v })} />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">
              Field key <span className="font-normal text-muted text-xs">(how the answer is remembered)</span>
            </label>
            <input value={field.key} onChange={(e) => onPatch({ key: e.target.value.trim() })}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary" />
            <p className="text-xs text-muted pt-1">
              Two forms using the same key share the answer. Change this only if you know what it
              connects to.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field picker ───────────────────────────────────────────────────────────

function FieldPicker({ usedKeys, onClose, onPickStandard, onPickCustom }: {
  usedKeys: Set<string>;
  onClose: () => void;
  onPickStandard: (s: typeof STANDARD_FIELDS[number]) => void;
  onPickCustom: (t: FieldType) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto py-10 px-4">
      <div className="bg-card rounded-2xl max-w-2xl w-full">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-ink">Add a question</h3>
          <p className="text-sm text-muted mt-0.5">
            Standard questions are shared across every form, so an answer given once is never
            asked for again.
          </p>
        </div>

        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {FIELD_GROUPS.map((group) => {
            const items = STANDARD_FIELDS.filter((s) => s.group === group);
            return (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">{group}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {items.map((s) => {
                    const used = usedKeys.has(s.key);
                    return (
                      <button key={s.key} disabled={used} onClick={() => onPickStandard(s)}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                          used ? "border-border opacity-40 cursor-default"
                               : "border-border hover:border-primary hover:bg-primary-light/30"
                        }`}>
                        <p className="text-sm font-medium text-ink">{s.label}</p>
                        <p className="text-xs text-muted mt-0.5">
                          {used ? "Already on this form" : s.source ? "From their profile" : s.remember ? "Asked once ever" : TYPE_LABELS[s.type]}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Something else</p>
            <div className="flex flex-wrap gap-2">
              {(["text", "textarea", "select", "multiselect", "number", "date", "checkbox", "file", "section"] as FieldType[]).map((t) => (
                <button key={t} onClick={() => onPickCustom(t)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted hover:border-primary hover:text-primary">
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mt-2">
              A custom question is asked on every form that includes it. Prefer a standard one
              where it fits.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

function SettingsTab({ form, set }: { form: RegForm; set: (p: Partial<RegForm>) => void }) {
  const toLocal = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    <div className="space-y-4">
      <Card title="About this form">
        <div className="space-y-4">
          <Input label="Title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Description</label>
            <textarea value={form.description || ""} onChange={(e) => set({ description: e.target.value })}
              rows={3} placeholder="What this programme is, who it is for, and what happens after registering."
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary resize-none" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Programme name" value={form.programTitle || ""}
              onChange={(e) => set({ programTitle: e.target.value })} placeholder="National Mathematics Olympiad" />
            <Input label="Reference prefix" value={form.referencePrefix || ""}
              onChange={(e) => set({ referencePrefix: e.target.value })} placeholder="GHMATH" />
          </div>
          <p className="text-xs text-muted -mt-2">
            References look like GHMATH-2026-0042 and are what a student quotes when they contact you.
          </p>
        </div>
      </Card>

      <Card title="When it is open">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Opens</label>
              <input type="datetime-local" value={toLocal(form.opensAt)}
                onChange={(e) => set({ opensAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Closes</label>
              <input type="datetime-local" value={toLocal(form.closesAt)}
                onChange={(e) => set({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Places available" type="number" value={String(form.capacity ?? "")}
              onChange={(e) => set({ capacity: e.target.value ? Number(e.target.value) : null })}
              placeholder="Leave blank for no limit" />
          </div>
          <Toggle label="Waitlist people once it is full, rather than turning them away"
            value={form.waitlistWhenFull} onChange={(v) => set({ waitlistWhenFull: v })} />
        </div>
      </Card>

      <Card title="Fee">
        <div className="space-y-4">
          <Toggle label="This programme charges a registration fee"
            value={form.requiresPayment} onChange={(v) => set({ requiresPayment: v })} />
          {form.requiresPayment && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Input label="Amount" type="number" value={String(form.feeAmount ?? "")}
                onChange={(e) => set({ feeAmount: e.target.value ? Number(e.target.value) : null })} />
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Currency</label>
                <select value={form.feeCurrency} onChange={(e) => set({ feeCurrency: e.target.value })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary">
                  {["GHS", "USD", "NGN"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          <p className="text-xs text-muted">
            A registration is recorded as soon as the form is submitted, with payment tracked
            separately. Nobody loses their place because a payment is still clearing.
          </p>
        </div>
      </Card>

      <Card title="After they register">
        <div className="space-y-1">
          <label className="text-sm font-medium text-ink">Confirmation message</label>
          <textarea value={form.confirmationMessage || ""} onChange={(e) => set({ confirmationMessage: e.target.value })}
            rows={3} placeholder="Thank you. We will confirm your place by email once entries close."
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary resize-none" />
        </div>
      </Card>
    </div>
  );
}

// ── Submissions ────────────────────────────────────────────────────────────

interface Submission {
  id: string; reference?: string; status: string; paymentStatus: string;
  answers: Record<string, unknown>; submittedAt?: string; importedFrom?: string;
  user?: { firstName?: string; lastName?: string; email?: string; schoolName?: string; grade?: string } | null;
}

const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  draft:        { label: "Started",      cls: "bg-surface text-muted border-border" },
  submitted:    { label: "Submitted",    cls: "bg-blue-50 text-blue-700 border-blue-200" },
  under_review: { label: "Under review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  accepted:     { label: "Accepted",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  waitlisted:   { label: "Waitlisted",   cls: "bg-violet-50 text-violet-700 border-violet-200" },
  rejected:     { label: "Not accepted", cls: "bg-red-50 text-danger border-red-200" },
  withdrawn:    { label: "Withdrawn",    cls: "bg-surface text-muted border-border" },
};

function SubmissionsTab({ formId, form }: { formId: string; form: RegForm }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/registration-submissions/${formId}`)
      .then((r) => setSubs(r.data.submissions || []))
      .catch(() => setSubs([]))
      .finally(() => setLoading(false));
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  const name = (s: Submission) =>
    [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") || s.user?.email || "Unknown";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!q) return true;
      return name(s).toLowerCase().includes(q)
        || (s.user?.email || "").toLowerCase().includes(q)
        || (s.user?.schoolName || "").toLowerCase().includes(q)
        || (s.reference || "").toLowerCase().includes(q);
    });
  }, [subs, search, filter]);

  const decide = async (status: string) => {
    if (picked.size === 0) return;
    setBusy(true); setNotice("");
    try {
      const res = await api.post("/registration-decision", { ids: [...picked], status });
      setNotice(`${res.data.updated} registration${res.data.updated === 1 ? "" : "s"} updated.`);
      setPicked(new Set());
      load();
    } catch { setNotice("Could not apply that decision."); }
    finally { setBusy(false); }
  };

  const exportSheet = async () => {
    const XLSX = await import("xlsx");
    const keys = (form.fields || []).map((f) => f.key);
    const ws = XLSX.utils.json_to_sheet(shown.map((s) => ({
      reference: s.reference || "",
      name: name(s),
      email: s.user?.email || "",
      school: s.user?.schoolName || "",
      grade: s.user?.grade || "",
      status: SUB_STATUS[s.status]?.label || s.status,
      payment: s.paymentStatus,
      submitted: s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "",
      ...Object.fromEntries(keys.map((k) => [k, String(s.answers?.[k] ?? "")])),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registrations");
    XLSX.writeFile(wb, `${form.referencePrefix || "registrations"}.xlsx`);
  };

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <Card title={`Submissions (${subs.length})`}
      action={<Button size="sm" variant="secondary" onClick={exportSheet} disabled={shown.length === 0}>Export</Button>}
      padding={false}
    >
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, school or reference"
          className="flex-1 min-w-[14rem] border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
          <option value="all">Everything</option>
          {Object.entries(SUB_STATUS).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
      </div>

      {picked.size > 0 && (
        <div className="px-4 py-2.5 bg-primary-light/40 border-b border-border flex items-center gap-2 flex-wrap">
          <span className="text-sm text-ink font-medium">{picked.size} selected</span>
          <div className="flex gap-1.5 flex-wrap">
            {(["accepted", "waitlisted", "rejected", "under_review"] as const).map((s) => (
              <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => decide(s)}>
                {SUB_STATUS[s].label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {notice && <p className="px-4 py-2 text-sm text-emerald-700 bg-emerald-50 border-b border-emerald-200">{notice}</p>}

      {loading ? <Spinner text="Loading submissions..." /> : shown.length === 0 ? (
        <div className="py-14 text-center">
          <Users size={26} className="text-subtle mx-auto mb-3" />
          <p className="text-sm text-muted">
            {subs.length === 0 ? "Nobody has registered yet." : "Nothing matches that search."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border max-h-[32rem] overflow-y-auto">
          {shown.map((s) => {
            const meta = SUB_STATUS[s.status] || SUB_STATUS.submitted;
            return (
              <div key={s.id} className="px-4 py-3 flex items-start gap-3">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)}
                  className="mt-1 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-ink">{name(s)}</p>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${meta.cls}`}>{meta.label}</span>
                    {s.paymentStatus === "pending" && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        Payment due
                      </span>
                    )}
                    {s.importedFrom && (
                      <span className="text-xs text-muted">imported from {s.importedFrom}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {[s.user?.email, s.user?.schoolName, s.user?.grade && `Grade ${s.user.grade}`]
                      .filter(Boolean).join(" · ")}
                  </p>
                  {s.reference && <p className="text-xs font-mono text-subtle mt-0.5">{s.reference}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors relative flex items-center shrink-0 ${value ? "bg-primary" : "bg-border"}`}>
        <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`} />
      </div>
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}
