"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import Button from "@/components/ui/Button";

interface Participant {
  id: string; fullName: string | null; school: string | null; grade: string | null;
  status: string; paymentStatus: string; alreadyAdded: boolean; eligible: boolean;
}
const message = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  || "Could not load or add these registrations. Refresh the list and try again.";

export default function RegistrationCandidatesImport({ sessionId, onAdded }: { sessionId: string; onAdded: () => void }) {
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  const [formId, setFormId] = useState("");
  const [rows, setRows] = useState<Participant[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [grade, setGrade] = useState("");
  const [query, setQuery] = useState("");
  const [readingRows, setLoading] = useState(false);
  const [readingForms, setReadingForms] = useState(true);
  const loading = readingRows || readingForms;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setReadingForms(true); setError("");
    api.get("/registration-forms").then(res => { if (active) setForms(res.data.forms || []); })
      .catch(e => { if (active) setError(message(e)); })
      .finally(() => { if (active) setReadingForms(false); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    setRows([]); setSelected([]); setError("");
    if (!formId) { setLoading(false); return; }
    setLoading(true);
    api.post("/exam-registration-preview", { sessionId, formId }).then(res => {
      if (active) setRows(res.data.registrations || []);
    }).catch(e => { if (active) setError(message(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [formId, sessionId, revision]);

  const visible = rows.filter(r => (!status || r.status === status) && (!payment || r.paymentStatus === payment)
    && (!grade || r.grade === grade) && `${r.fullName || ""} ${r.school || ""}`.toLowerCase().includes(query.toLowerCase()));
  const eligible = visible.filter(r => r.eligible && !r.alreadyAdded);
  const filterChanged = () => { setSelected([]); setResult(""); };
  const add = async () => {
    setSaving(true); setError(""); setResult("");
    try {
      const res = await api.post("/add-registration-candidates", { sessionId, formId, registrationIds: selected });
      setResult(`${res.data.created} candidates added. ${res.data.skipped} already in this sitting were skipped. Credentials are available in the candidate list.`);
      setSelected([]);
      setRows(current => current.map(r => selected.includes(r.id) ? { ...r, alreadyAdded: true } : r));
      onAdded();
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  };
  const inputClass = "w-full border border-border rounded-lg px-3 py-2 text-sm min-h-11";
  return <div className="space-y-4">
    <p className="text-sm text-muted">Choose a registration list, review participants, then add them to this sitting. Email is not required.</p>
    <label className="block text-sm">Registration form
      <select className={inputClass} value={formId} disabled={saving} onChange={e => {
        setFormId(e.target.value); setStatus(""); setPayment(""); setGrade(""); setQuery(""); setResult("");
      }}>
        <option value="">Choose a registration form</option>
        {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
      </select>
    </label>
    {formId && <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm">Registration status<select className={inputClass} value={status} disabled={saving} onChange={e => { setStatus(e.target.value); filterChanged(); }}>
          <option value="">All statuses</option>
          {["submitted", "under_review", "accepted", "waitlisted", "draft", "rejected", "withdrawn"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select></label>
        <label className="text-sm">Payment<select className={inputClass} value={payment} disabled={saving} onChange={e => { setPayment(e.target.value); filterChanged(); }}>
          <option value="">All payments</option>
          {["paid", "pending", "not_required", "refunded"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select></label>
        <label className="text-sm">Grade<select className={inputClass} value={grade} disabled={saving} onChange={e => { setGrade(e.target.value); filterChanged(); }}>
          <option value="">All grades</option>
          {[...new Set(rows.map(r => r.grade).filter(Boolean))].map(g => <option key={g} value={g!}>{g}</option>)}
        </select></label>
      </div>
      <label className="block text-sm">Search by name or school<input className={inputClass} value={query} disabled={saving} onChange={e => { setQuery(e.target.value); filterChanged(); }} /></label>
      <p className="text-sm text-muted">Draft, rejected, withdrawn and unnamed registrations cannot be added. Changing filters clears your selection.</p>
      <label className="flex gap-2 items-center text-sm min-h-11">
        <input type="checkbox" disabled={saving || loading || !eligible.length || eligible.length > 1000}
          checked={eligible.length > 0 && eligible.every(r => selected.includes(r.id))}
          onChange={e => setSelected(e.target.checked ? eligible.map(r => r.id) : [])} />
        Select all eligible participants shown ({eligible.length})
      </label>
      {eligible.length > 1000 && <p className="text-sm">Use filters to select up to 1000 participants at a time.</p>}
      <div className="max-h-80 overflow-auto border border-border rounded-lg divide-y divide-border">
        {visible.map(r => <label key={r.id} className="flex gap-3 p-3 text-sm">
          <input type="checkbox" className="shrink-0" checked={selected.includes(r.id)}
            disabled={saving || loading || r.alreadyAdded || !r.eligible || (selected.length >= 1000 && !selected.includes(r.id))}
            onChange={e => setSelected(current => e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id))} />
          <span><span className="font-medium">{r.fullName || "Name missing"}</span>
            <span className="block text-muted">{[r.school, r.grade, r.status.replaceAll("_", " "), r.paymentStatus.replaceAll("_", " ")].filter(Boolean).join(" · ")}</span>
            {r.alreadyAdded && <span className="block text-emerald-700">Already in this sitting</span>}
            {!r.eligible && <span className="block text-amber-800">Not eligible: check name and registration status</span>}
          </span>
        </label>)}
        {!loading && !visible.length && <p className="p-3 text-sm">No registrations match this selection.</p>}
      </div>
    </>}
    {loading && <p className="text-sm">Reading registration lists...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {result && <p role="status" className="text-sm text-emerald-700">{result}</p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={saving || loading || !selected.length} onClick={add}>{saving ? "Adding candidates..." : `Add ${selected.length} selected candidates`}</Button>
      <Button variant="secondary" disabled={saving || loading} onClick={() => setRevision(r => r + 1)}>Refresh registrations</Button>
    </div>
  </div>;
}
