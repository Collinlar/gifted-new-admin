"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import type { FormField } from "@/lib/registrationFields";
import {
  CheckCircle2, XCircle, Clock, CreditCard, Copy, Check, Mail, Phone,
} from "lucide-react";

export interface Submission {
  id: string; reference?: string; status: string; paymentStatus: string;
  paymentReference?: string | null; paymentNote?: string | null;
  paidAt?: string | null; paidBy?: string | null;
  amount?: number | null;
  answers: Record<string, unknown>;
  formSnapshot?: FormField[] | null;
  submittedAt?: string; createdAt?: string; importedFrom?: string;
  decidedAt?: string | null; decidedBy?: string | null; decisionNote?: string | null;
  user?: {
    firstName?: string; lastName?: string; email?: string;
    mobileNumber?: string; schoolName?: string; grade?: string;
  } | null;
}

const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * What the student actually answered, preferring their submission over their
 * profile. The list previously showed profile fields, so a school typed into
 * the form looked like it had never been recorded.
 */
export function answerOf(s: Submission, key: string): string {
  const v = s.answers?.[key];
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return v === undefined || v === null ? "" : String(v);
}

export function displayName(s: Submission): string {
  const fromAnswers = [answerOf(s, "first_name"), answerOf(s, "last_name")].filter(Boolean).join(" ");
  if (fromAnswers) return fromAnswers;
  return [s.user?.firstName, s.user?.lastName].filter(Boolean).join(" ") || s.user?.email || "Unknown";
}

export function displaySchool(s: Submission): string {
  return answerOf(s, "school_name") || s.user?.schoolName || "";
}

export function displayGrade(s: Submission): string {
  return answerOf(s, "grade") || s.user?.grade || "";
}

const DECISIONS = [
  { v: "accepted",     label: "Accept",         Icon: CheckCircle2, tone: "text-emerald-700 border-emerald-200 hover:bg-emerald-50" },
  { v: "waitlisted",   label: "Waitlist",       Icon: Clock,        tone: "text-violet-700 border-violet-200 hover:bg-violet-50" },
  { v: "under_review", label: "Mark reviewing", Icon: Clock,        tone: "text-amber-700 border-amber-200 hover:bg-amber-50" },
  { v: "rejected",     label: "Not accepted",   Icon: XCircle,      tone: "text-danger border-red-200 hover:bg-red-50" },
];

interface Props {
  submission: Submission;
  fields: FormField[];
  registerLink: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function SubmissionPanel({ submission: s, fields, registerLink, onClose, onChanged }: Props) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [note, setNote]   = useState("");
  const [payRef, setPayRef] = useState(s.paymentReference || "");
  const [payNote, setPayNote] = useState(s.paymentNote || "");
  const [copied, setCopied] = useState(false);

  // Prefer the questions as they stood when this was submitted, so an answer is
  // never shown under a label that has since been reworded.
  const shownFields = (s.formSnapshot?.length ? s.formSnapshot : fields)
    .filter((f) => f.type !== "section" && f.type !== "info");

  const decide = async (status: string) => {
    setBusy(true); setError("");
    try {
      await api.post("/registration-decision", { ids: [s.id], status, note: note || null });
      onChanged();
      onClose();
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(m || "Could not apply that decision.");
    } finally { setBusy(false); }
  };

  const recordPayment = async (status: string) => {
    setBusy(true); setError("");
    try {
      await api.post("/record-payment", {
        registrationId: s.id, status, reference: payRef || null, note: payNote || null,
      });
      onChanged();
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(m || "Could not record that payment.");
    } finally { setBusy(false); }
  };

