"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import ImageField from "@/components/ui/ImageField";
import ImportPanel from "@/components/registrations/ImportPanel";
import SubmissionPanel, { type Submission, displayName, displaySchool, displayGrade, answerOf }
  from "@/components/registrations/SubmissionPanel";
import api from "@/lib/api";
import {
  STANDARD_FIELDS, FIELD_GROUPS, TYPE_LABELS, GRADES,
  fieldFromStandard, prefillableCount, uid,
  type FormField, type FieldType,
} from "@/lib/registrationFields";
import {
  Plus, ArrowLeft, Trash2, ClipboardList, Save, Copy, ChevronUp, ChevronDown,
  Users, Eye, Link2, Check, Settings, UploadCloud, BarChart3, TrendingDown, Repeat, ChevronRight,
} from "lucide-react";

interface RegForm {
  id: string; title: string; description?: string;
  programType: string; programId?: string | null; programTitle?: string | null;
  fields: FormField[];
  opensAt?: string | null; closesAt?: string | null;
  capacity?: number | null; waitlistWhenFull: boolean;
  requiresPayment: boolean; feeAmount?: number | null; feeCurrency: string;
  status: "draft" | "open" | "closed";
  slug?: string | null;
  coverImageUrl?: string | null;
  accentColor?: string; introHeading?: string | null;
  confirmationMessage?: string | null; referencePrefix?: string | null;
  targetGrades?: string[];
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

