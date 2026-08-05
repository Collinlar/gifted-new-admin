"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import * as XLSX from "xlsx";
import {
  Plus, ArrowLeft, Users, Clock, ShieldAlert, Copy, Check, Download,
  Printer, Trash2, MoreHorizontal, RefreshCw, Play, Square, Link2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Session {
  id: string; examId: string; title: string; sessionCode: string;
  startsAt?: string; endsAt?: string; durationMinutes: number;
  status: "scheduled" | "live" | "closed";
  showResultsToCandidate: boolean; shuffleQuestions: boolean;
  lockToDevice: boolean; maxTabSwitches: number;
  counts?: Record<string, number>;
}

interface Candidate {
  id: string; fullName: string; school?: string; grade?: string;
  accessCode: string; passwordPlain: string;
  status: "pending" | "in_progress" | "submitted" | "disqualified";
  startedAt?: string; expiresAt?: string; submittedAt?: string;
  score?: number; totalQuestions?: number; tabSwitches: number;
  lastSeenAt?: string; answers?: Record<string, string>;
}

interface ExamOption { id: string; title: string; numberOfQuestions?: number }

// Surface what the server actually said. A generic "try again" hides real
// faults (a missing migration, a bad column) behind a message that invites
// the user to repeat something that will never work.
function serverMessage(e: unknown, fallback: string) {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return msg || fallback;
}

const STATUS_META: Record<Candidate["status"], { label: string; cls: string }> = {
  pending:      { label: "Not started", cls: "bg-surface text-muted border-border" },
  in_progress:  { label: "Writing",     cls: "bg-blue-50 text-blue-700 border-blue-200" },
  submitted:    { label: "Submitted",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disqualified: { label: "Stopped",     cls: "bg-red-50 text-danger border-red-200" },
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function ExamModePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [exams, setExams]       = useState<ExamOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const [openId, setOpenId]     = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get("/exam-sessions");
      setSessions(res.data.sessions || []);
    } catch { setSessions([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadSessions();
    api.get("/announcement-content-options")
      .then((r) => setExams(r.data.exams || []))
      .catch(() => {});
  }, [loadSessions]);

  if (openId) {
    return <SessionDetail sessionId={openId} onBack={() => { setOpenId(null); loadSessions(); }} />;
  }

  return (
    <AuthGuard>
      <DashboardShell title="Exam Mode">
        <div className="space-y-4 max-w-5xl">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Run a supervised sitting. Generate credentials, hand out one link, watch it live.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New sitting
            </Button>
          </div>

          <Card padding={false}>
            {loading ? (
              <Spinner text="Loading your exam sittings..." />
            ) : sessions.length === 0 ? (
              <div className="py-16 text-center">
                <Users size={30} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No sittings scheduled yet.</p>
                <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus size={14} /> Set up your first sitting
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {sessions.map((s) => {
                  const c = s.counts || {};
                  return (
                    <button key={s.id} onClick={() => setOpenId(s.id)}
                      className="w-full text-left px-5 py-4 hover:bg-surface/50 transition-colors flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-medium text-ink text-sm">{s.title}</p>
                          <code className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-muted">
                            {s.sessionCode}
                          </code>
                          <StatusChip status={s.status} />
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted">
                          <span>{c.total || 0} candidates</span>
                          {(c.in_progress || 0) > 0 && <span className="text-blue-600 font-medium">{c.in_progress} writing now</span>}
                          {(c.submitted || 0) > 0 && <span className="text-emerald-600">{c.submitted} submitted</span>}
                          {(c.disqualified || 0) > 0 && <span className="text-danger">{c.disqualified} stopped</span>}
                          <span>{s.durationMinutes} min</span>
                        </div>
                      </div>
                      <MoreHorizontal size={16} className="text-subtle shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <CreateSessionPanel
          open={createOpen} exams={exams}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); loadSessions(); setOpenId(id); }}
        />
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Create sitting ─────────────────────────────────────────────────────────

function CreateSessionPanel({ open, exams, onClose, onCreated }: {
  open: boolean; exams: ExamOption[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [examId, setExamId]     = useState("");
  const [title, setTitle]       = useState("");
  const [code, setCode]         = useState("");
  const [duration, setDuration] = useState("60");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt]     = useState("");
  const [showResults, setShowResults] = useState(false);
  const [shuffle, setShuffle]   = useState(true);
  const [lockDevice, setLockDevice] = useState(true);
  const [maxTabs, setMaxTabs]   = useState("3");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  const save = async () => {
    setError("");
    if (!examId) return setError("Choose which assessment this sitting uses.");
    if (!title.trim()) return setError("Give this sitting a name.");
    setSaving(true);
    try {
      const res = await api.post("/create-exam-session", {
        examId, title, sessionCode: code || title,
        durationMinutes: Number(duration) || 60,
        startsAt: startsAt || null, endsAt: endsAt || null,
        showResultsToCandidate: showResults, shuffleQuestions: shuffle,
        lockToDevice: lockDevice, maxTabSwitches: Number(maxTabs) || 0,
      });
      onCreated(res.data.session.id);
    } catch (e) {
      setError(serverMessage(e, "Could not create the sitting. Try again."));
    } finally { setSaving(false); }
  };

  return (
    <SlidePanel open={open} onClose={onClose} title="New exam sitting" width="lg">
      <div className="space-y-5">
        <div className="space-y-1">
          <label className="text-sm font-medium text-ink">Assessment</label>
          <select value={examId} onChange={(e) => {
            setExamId(e.target.value);
            if (!title) setTitle(exams.find((x) => x.id === e.target.value)?.title || "");
          }}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
            <option value="">Choose an assessment...</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}{x.numberOfQuestions ? ` (${x.numberOfQuestions} questions)` : ""}
              </option>
            ))}
          </select>
        </div>

        <Input label="Sitting name" placeholder="e.g. GH STEM Olympiad, Round 1" value={title} onChange={(e) => setTitle(e.target.value)} />

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink">Session code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="Leave blank to build one from the name"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
          <p className="text-xs text-muted pt-1">This goes in the link you send out. Letters, numbers and dashes.</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Input label="Duration (min)" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Opens</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">Closes</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-ink">Invigilation</p>
          <Toggle label="Lock each candidate to the device they start on" value={lockDevice} onChange={setLockDevice} />
          <Toggle label="Shuffle the question order per candidate" value={shuffle} onChange={setShuffle} />
          <Toggle label="Show candidates their score after submitting" value={showResults} onChange={setShowResults} />
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Input label="Tab switches before stopping an attempt" type="number" value={maxTabs}
              onChange={(e) => setMaxTabs(e.target.value)} />
          </div>
          <p className="text-xs text-muted">Set tab switches to 0 to record them without ever stopping anyone.</p>
        </div>

        {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2 border-t border-border">
          <Button onClick={save} disabled={saving}>{saving ? "Setting up the sitting..." : "Create sitting"}</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </SlidePanel>
  );
}

// ── Detail: roster, credentials, live board ────────────────────────────────

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession]       = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [addOpen, setAddOpen]       = useState(false);
  const [live, setLive]             = useState(true);
  const [copied, setCopied]         = useState(false);
  const [siteUrl, setSiteUrl]       = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setSiteUrl(localStorage.getItem("giftedSiteUrl") || "");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/exam-session/${sessionId}`);
      setSession(res.data.session);
      setCandidates(res.data.candidates || []);
    } catch { /* keep last known state */ }
    finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // Poll while a sitting is being watched
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [live, load]);

  const examLink = useMemo(() => {
    if (!session) return "";
    const base = siteUrl.replace(/\/$/, "") || "https://your-site";
    return `${base}/exam/${session.sessionCode}`;
  }, [session, siteUrl]);

  const stats = useMemo(() => ({
    total:    candidates.length,
    writing:  candidates.filter((c) => c.status === "in_progress").length,
    done:     candidates.filter((c) => c.status === "submitted").length,
    stopped:  candidates.filter((c) => c.status === "disqualified").length,
    flagged:  candidates.filter((c) => c.tabSwitches > 0 && c.status !== "submitted").length,
  }), [candidates]);

  const act = async (candidateId: string, action: string, minutes = 0) => {
    setActionError("");
    try {
      await api.post("/candidate-action", { candidateId, action, minutes });
    } catch (e) {
      setActionError(serverMessage(e, "That control did not go through. Try again."));
    }
    load();
  };

  const setStatus = async (status: Session["status"]) => {
    setActionError("");
    try {
      await api.put(`/update-exam-session/${sessionId}`, { status });
    } catch (e) {
      setActionError(serverMessage(e, "Could not change the exam status. Try again."));
    }
    load();
  };

  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(candidates.map((c) => ({
      name: c.fullName, school: c.school || "", grade: c.grade || "",
      access_code: c.accessCode, password: c.passwordPlain,
      status: STATUS_META[c.status].label,
      score: c.score ?? "", out_of: c.totalQuestions ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Candidates");
    XLSX.writeFile(wb, `${session?.sessionCode || "exam"}-candidates.xlsx`);
  };

  const printSlips = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const slips = candidates.map((c) => `
      <div class="slip">
        <div class="exam">${escapeHtml(session?.title || "")}</div>
        <div class="name">${escapeHtml(c.fullName)}</div>
        ${c.school ? `<div class="meta">${escapeHtml(c.school)}</div>` : ""}
        <table>
          <tr><td>Link</td><td class="mono">${escapeHtml(examLink)}</td></tr>
          <tr><td>Access code</td><td class="mono big">${escapeHtml(c.accessCode)}</td></tr>
          <tr><td>Password</td><td class="mono big">${escapeHtml(c.passwordPlain)}</td></tr>
        </table>
      </div>`).join("");

    w.document.write(`<!doctype html><html><head><title>${escapeHtml(session?.title || "Exam")} credentials</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:12px;}
        .slip{border:1px solid #999;border-radius:6px;padding:12px 14px;margin:0 0 10px;page-break-inside:avoid;}
        .exam{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#555;}
        .name{font-size:17px;font-weight:600;margin:3px 0;}
        .meta{font-size:12px;color:#666;margin-bottom:6px;}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;}
        td{padding:3px 0;vertical-align:top;}
        td:first-child{color:#666;width:100px;}
        .mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
        .big{font-size:16px;font-weight:700;letter-spacing:.08em;}
        @media print{body{padding:0;} .slip{margin-bottom:8px;}}
      </style></head><body>${slips}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  if (loading) {
    return (
      <AuthGuard><DashboardShell title="Exam Mode"><Spinner text="Loading this sitting..." /></DashboardShell></AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <DashboardShell title={session?.title || "Exam sitting"}>
        <div className="space-y-5 max-w-6xl pb-16">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> All sittings</Button>
            <div className="flex items-center gap-2">
              {session?.status !== "live" && (
                <Button size="sm" onClick={() => setStatus("live")}><Play size={13} /> Open the exam</Button>
              )}
              {session?.status === "live" && (
                <Button variant="secondary" size="sm" onClick={() => setStatus("closed")}>
                  <Square size={13} /> Close the exam
                </Button>
              )}
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{actionError}</p>
          )}

          {/* The link to hand out */}
          <Card title="The link you send out">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Link2 size={14} className="text-muted shrink-0" />
                <code className="text-sm font-mono bg-surface border border-border rounded px-2 py-1.5 flex-1 min-w-0 truncate">
                  {examLink}
                </code>
                <Button size="sm" variant="secondary" onClick={() => {
                  navigator.clipboard.writeText(examLink);
                  setCopied(true); setTimeout(() => setCopied(false), 1800);
                }}>
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="Your student site address" placeholder="https://gifted.example.com"
                    value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
                </div>
                <Button size="sm" variant="secondary"
                  onClick={() => localStorage.setItem("giftedSiteUrl", siteUrl)}>
                  Save address
                </Button>
              </div>
              <p className="text-xs text-muted">
                Everyone in this sitting uses the same link. Their own access code and password is what signs them in.
              </p>
            </div>
          </Card>

          {/* Live board */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Candidates" value={stats.total} />
            <Stat label="Writing now" value={stats.writing} tone="blue" />
            <Stat label="Submitted" value={stats.done} tone="green" />
            <Stat label="Flagged" value={stats.flagged} tone="amber" />
            <Stat label="Stopped" value={stats.stopped} tone="red" />
          </div>

          <Card
            title={`Candidates (${candidates.length})`}
            action={
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                  <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
                  Auto refresh
                </label>
                <Button size="sm" variant="ghost" onClick={load}><RefreshCw size={13} /></Button>
                <Button size="sm" variant="secondary" onClick={exportCsv}><Download size={13} /> Export</Button>
                <Button size="sm" variant="secondary" onClick={printSlips}><Printer size={13} /> Print slips</Button>
                <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={13} /> Add candidates</Button>
              </div>
            }
            padding={false}
          >
            {candidates.length === 0 ? (
              <div className="py-14 text-center">
                <Users size={28} className="text-subtle mx-auto mb-3" />
                <p className="text-muted text-sm">No candidates yet.</p>
                <Button size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
                  <Plus size={13} /> Generate credentials
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface/50">
                      {["Candidate", "Access code", "Password", "Status", "Time left", "Flags", "Score", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-muted font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <CandidateRow key={c.id} c={c} session={session} onAction={act} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <AddCandidatesPanel
          open={addOpen} sessionId={sessionId}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); load(); }}
        />
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Candidate row ──────────────────────────────────────────────────────────

function CandidateRow({ c, session, onAction }: {
  c: Candidate; session: Session | null; onAction: (id: string, action: string, mins?: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const meta = STATUS_META[c.status];
  const maxTabs = session?.maxTabSwitches ?? 0;

  const timeLeft = useMemo(() => {
    if (c.status !== "in_progress" || !c.expiresAt) return null;
    const ms = new Date(c.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "Time up";
    const m = Math.floor(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }, [c.status, c.expiresAt]);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface/40">
      <td className="px-4 py-2.5">
        <p className="font-medium text-ink">{c.fullName}</p>
        {(c.school || c.grade) && (
          <p className="text-xs text-muted">{[c.school, c.grade && `Grade ${c.grade}`].filter(Boolean).join(" · ")}</p>
        )}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">{c.accessCode}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-muted">{c.passwordPlain}</td>
      <td className="px-4 py-2.5">
        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${meta.cls}`}>{meta.label}</span>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
        {timeLeft ? <span className="flex items-center gap-1"><Clock size={11} /> {timeLeft}</span> : "—"}
      </td>
      <td className="px-4 py-2.5">
        {c.tabSwitches > 0 ? (
          <span className={`flex items-center gap-1 text-xs font-medium ${
            maxTabs > 0 && c.tabSwitches > maxTabs ? "text-danger" : "text-amber-600"
          }`}>
            <ShieldAlert size={11} /> {c.tabSwitches} tab {c.tabSwitches === 1 ? "switch" : "switches"}
          </span>
        ) : <span className="text-xs text-subtle">Clean</span>}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {c.score != null ? (
          <span className="font-semibold text-ink">{c.score}/{c.totalQuestions}</span>
        ) : <span className="text-subtle">—</span>}
      </td>
      <td className="px-4 py-2.5 relative">
        <button onClick={() => setMenu((v) => !v)} className="p-1 rounded hover:bg-surface text-subtle hover:text-ink">
          <MoreHorizontal size={15} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-4 top-9 z-20 w-52 bg-card border border-border rounded-xl shadow-lg py-1 text-sm">
              {[
                ["release",    "Release the device lock"],
                ["extend",     "Give 10 more minutes"],
                ["reinstate",  "Let them back in"],
                ["disqualify", "Stop this attempt"],
                ["reset",      "Reset to a clean start"],
              ].map(([action, label]) => (
                <button key={action}
                  onClick={() => { setMenu(false); onAction(c.id, action, action === "extend" ? 10 : 0); }}
                  className={`w-full text-left px-3 py-2 hover:bg-surface transition-colors ${
                    action === "disqualify" || action === "reset" ? "text-danger" : "text-ink"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

// ── Add candidates ─────────────────────────────────────────────────────────

function AddCandidatesPanel({ open, sessionId, onClose, onAdded }: {
  open: boolean; sessionId: string; onClose: () => void; onAdded: () => void;
}) {
  const [mode, setMode]   = useState<"paste" | "file" | "count">("paste");
  const [text, setText]   = useState("");
  const [count, setCount] = useState("30");
  const [prefix, setPrefix] = useState("Candidate");
  const [people, setPeople] = useState<{ full_name: string; school?: string; grade?: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const buildFromText = () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    // Accept "Name", "Name, School" or "Name, School, Grade"
    return lines.map((l) => {
      const [full_name, school, grade] = l.split(",").map((p) => p.trim());
      return { full_name, school: school || undefined, grade: grade || undefined };
    });
  };

  const handleFile = async (file: File) => {
    setError("");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = raw.map((r) => {
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) row[k.toLowerCase().replace(/[\s-]+/g, "_")] = v;
        return {
          full_name: String(row.full_name || row.name || "").trim(),
          school: String(row.school || "").trim() || undefined,
          grade: String(row.grade || "").trim() || undefined,
        };
      }).filter((p) => p.full_name);
      if (parsed.length === 0) {
        setError("We could not find a name column. Use a column headed name or full_name.");
        return;
      }
      setPeople(parsed);
    } catch {
      setError("We could not read that file. Save it as .xlsx or .csv and try again.");
    }
  };

  const preview: { full_name: string; school?: string; grade?: string }[] =
      mode === "paste" ? buildFromText().filter((p) => p.full_name)
    : mode === "file"  ? (people || [])
    : Array.from({ length: Math.min(Number(count) || 0, 1000) }, (_, i) => ({
        full_name: `${prefix} ${String(i + 1).padStart(3, "0")}`,
      }));

  const save = async () => {
    setError("");
    if (preview.length === 0) return setError("Add at least one candidate first.");
    setSaving(true);
    try {
      await api.post("/generate-candidates", { sessionId, people: preview });
      setText(""); setPeople(null);
      onAdded();
    } catch (e) {
      setError(serverMessage(e, "Could not generate the credentials. Try again."));
    } finally { setSaving(false); }
  };

  return (
    <SlidePanel open={open} onClose={onClose} title="Add candidates" width="lg">
      <div className="space-y-5">
        <div className="flex gap-2">
          {([["paste", "Paste a list"], ["file", "Upload a file"], ["count", "Just a number"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => { setMode(v); setError(""); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                mode === v ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "paste" && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink">One candidate per line</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10}
              placeholder={"Ama Mensah, Achimota School, 10\nKofi Boateng, Prempeh College, 10\nYaa Asantewaa"}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none" />
            <p className="text-xs text-muted pt-1">Name on its own, or name, school, grade separated by commas.</p>
          </div>
        )}

        {mode === "file" && (
          <div className="space-y-2">
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl py-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
              <p className="text-sm text-ink font-medium">
                {people ? `${people.length} candidates read from your file` : "Tap to pick a spreadsheet"}
              </p>
              <p className="text-xs text-muted mt-1">Needs a name or full_name column. School and grade are optional.</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </div>
        )}

        {mode === "count" && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="How many" type="number" value={count} onChange={(e) => setCount(e.target.value)} />
            <Input label="Name them" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
        )}

        {preview.length > 0 && (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-surface border-b border-border text-xs font-semibold text-ink">
              {preview.length} candidate{preview.length === 1 ? "" : "s"} ready
            </div>
            <div className="max-h-44 overflow-auto divide-y divide-border">
              {preview.slice(0, 60).map((p, i) => (
                <div key={i} className="px-3 py-1.5 text-sm text-ink flex justify-between gap-2">
                  <span>{p.full_name}</span>
                  <span className="text-xs text-muted">{[p.school, p.grade].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
              {preview.length > 60 && (
                <div className="px-3 py-1.5 text-xs text-muted">and {preview.length - 60} more</div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2 border-t border-border">
          <Button onClick={save} disabled={saving || preview.length === 0}>
            {saving ? "Generating credentials..." : `Generate ${preview.length} set${preview.length === 1 ? "" : "s"} of credentials`}
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </SlidePanel>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────

function Stat({ label, value, tone = "plain" }: { label: string; value: number; tone?: string }) {
  const tones: Record<string, string> = {
    plain: "text-ink", blue: "text-blue-600", green: "text-emerald-600",
    amber: "text-amber-600", red: "text-danger",
  };
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className={`text-2xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-muted mt-0.5">{label}</p>
    </div>
  );
}

function StatusChip({ status }: { status: Session["status"] }) {
  const map = {
    scheduled: "bg-surface text-muted border-border",
    live:      "bg-emerald-50 text-emerald-700 border-emerald-200",
    closed:    "bg-red-50 text-danger border-red-200",
  };
  const label = { scheduled: "Scheduled", live: "Open now", closed: "Closed" };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium border ${map[status]}`}>{label[status]}</span>;
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}