  return (
    <SlidePanel open onClose={onClose} title={displayName(s)} width="lg">
      <div className="space-y-5">

        {/* Who and where to reach them */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {s.user?.email && (
            <a href={`mailto:${s.user.email}`} className="flex items-center gap-1.5 text-primary hover:underline">
              <Mail size={13} /> {s.user.email}
            </a>
          )}
          {(answerOf(s, "mobile_number") || s.user?.mobileNumber) && (
            <a href={`tel:${answerOf(s, "mobile_number") || s.user?.mobileNumber}`}
              className="flex items-center gap-1.5 text-primary hover:underline">
              <Phone size={13} /> {answerOf(s, "mobile_number") || s.user?.mobileNumber}
            </a>
          )}
        </div>

        {s.reference && (
          <div className="bg-surface border border-border rounded-lg px-3 py-2">
            <p className="text-xs text-muted">Reference</p>
            <p className="font-mono text-sm font-semibold text-ink">{s.reference}</p>
          </div>
        )}

        {/* Every answer */}
        <div>
          <p className="text-sm font-semibold text-ink mb-2">What they submitted</p>
          <div className="border border-border rounded-xl divide-y divide-border">
            {shownFields.map((f) => {
              const v = answerOf(s, f.key);
              return (
                <div key={f.key} className="px-3 py-2.5">
                  <p className="text-xs text-muted">{f.label}</p>
                  <p className={`text-sm mt-0.5 ${v ? "text-ink" : "text-subtle italic"}`}>
                    {v || "Left blank"}
                  </p>
                </div>
              );
            })}
            {shownFields.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">This form has no questions.</p>
            )}
          </div>
        </div>

        {/* Timing */}
        <div className="border border-border rounded-xl divide-y divide-border text-sm">
          <Row label="Started"   value={fmt(s.createdAt)} />
          <Row label="Submitted" value={fmt(s.submittedAt)} />
          {s.decidedAt && <Row label="Decided" value={`${fmt(s.decidedAt)}${s.decidedBy ? ` by ${s.decidedBy}` : ""}`} />}
          {s.importedFrom && <Row label="Imported from" value={s.importedFrom} />}
        </div>

        {s.decisionNote && (
          <div className="bg-surface border border-border rounded-lg px-3 py-2">
            <p className="text-xs text-muted mb-0.5">Decision note</p>
            <p className="text-sm text-ink">{s.decisionNote}</p>
          </div>
        )}

        {/* Payment */}
        {s.paymentStatus !== "not_required" && (
          <div className="border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <CreditCard size={14} /> Payment
              </p>
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                s.paymentStatus === "paid"     ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : s.paymentStatus === "refunded" ? "bg-surface text-muted border-border"
                                               : "bg-amber-50 text-amber-700 border-amber-200"
              }`}>
                {s.paymentStatus === "paid" ? "Paid" : s.paymentStatus === "refunded" ? "Refunded" : "Due"}
              </span>
            </div>

            {s.amount != null && (
              <p className="text-sm text-muted">Amount due: {s.amount}</p>
            )}

            {s.paymentStatus === "paid" ? (
              <p className="text-xs text-muted">
                Recorded {fmt(s.paidAt)}{s.paidBy ? ` by ${s.paidBy}` : ""}
                {s.paymentReference ? ` · ${s.paymentReference}` : ""}
                {s.paymentNote ? ` · ${s.paymentNote}` : ""}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Most fees arrive by mobile money rather than card, so record it here once it lands.
                  The student can also pay in the app from My Registrations.
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Input label="Reference" value={payRef} onChange={(e) => setPayRef(e.target.value)}
                    placeholder="MoMo transaction id" />
                  <Input label="Note" value={payNote} onChange={(e) => setPayNote(e.target.value)}
                    placeholder="Paid at the centre" />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" disabled={busy} onClick={() => recordPayment("paid")}>
                    Mark as paid
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy}
                    onClick={() => {
                      navigator.clipboard.writeText(registerLink);
                      setCopied(true); setTimeout(() => setCopied(false), 1800);
                    }}>
                    {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy the link to send them</>}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Decision */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-semibold text-ink">Decision</p>
          <Input label="Note (optional, kept on the record)" value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="Why, in a few words" />
          <div className="grid grid-cols-2 gap-2">
            {DECISIONS.map(({ v, label, Icon, tone }) => (
              <button key={v} disabled={busy || s.status === v} onClick={() => decide(v)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 ${tone}`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            The student sees this on their My Registrations page as soon as you decide.
          </p>
        </div>
      </div>
    </SlidePanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-xs text-ink text-right">{value}</span>
    </div>
  );
}