  const remove = async (f: RegForm) => {
    const n = f.counts?.total || 0;
    if (n > 0) {
      setError(`"${f.title}" has ${n} registration${n === 1 ? "" : "s"} against it. Close it instead of deleting, so the entries are not lost.`);
      return;
    }
    if (!confirm(`Delete "${f.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/delete-registration-form/${f.id}`);
      load();
    } catch (e) { setError(serverMessage(e, "Could not delete that form.")); }
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
                        <button onClick={() => remove(f)}
                          title={(f.counts?.total || 0) > 0 ? "Has registrations, close it instead" : "Delete"}
                          className="p-1.5 rounded-lg text-subtle hover:text-danger hover:bg-red-50">
                          <Trash2 size={13} />
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
  const [tab, setTab] = useState<"questions" | "preview" | "settings" | "submissions" | "insights">("questions");
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

          <ShareLink form={form} />

          <div className="flex items-center gap-1 border-b border-border">
            {([["questions", "Questions", ClipboardList],
               ["preview", "Preview", Eye],
               ["settings", "Settings", Settings],
               ["submissions", "Submissions", Users],
               ["insights", "Insights", BarChart3]] as const).map(([v, label, Icon]) => (
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
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
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

          {tab === "preview" && <PreviewTab form={form} />}
          {tab === "settings" && <SettingsTab form={form} set={set} />}
          {tab === "submissions" && <SubmissionsTab formId={formId} form={form} />}
          {tab === "insights" && <InsightsTab formId={formId} />}
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

// ── The link you hand out ──────────────────────────────────────────────────
//
// A registration link goes into a WhatsApp broadcast or gets read down a phone,
// so it is built from the form's slug rather than its uuid.

function ShareLink({ form }: { form: RegForm }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setSiteUrl(localStorage.getItem("giftedSiteUrl") || ""); }, []);

  const link = `${siteUrl.replace(/\/$/, "") || "https://your-site"}/register/${form.slug || form.id}`;

  return (
    <Card title="The link you send out">
      <div className="space-y-3">
        {form.status !== "open" && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This form is {form.status === "draft" ? "still a draft" : "closed"}, so anyone opening
            the link is told so rather than seeing the questions. Set it to Open when you are ready.
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Link2 size={14} className="text-muted shrink-0" />
          <code className="text-sm font-mono bg-surface border border-border rounded px-2 py-1.5 flex-1 min-w-0 truncate">
            {link}
          </code>
          <Button size="sm" variant="secondary" onClick={() => {
            navigator.clipboard.writeText(link);
            setCopied(true); setTimeout(() => setCopied(false), 1800);
          }}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label="Your student site address" placeholder="https://giftededu.tech"
              value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
          </div>
          <Button size="sm" variant="secondary"
            onClick={() => localStorage.setItem("giftedSiteUrl", siteUrl)}>
            Save address
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Preview ────────────────────────────────────────────────────────────────
//
// Rendered from the same field definitions the student page uses, with sample
// answers standing in for the prefill, so the length and the fit are real.

const SAMPLE: Record<string, string> = {
  first_name: "Ama", last_name: "Mensah", email: "ama.mensah@school.edu.gh",
  mobile_number: "+233 20 000 0000", school_name: "Achimota School", grade: "SHS 2",
  parent_phone: "+233 24 111 2222", region: "Greater Accra", t_shirt_size: "M",
};

function PreviewTab({ form }: { form: RegForm }) {
  const accent = form.accentColor || "#003366";
  const fields = form.fields || [];
  const auto = fields.filter((f) => f.source || f.remember).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        How this looks to a student. Answers shown in green are ones they never have to type.
      </p>

      <div className="bg-[#F0F4F8] rounded-2xl p-5 sm:p-8">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {form.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.coverImageUrl} alt="" className="w-full h-40 object-cover" />
          )}
          <div className="h-1.5" style={{ backgroundColor: accent }} />

          <div className="px-6 pt-6 pb-5 border-b border-gray-100">
            {form.programTitle && (
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: accent }}>{form.programTitle}</p>
            )}
            <h1 className="text-2xl font-bold text-[#003366] leading-tight">
              {form.introHeading || form.title}
            </h1>
            {form.description && (
              <p className="text-[15px] leading-relaxed mt-3 whitespace-pre-line text-gray-700">{form.description}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-4 text-xs text-[#336699]">
              {form.closesAt && <span>Closes {new Date(form.closesAt).toLocaleDateString()}</span>}
              {form.requiresPayment && <span>{form.feeCurrency} {form.feeAmount}</span>}
            </div>
          </div>

          {auto > 0 && (
            <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100">
              <p className="text-sm text-emerald-800">
                We have filled in {auto} answer{auto === 1 ? "" : "s"} from what you have already
                told us. Check they are right and change anything that has moved on.
              </p>
            </div>
          )}

          <div className="px-6 py-6 grid sm:grid-cols-2 gap-x-4 gap-y-5">
            {fields.map((f) => {
              if (f.type === "section") {
                return (
                  <div key={f.id} className="sm:col-span-2 pt-2">
                    <h2 className="text-sm font-bold uppercase tracking-wide text-[#003366]">{f.label}</h2>
                    <div className="h-px bg-gray-100 mt-2" />
                  </div>
                );
              }
              if (f.type === "info") {
                return <p key={f.id} className="sm:col-span-2 text-sm text-gray-600 leading-relaxed">{f.label}</p>;
              }

              const filled = SAMPLE[f.key] || (f.source ? "From their profile" : "");
              const why = f.source ? "From your profile" : f.remember ? "You told us this before" : null;

              return (
                <div key={f.id} className={f.half ? "" : "sm:col-span-2"}>
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <label className="text-sm font-medium text-[#003366]">
                      {f.label}{f.required && <span className="text-red-500"> *</span>}
                    </label>
                    {why && <span className="text-[11px] text-emerald-600 shrink-0">{why}</span>}
                  </div>
                  {f.type === "checkbox" ? (
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 w-4 h-4 rounded border border-gray-300 shrink-0" />
                      <span className="text-sm text-gray-700">{f.label}</span>
                    </div>
                  ) : f.type === "textarea" ? (
                    <div className="w-full border border-[#D8E1EA] rounded-xl px-3.5 py-3 text-[15px] text-gray-400 h-20">
                      {f.placeholder || ""}
                    </div>
                  ) : f.type === "multiselect" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(f.options || ["Option"]).slice(0, 4).map((o) => (
                        <span key={o} className="px-3 py-1.5 rounded-lg text-sm border border-[#D8E1EA] text-[#336699]">{o}</span>
                      ))}
                    </div>
                  ) : (
                    <div className={`w-full border border-[#D8E1EA] rounded-xl px-3.5 py-3 text-[15px] ${filled ? "text-gray-900" : "text-gray-400"}`}>
                      {filled || f.placeholder || (f.type === "select" ? "Choose one..." : "")}
                    </div>
                  )}
                  {f.help && <p className="text-xs mt-1.5 text-[#336699]">{f.help}</p>}
                </div>
              );
            })}
          </div>

          <div className="px-6 pb-6">
            <span className="inline-block px-7 py-3 rounded-xl text-white font-semibold"
              style={{ backgroundColor: accent }}>
              Complete registration
            </span>
          </div>
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

          <div className="space-y-1 pt-3 border-t border-border">
            <label className="text-sm font-medium text-ink">Link address</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted font-mono shrink-0">/register/</span>
              <input value={form.slug || ""}
                onChange={(e) => set({ slug: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })}
                placeholder="KMAC26"
                className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary" />
            </div>
            <p className="text-xs text-muted pt-1">
              This is what people type or tap. Keep it short enough to read down a phone. Changing
              it breaks any link already shared.
            </p>
          </div>
        </div>
      </Card>

      <Card title="How it looks">
        <div className="space-y-4">
          <ImageField label="Cover image" value={form.coverImageUrl || ""}
            onChange={(url) => set({ coverImageUrl: url })} />

          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Heading" value={form.introHeading || ""}
              onChange={(e) => set({ introHeading: e.target.value })}
              placeholder="Leave blank to use the title" />
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">Accent colour</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.accentColor || "#003366"}
                  onChange={(e) => set({ accentColor: e.target.value })}
                  className="h-[42px] w-14 border border-border rounded-lg px-1 cursor-pointer" />
                <input value={form.accentColor || "#003366"}
                  onChange={(e) => set({ accentColor: e.target.value })}
                  className="flex-1 border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary" />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted">
            The accent runs along the top of the form and colours the submit button, so each
            programme reads as its own thing. Check the Preview tab.
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

          <div className="space-y-2 pt-3 border-t border-border">
            <label className="text-sm font-medium text-ink">
              Show on the dashboard to
              <span className="font-normal text-muted text-xs"> (leave empty for every grade)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {GRADES.map((g) => {
                const on = (form.targetGrades || []).includes(g);
                return (
                  <button key={g} type="button"
                    onClick={() => set({
                      targetGrades: on
                        ? (form.targetGrades || []).filter((x) => x !== g)
                        : [...(form.targetGrades || []), g],
                    })}
                    className={`px-2.5 py-1 rounded text-xs border font-medium transition-colors ${
                      on ? "bg-primary text-white border-primary"
                         : "border-border text-muted hover:border-primary hover:text-primary"
                    }`}>
                    {g}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">
              This only controls whose dashboard shows the programme. The link still works for
              anyone you send it to, so a student in another grade can still be invited directly.
            </p>
          </div>
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

// Submission and its display helpers live with the panel that renders them.

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
  const [importing, setImporting] = useState(false);
  const [openSub, setOpenSub] = useState<Submission | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/registration-submissions/${formId}`)
      .then((r) => setSubs(r.data.submissions || []))
      .catch(() => setSubs([]))
      .finally(() => setLoading(false));
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  // Read what they submitted, falling back to their profile. Showing the
  // profile first made a school typed into the form look unrecorded.
  const name = displayName;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!q) return true;
      return name(s).toLowerCase().includes(q)
        || (s.user?.email || "").toLowerCase().includes(q)
        || displaySchool(s).toLowerCase().includes(q)
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
      school: displaySchool(s),
      grade: displayGrade(s),
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
      action={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
            <UploadCloud size={13} /> Import
          </Button>
          <Button size="sm" variant="secondary" onClick={exportSheet} disabled={shown.length === 0}>Export</Button>
        </div>
      }
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
                <button onClick={() => setOpenSub(s)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-ink hover:text-primary">{name(s)}</p>
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
                    {[s.user?.email, displaySchool(s), displayGrade(s)]
                      .filter(Boolean).join(" · ")}
                  </p>
                  {s.reference && <p className="text-xs font-mono text-subtle mt-0.5">{s.reference}</p>}
                </button>
                <ChevronRight size={15} className="text-subtle shrink-0 mt-1" />
              </div>
            );
          })}
        </div>
      )}

      {importing && (
        <ImportPanel formId={formId} fields={form.fields || []}
          onClose={() => setImporting(false)} onImported={load} />
      )}

      {openSub && (
        <SubmissionPanel
          submission={subs.find((x) => x.id === openSub.id) || openSub}
          fields={form.fields || []}
          registerLink={`${(typeof window !== "undefined" && localStorage.getItem("giftedSiteUrl")) || ""}/register/${form.slug || form.id}`}
          onClose={() => setOpenSub(null)}
          onChanged={load}
        />
      )}
    </Card>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────

interface Analytics {
  capacity: number | null;
  funnel: Record<string, number>;
  dropOff: { key: string; label: string; blank: number; rate: number }[];
  schools: { label: string; n: number }[];
  grades:  { label: string; n: number }[];
  repeat: { returning: number; total: number };
}

function InsightsTab({ formId }: { formId: string }) {
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/registration-analytics/${formId}`)
      .then((r) => setA(r.data))
      .catch(() => setA(null))
      .finally(() => setLoading(false));
  }, [formId]);

  if (loading) return <Card><Spinner text="Working out the numbers..." /></Card>;
  if (!a) return <Card><p className="text-sm text-muted py-8 text-center">Could not load insights.</p></Card>;

  const f = a.funnel;
  const completion = f.started ? Math.round((f.submitted / f.started) * 100) : 0;
  const abandoned = f.started - f.submitted;

  if (f.started === 0) {
    return (
      <Card>
        <div className="py-12 text-center">
          <BarChart3 size={26} className="text-subtle mx-auto mb-3" />
          <p className="text-sm text-muted">Nothing to show until people start registering.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="From opened to accepted">
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Opened the form" value={f.started} />
            <Stat label="Submitted" value={f.submitted} tone="blue" />
            <Stat label="Accepted" value={f.accepted} tone="green" />
            <Stat label="Waitlisted" value={f.waitlisted} tone="amber" />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm text-ink">{completion}% of people who started, finished</span>
              {abandoned > 0 && <span className="text-xs text-amber-700">{abandoned} left part way</span>}
            </div>
            <div className="h-2 rounded-full bg-surface overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} />
            </div>
          </div>

          {(f.paymentDue > 0 || f.paid > 0) && (
            <p className="text-sm text-muted pt-2 border-t border-border">
              {f.paid} paid, {f.paymentDue} still owing.
            </p>
          )}
          {a.capacity != null && (
            <p className="text-sm text-muted">{f.submitted} of {a.capacity} places taken.</p>
          )}
        </div>
      </Card>

      {abandoned > 0 && a.dropOff.some((d) => d.blank > 0) && (
        <Card title="Where people stop">
          <p className="text-xs text-muted mb-3 flex items-start gap-1.5">
            <TrendingDown size={13} className="shrink-0 mt-0.5" />
            Blank answers among the {abandoned} unfinished registrations. The question at the top is
            the most likely reason someone gave up, and the first thing worth cutting or simplifying.
          </p>
          <div className="space-y-2">
            {a.dropOff.filter((d) => d.blank > 0).slice(0, 8).map((d) => (
              <div key={d.key}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-sm text-ink truncate">{d.label}</span>
                  <span className="text-xs text-muted shrink-0">{d.blank} left blank</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${d.rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Card title="Schools">
          {a.schools.length === 0
            ? <p className="text-sm text-muted py-4 text-center">No school data yet.</p>
            : <Bars rows={a.schools} />}
        </Card>
        <Card title="Grades">
          {a.grades.length === 0
            ? <p className="text-sm text-muted py-4 text-center">No grade data yet.</p>
            : <Bars rows={a.grades} />}
        </Card>
      </div>

      <Card title="Coming back">
        <div className="flex items-start gap-3">
          <Repeat size={16} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-ink">
              <strong>{a.repeat.returning}</strong> of {a.repeat.total} people registering here have
              entered another Gifted programme too.
            </p>
            <p className="text-xs text-muted mt-1">
              Repeat participation is the clearest signal a programme is working, and it was
              unrecoverable while every intake lived in its own spreadsheet.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-sm text-ink truncate" title={r.label}>{r.label}</span>
            <span className="text-xs text-muted shrink-0">{r.n}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.n / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: string }) {
  const tones: Record<string, string> = {
    plain: "text-ink", blue: "text-blue-600", green: "text-emerald-600", amber: "text-amber-600",
  };
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2.5">
      <p className={`text-xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-muted mt-0.5">{label}</p>
    </div>
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
