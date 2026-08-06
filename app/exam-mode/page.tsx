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
  Printer, MoreHorizontal, RefreshCw, Play, Square, Link2, Pause,
  ShieldCheck, FileText, History, Send, Lock, Unlock, X, AlertTriangle,
  CheckCircle2, XCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Session {
  id: string; examId: string; title: string; sessionCode: string;
  startsAt?: string; endsAt?: string; durationMinutes: number;
  status: "scheduled" | "live" | "closed" | "paused";
  showResultsToCandidate: boolean; shuffleQuestions: boolean;
  lockToDevice: boolean; maxTabSwitches: number;
  pausedAt?: string | null;
  resultsPublishedAt?: string | null; resultsPublishedBy?: string | null;
  resultsShowBreakdown: boolean;
  counts?: Record<string, number>;
}

interface Candidate {
  id: string; fullName: string; school?: string; grade?: string;
  accessCode: string; passwordPlain: string;
  status: "pending" | "in_progress" | "submitted" | "disqualified";
  startedAt?: string; expiresAt?: string; submittedAt?: string;
  score?: number; totalQuestions?: number; tabSwitches: number;
  lastSeenAt?: string;
}

interface AuditEntry {
  id: number; actorEmail: string; action: string; reason?: string;
  detail: Record<string, unknown>; createdAt: string;
}

interface EventEntry {
  id: number; candidateName: string; type: string;
  meta: Record<string, unknown>; createdAt: string;
}

interface ExamOption { id: string; title: string; numberOfQuestions?: number }

// ── Helpers ────────────────────────────────────────────────────────────────

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

// Plain descriptions so a log entry reads the same to an invigilator, a parent
// and a examinations board, with no decoding needed.
const EVENT_LABEL: Record<string, string> = {
  login:             "Signed in",
  failed_login:      "Wrong details entered",
  device_mismatch:   "Tried to sign in from a different device",
  tab_blur:          "Left the exam page",
  copy:              "Tried to copy",
  paste:             "Tried to paste",
  cut:               "Tried to cut",
  submit:            "Submitted their exam",
  auto_submit:       "Time ran out, submitted automatically",
  auto_disqualified: "Stopped automatically after too many tab switches",
  viewed_results:    "Viewed their results",
};

const ACTION_LABEL: Record<string, string> = {
  "candidate.release":        "Released the device lock",
  "candidate.extend":         "Added time",
  "candidate.reduce":         "Removed time",
  "candidate.reinstate":      "Let the candidate back in",
  "candidate.disqualify":     "Stopped the attempt",
  "candidate.reset":          "Reset the attempt to a clean start",
  "session.pause":            "Paused the sitting",
  "session.resume":           "Resumed the sitting",
  "session.extend_all":       "Added time for everyone",
  "session.publish_results":  "Published results",
  "session.unpublish_results":"Withdrew published results",
  "session.set_show_results": "Changed instant results setting",
  "session.set_breakdown":    "Changed answer breakdown setting",
  "session.set_tab_limit":    "Changed the tab switch limit",
  "session.set_device_lock":  "Changed the device lock setting",
  "session.open":             "Opened the exam",
  "session.close":            "Closed the exam",
};

// Actions that change a candidate's standing or the clock always need a written
// reason. Benign ones do not, so the requirement stays meaningful.
const REASON_REQUIRED = new Set([
  "reset", "disqualify", "reinstate", "extend", "reduce",
  "extend_all", "pause", "unpublish_results", "close",
]);

const fmt = (s?: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—";

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
    api.get("/announcement-content-options").then((r) => setExams(r.data.exams || [])).catch(() => {});
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
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> New sitting</Button>
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
                          {s.resultsPublishedAt && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200">
                              Results out
                            </span>
                          )}
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

        <CreateSessionPanel open={createOpen} exams={exams}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); loadSessions(); setOpenId(id); }} />
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Session detail ─────────────────────────────────────────────────────────

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession]       = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"candidates" | "activity" | "audit">("candidates");
  const [addOpen, setAddOpen]       = useState(false);
  const [live, setLive]             = useState(true);
  const [copied, setCopied]         = useState(false);
  const [siteUrl, setSiteUrl]       = useState("");
  const [error, setError]           = useState("");
  const [notice, setNotice]         = useState("");
  const [transcriptFor, setTranscriptFor] = useState<Candidate | null>(null);

  // Pending action awaiting a reason
  const [ask, setAsk] = useState<null | {
    title: string; action: string; scope: "session" | "candidate";
    candidateId?: string; value?: number; flag?: boolean; required: boolean;
  }>(null);

  useEffect(() => { setSiteUrl(localStorage.getItem("giftedSiteUrl") || ""); }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/exam-session/${sessionId}`);
      setSession(res.data.session);
      setCandidates(res.data.candidates || []);
    } catch { /* keep last known state */ }
    finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [live, load]);

  const examLink = useMemo(() => {
    if (!session) return "";
    return `${siteUrl.replace(/\/$/, "") || "https://your-site"}/exam/${session.sessionCode}`;
  }, [session, siteUrl]);

  const stats = useMemo(() => ({
    total:   candidates.length,
    writing: candidates.filter((c) => c.status === "in_progress").length,
    done:    candidates.filter((c) => c.status === "submitted").length,
    stopped: candidates.filter((c) => c.status === "disqualified").length,
    flagged: candidates.filter((c) => c.tabSwitches > 0 && c.status !== "submitted").length,
  }), [candidates]);

  // Every control funnels through here so nothing reaches the database without
  // an actor and, where it matters, a reason.
  const request = (
    title: string, action: string, scope: "session" | "candidate",
    opts: { candidateId?: string; value?: number; flag?: boolean } = {}
  ) => setAsk({ title, action, scope, required: REASON_REQUIRED.has(action), ...opts });

  const run = async (reason: string) => {
    if (!ask) return;
    setError(""); setNotice("");
    try {
      if (ask.scope === "session") {
        const res = await api.post("/session-action", {
          sessionId, action: ask.action, value: ask.value ?? 0, flag: ask.flag ?? null, reason,
        });
        if (res.data?.affected) setNotice(`Applied to ${res.data.affected} candidate${res.data.affected === 1 ? "" : "s"}.`);
      } else {
        await api.post("/candidate-action", {
          candidateId: ask.candidateId, action: ask.action, minutes: ask.value ?? 0, reason,
        });
      }
      setAsk(null);
      load();
    } catch (e) {
      setError(serverMessage(e, "That control did not go through. Try again."));
      setAsk(null);
    }
  };

  const exportCsv = () => {
    const ws = XLSX.utils.json_to_sheet(candidates.map((c) => ({
      name: c.fullName, school: c.school || "", grade: c.grade || "",
      access_code: c.accessCode, password: c.passwordPlain,
      status: STATUS_META[c.status].label,
      score: c.score ?? "", out_of: c.totalQuestions ?? "",
      started: fmt(c.startedAt), submitted: fmt(c.submittedAt),
      tab_switches: c.tabSwitches,
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
        td{padding:3px 0;vertical-align:top;} td:first-child{color:#666;width:100px;}
        .mono{font-family:ui-monospace,Menlo,Consolas,monospace;}
        .big{font-size:16px;font-weight:700;letter-spacing:.08em;}
        @media print{body{padding:0;} .slip{margin-bottom:8px;}}
      </style></head><body>${slips}</body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  if (loading) {
    return <AuthGuard><DashboardShell title="Exam Mode"><Spinner text="Loading this sitting..." /></DashboardShell></AuthGuard>;
  }

  const paused = !!session?.pausedAt;

  return (
    <AuthGuard>
      <DashboardShell title={session?.title || "Exam sitting"}>
        <div className="space-y-5 max-w-6xl pb-16">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> All sittings</Button>
            <div className="flex items-center gap-2 flex-wrap">
              {session?.status !== "live" && !paused && (
                <Button size="sm" onClick={() => request("Open the exam", "open", "session")}>
                  <Play size={13} /> Open the exam
                </Button>
              )}
              {paused ? (
                <Button size="sm" onClick={() => request("Resume the sitting", "resume", "session")}>
                  <Play size={13} /> Resume everyone
                </Button>
              ) : session?.status === "live" && (
                <Button variant="secondary" size="sm" onClick={() => request("Pause the sitting", "pause", "session")}>
                  <Pause size={13} /> Pause everyone
                </Button>
              )}
              {session?.status !== "closed" && (
                <Button variant="secondary" size="sm" onClick={() => request("Close the exam", "close", "session")}>
                  <Square size={13} /> Close the exam
                </Button>
              )}
            </div>
          </div>

          {paused && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <Pause size={15} className="text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800">
                This sitting is paused. Every clock is frozen and the time will be given back when you resume.
              </p>
            </div>
          )}
          {error &&  <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{notice}</p>}

          {/* Link */}
          <Card title="The link you send out">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Link2 size={14} className="text-muted shrink-0" />
                <code className="text-sm font-mono bg-surface border border-border rounded px-2 py-1.5 flex-1 min-w-0 truncate">{examLink}</code>
                <Button size="sm" variant="secondary" onClick={() => {
                  navigator.clipboard.writeText(examLink); setCopied(true); setTimeout(() => setCopied(false), 1800);
                }}>
                  {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="Your student site address" placeholder="https://giftededu.tech"
                    value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
                </div>
                <Button size="sm" variant="secondary" onClick={() => localStorage.setItem("giftedSiteUrl", siteUrl)}>
                  Save address
                </Button>
              </div>
            </div>
          </Card>

          {/* Results control */}
          <Card title="Results">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  {session?.resultsPublishedAt ? (
                    <>
                      <p className="text-sm font-medium text-emerald-700 flex items-center gap-1.5">
                        <CheckCircle2 size={14} /> Results are published
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        Released {fmt(session.resultsPublishedAt)}
                        {session.resultsPublishedBy ? ` by ${session.resultsPublishedBy}` : ""}.
                        Candidates see their score by signing in with the same credentials.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink">Results are not released</p>
                      <p className="text-xs text-muted mt-0.5">
                        {session?.showResultsToCandidate
                          ? "Candidates see their score the moment they submit."
                          : "Candidates see nothing after submitting until you publish."}
                      </p>
                    </>
                  )}
                </div>
                {session?.resultsPublishedAt ? (
                  <Button size="sm" variant="secondary"
                    onClick={() => request("Withdraw published results", "unpublish_results", "session")}>
                    Withdraw results
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => request("Publish results", "publish_results", "session")}>
                    <Send size={13} /> Publish results now
                  </Button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t border-border">
                <LiveToggle
                  label="Show scores the moment a candidate submits"
                  value={!!session?.showResultsToCandidate}
                  onChange={(v) => request("Change instant results", "set_show_results", "session", { flag: v })}
                />
                <LiveToggle
                  label="Show which questions they got wrong"
                  value={!!session?.resultsShowBreakdown}
                  onChange={(v) => request("Change answer breakdown", "set_breakdown", "session", { flag: v })}
                  hint="Reveals the correct answers, so only turn this on once the paper is retired."
                />
              </div>
            </div>
          </Card>

          {/* Invigilation control */}
          <Card title="Invigilation">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
              <LiveToggle
                label="Lock each candidate to the device they start on"
                value={!!session?.lockToDevice}
                onChange={(v) => request("Change device lock", "set_device_lock", "session", { flag: v })}
              />
              <div>
                <p className="text-sm text-ink mb-1.5">Tab switches before an attempt is stopped</p>
                <div className="flex items-center gap-2">
                  {[0, 3, 5, 10].map((n) => (
                    <button key={n} type="button"
                      onClick={() => request("Change the tab switch limit", "set_tab_limit", "session", { value: n })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        session?.maxTabSwitches === n
                          ? "bg-primary text-white border-primary"
                          : "border-border text-muted hover:border-primary hover:text-primary"
                      }`}>
                      {n === 0 ? "Never stop" : n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2 pt-2 border-t border-border">
                <p className="text-sm text-ink mb-1.5">Give everyone still writing more time</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {[5, 10, 15, 30].map((n) => (
                    <Button key={n} size="sm" variant="secondary"
                      onClick={() => request(`Add ${n} minutes for everyone`, "extend_all", "session", { value: n })}>
                      <Clock size={12} /> Add {n} min
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Live numbers */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Candidates" value={stats.total} />
            <Stat label="Writing now" value={stats.writing} tone="blue" />
            <Stat label="Submitted" value={stats.done} tone="green" />
            <Stat label="Flagged" value={stats.flagged} tone="amber" />
            <Stat label="Stopped" value={stats.stopped} tone="red" />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border">
            {([
              ["candidates", "Candidates", Users],
              ["activity",   "Activity log", History],
              ["audit",      "Admin audit", ShieldCheck],
            ] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === v ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {tab === "candidates" && (
            <Card
              title={`Candidates (${candidates.length})`}
              action={
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                    <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto refresh
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
                        {["Candidate", "Access", "Status", "Time left", "Flags", "Score", ""].map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-muted font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <CandidateRow key={c.id} c={c} session={session} paused={paused}
                          onRequest={request} onTranscript={() => setTranscriptFor(c)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {tab === "activity" && <ActivityTab sessionId={sessionId} />}
          {tab === "audit"    && <AuditTab sessionId={sessionId} />}
        </div>

        <AddCandidatesPanel open={addOpen} sessionId={sessionId}
          onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load(); }} />

        {ask && (
          <ReasonModal title={ask.title} required={ask.required}
            onCancel={() => setAsk(null)} onConfirm={run} />
        )}

        {transcriptFor && (
          <TranscriptModal candidate={transcriptFor} onClose={() => setTranscriptFor(null)} />
        )}
      </DashboardShell>
    </AuthGuard>
  );
}

// ── Candidate row ──────────────────────────────────────────────────────────

function CandidateRow({ c, session, paused, onRequest, onTranscript }: {
  c: Candidate; session: Session | null; paused: boolean;
  onRequest: (title: string, action: string, scope: "session" | "candidate",
              opts?: { candidateId?: string; value?: number; flag?: boolean }) => void;
  onTranscript: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const meta = STATUS_META[c.status];
  const maxTabs = session?.maxTabSwitches ?? 0;

  const timeLeft = useMemo(() => {
    if (c.status !== "in_progress" || !c.expiresAt) return null;
    if (paused) return "Paused";
    const ms = new Date(c.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "Time up";
    const m = Math.floor(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  }, [c.status, c.expiresAt, paused]);

  const item = (action: string, label: string, value = 0) => ({ action, label, value });
  const items = [
    item("release", "Release the device lock"),
    item("extend", "Add 10 minutes", 10),
    item("reduce", "Take back 10 minutes", 10),
    item("reinstate", "Let them back in"),
    item("disqualify", "Stop this attempt"),
    item("reset", "Reset to a clean start"),
  ];

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface/40">
      <td className="px-4 py-2.5">
        <p className="font-medium text-ink">{c.fullName}</p>
        {(c.school || c.grade) && (
          <p className="text-xs text-muted">{[c.school, c.grade && `Grade ${c.grade}`].filter(Boolean).join(" · ")}</p>
        )}
      </td>
      <td className="px-4 py-2.5">
        <p className="font-mono text-xs text-ink">{c.accessCode}</p>
        <p className="font-mono text-xs text-muted">{c.passwordPlain}</p>
      </td>
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
            <ShieldAlert size={11} /> {c.tabSwitches}
          </span>
        ) : <span className="text-xs text-subtle">Clean</span>}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {c.score != null
          ? <span className="font-semibold text-ink">{c.score}/{c.totalQuestions}</span>
          : <span className="text-subtle">—</span>}
      </td>
      <td className="px-4 py-2.5 relative whitespace-nowrap">
        <button onClick={onTranscript} title="Open the full transcript"
          className="p-1 rounded hover:bg-surface text-subtle hover:text-primary mr-1">
          <FileText size={14} />
        </button>
        <button onClick={() => setMenu((v) => !v)} className="p-1 rounded hover:bg-surface text-subtle hover:text-ink">
          <MoreHorizontal size={15} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-4 top-9 z-20 w-56 bg-card border border-border rounded-xl shadow-lg py-1 text-sm">
              {items.map(({ action, label, value }) => (
                <button key={action}
                  onClick={() => { setMenu(false); onRequest(label, action, "candidate", { candidateId: c.id, value }); }}
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

// ── Reason capture ─────────────────────────────────────────────────────────

function ReasonModal({ title, required, onCancel, onConfirm }: {
  title: string; required: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = required && reason.trim().length < 3;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="bg-card rounded-2xl p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold text-ink mb-1">{title}</h3>
        <p className="text-sm text-muted mb-4">
          {required
            ? "This is recorded against your account with the reason you give. Say what happened."
            : "Add a note if it helps. This action is recorded against your account either way."}
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder="e.g. Power cut at Achimota, candidates lost 12 minutes"
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none"
        />
        {required && (
          <p className="text-xs text-muted mt-1.5">A reason is required for this one.</p>
        )}
        <div className="flex gap-3 mt-5">
          <Button disabled={blocked || busy}
            onClick={() => { setBusy(true); onConfirm(reason.trim()); }}>
            {busy ? "Applying..." : "Confirm"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Transcript ─────────────────────────────────────────────────────────────

interface Transcript {
  candidate: Record<string, unknown>;
  sitting: Record<string, unknown>;
  questions: {
    idx: number; question: string; options: string[];
    yourAnswer?: string; correctAnswer?: string; correct: boolean;
    history: { at: string; from?: string; to?: string }[];
  }[];
  events: { at: string; type: string; meta: Record<string, unknown> }[];
  adminActions: { at: string; actor: string; action: string; reason?: string }[];
}

function TranscriptModal({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const [t, setT] = useState<Transcript | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/exam-transcript/${candidate.id}`)
      .then((r) => setT(r.data))
      .catch((e) => setError(serverMessage(e, "Could not load the transcript.")));
  }, [candidate.id]);

  const exportTranscript = () => {
    if (!t) return;
    const ws = XLSX.utils.json_to_sheet(t.questions.map((q, i) => ({
      no: i + 1,
      question: String(q.question || "").replace(/<[^>]+>/g, " ").trim(),
      their_answer: String(q.yourAnswer ?? "").replace(/<[^>]+>/g, " ").trim(),
      correct_answer: String(q.correctAnswer ?? "").replace(/<[^>]+>/g, " ").trim(),
      result: q.yourAnswer == null ? "Blank" : q.correct ? "Correct" : "Wrong",
      changes: q.history.length,
      last_answered: q.history.length ? fmt(q.history[q.history.length - 1].at) : "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transcript");
    XLSX.writeFile(wb, `transcript-${candidate.accessCode}.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="bg-card rounded-2xl max-w-4xl w-full">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border sticky top-0 bg-card rounded-t-2xl">
          <div>
            <h3 className="text-lg font-semibold text-ink">{candidate.fullName}</h3>
            <p className="text-xs text-muted">
              {candidate.accessCode} · Submission transcript
            </p>
          </div>
          <div className="flex items-center gap-2">
            {t && <Button size="sm" variant="secondary" onClick={exportTranscript}><Download size={13} /> Export</Button>}
            <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-ink hover:bg-surface">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {!t && !error && <Spinner text="Pulling the full record..." />}

          {t && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Score" value={`${t.candidate.score ?? "—"}/${t.candidate.total ?? "—"}`} />
                <MiniStat label="Started" value={fmt(t.candidate.startedAt as string)} small />
                <MiniStat label="Submitted" value={fmt(t.candidate.submittedAt as string)} small />
                <MiniStat label="Tab switches" value={String(t.candidate.tabSwitches ?? 0)} />
              </div>

              {/* Answers */}
              <div>
                <p className="text-sm font-semibold text-ink mb-2">Every answer, with when it was given</p>
                <div className="border border-border rounded-xl divide-y divide-border max-h-96 overflow-y-auto">
                  {t.questions.map((q, i) => (
                    <div key={q.idx} className="p-3">
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">
                          {q.yourAnswer == null
                            ? <AlertTriangle size={13} className="text-subtle" />
                            : q.correct
                              ? <CheckCircle2 size={13} className="text-emerald-600" />
                              : <XCircle size={13} className="text-danger" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink">
                            <span className="text-muted font-medium">Q{i + 1}.</span>{" "}
                            <span dangerouslySetInnerHTML={{ __html: q.question }} />
                          </p>
                          <div className="mt-1.5 grid sm:grid-cols-2 gap-1.5 text-xs">
                            <p className={q.correct ? "text-emerald-700" : "text-danger"}>
                              <span className="text-muted">They chose: </span>
                              {q.yourAnswer
                                ? <span dangerouslySetInnerHTML={{ __html: q.yourAnswer }} />
                                : <span className="text-subtle">left blank</span>}
                            </p>
                            <p className="text-muted">
                              <span>Correct: </span>
                              <span className="text-ink" dangerouslySetInnerHTML={{ __html: q.correctAnswer || "" }} />
                            </p>
                          </div>
                          {q.history.length > 0 && (
                            <details className="mt-1.5">
                              <summary className="text-xs text-primary cursor-pointer">
                                {q.history.length} change{q.history.length === 1 ? "" : "s"}, last at {fmt(q.history[q.history.length - 1].at)}
                              </summary>
                              <ul className="mt-1 space-y-0.5 pl-3 border-l-2 border-border">
                                {q.history.map((h, hi) => (
                                  <li key={hi} className="text-xs text-muted">
                                    {fmt(h.at)} —{" "}
                                    {h.from
                                      ? <>changed from &ldquo;{stripTags(h.from)}&rdquo; to &ldquo;{stripTags(h.to || "")}&rdquo;</>
                                      : <>chose &ldquo;{stripTags(h.to || "")}&rdquo;</>}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Events */}
              <div>
                <p className="text-sm font-semibold text-ink mb-2">What happened during the sitting</p>
                <div className="border border-border rounded-xl divide-y divide-border max-h-64 overflow-y-auto">
                  {t.events.length === 0 && <p className="p-3 text-sm text-muted">Nothing recorded.</p>}
                  {t.events.map((e, i) => (
                    <div key={i} className="px-3 py-2 flex items-baseline gap-3">
                      <span className="text-xs text-subtle font-mono shrink-0 w-44">{fmt(e.at)}</span>
                      <span className="text-sm text-ink">{EVENT_LABEL[e.type] || e.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin actions on this candidate */}
              {t.adminActions.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-ink mb-2">Admin actions on this candidate</p>
                  <div className="border border-border rounded-xl divide-y divide-border">
                    {t.adminActions.map((a, i) => (
                      <div key={i} className="px-3 py-2">
                        <div className="flex items-baseline gap-3">
                          <span className="text-xs text-subtle font-mono shrink-0 w-44">{fmt(a.at)}</span>
                          <span className="text-sm text-ink">{ACTION_LABEL[a.action] || a.action}</span>
                        </div>
                        <p className="text-xs text-muted pl-[11.75rem]">
                          by {a.actor}{a.reason ? ` — ${a.reason}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity tab ───────────────────────────────────────────────────────────

function ActivityTab({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    api.get(`/exam-session-events/${sessionId}`)
      .then((r) => setEvents(r.data.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const shown = events.filter((e) =>
    !filter || e.candidateName.toLowerCase().includes(filter.toLowerCase())
    || (EVENT_LABEL[e.type] || e.type).toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Card title="Everything the system recorded"
      action={<Button size="sm" variant="ghost" onClick={load}><RefreshCw size={13} /></Button>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Sign ins, tab switches, copy attempts and submissions, newest first. This is the
          record to reach for when a candidate disputes what happened.
        </p>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by candidate or what happened"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />

        {loading ? <Spinner text="Loading the activity log..." /> : shown.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">Nothing recorded yet.</p>
        ) : (
          <div className="border border-border rounded-xl divide-y divide-border max-h-[30rem] overflow-y-auto">
            {shown.map((e) => (
              <div key={e.id} className="px-3 py-2 flex items-baseline gap-3">
                <span className="text-xs text-subtle font-mono shrink-0 w-44">{fmt(e.createdAt)}</span>
                <span className="text-sm font-medium text-ink shrink-0 w-40 truncate">{e.candidateName}</span>
                <span className={`text-sm ${
                  ["tab_blur", "device_mismatch", "failed_login", "auto_disqualified"].includes(e.type)
                    ? "text-amber-700" : "text-muted"
                }`}>
                  {EVENT_LABEL[e.type] || e.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Audit tab ──────────────────────────────────────────────────────────────

function AuditTab({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<{ intact: boolean; entries: number; brokenAt: number | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get(`/exam-audit/${sessionId}`)
      .then((r) => { setEntries(r.data.entries || []); setChain(r.data.chain || null); })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card title="Who changed what"
      action={<Button size="sm" variant="ghost" onClick={load}><RefreshCw size={13} /></Button>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Every admin action on this sitting, with the account that did it and the reason given.
        </p>

        {chain && (
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border ${
            chain.intact
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
          }`}>
            {chain.intact
              ? <Lock size={14} className="text-emerald-600 shrink-0 mt-0.5" />
              : <Unlock size={14} className="text-danger shrink-0 mt-0.5" />}
            <div>
              <p className={`text-sm font-medium ${chain.intact ? "text-emerald-800" : "text-danger"}`}>
                {chain.intact
                  ? `Record intact across all ${chain.entries} entries`
                  : `Record altered at entry ${chain.brokenAt}`}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {chain.intact
                  ? "Each entry is hash linked to the one before it. Nothing has been edited or removed."
                  : "An entry has been changed or deleted since it was written. Everything from that point on is suspect."}
              </p>
            </div>
          </div>
        )}

        {loading ? <Spinner text="Loading the audit trail..." /> : entries.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">No admin actions on this sitting yet.</p>
        ) : (
          <div className="border border-border rounded-xl divide-y divide-border max-h-[30rem] overflow-y-auto">
            {entries.map((a) => (
              <div key={a.id} className="px-3 py-2.5">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-xs text-subtle font-mono shrink-0">{fmt(a.createdAt)}</span>
                  <span className="text-sm font-medium text-ink">{ACTION_LABEL[a.action] || a.action}</span>
                  <span className="text-xs text-muted">by {a.actorEmail}</span>
                </div>
                {(a.detail?.candidate as string) && (
                  <p className="text-xs text-muted mt-0.5">Candidate: {a.detail.candidate as string}</p>
                )}
                {a.reason
                  ? <p className="text-sm text-body mt-1 pl-2 border-l-2 border-border">{a.reason}</p>
                  : <p className="text-xs text-subtle mt-1 italic">No reason given</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
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
          <p className="text-xs text-muted">
            Every one of these can be changed later, including while the exam is running.
          </p>
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

  const buildFromText = () =>
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [full_name, school, grade] = l.split(",").map((p) => p.trim());
      return { full_name, school: school || undefined, grade: grade || undefined };
    });

  const handleFile = async (file: File) => {
    setError("");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
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
              {preview.length > 60 && <div className="px-3 py-1.5 text-xs text-muted">and {preview.length - 60} more</div>}
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

function MiniStat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-semibold text-ink ${small ? "text-xs" : "text-base"}`}>{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: Session["status"] }) {
  const map: Record<Session["status"], string> = {
    scheduled: "bg-surface text-muted border-border",
    live:      "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused:    "bg-amber-50 text-amber-700 border-amber-200",
    closed:    "bg-red-50 text-danger border-red-200",
  };
  const label: Record<Session["status"], string> = {
    scheduled: "Scheduled", live: "Open now", paused: "Paused", closed: "Closed",
  };
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

// Same look as Toggle, but every flip goes through the reason prompt and the
// audit trail rather than changing state silently.
function LiveToggle({ label, value, onChange, hint }: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div>
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <div onClick={() => onChange(!value)}
          className={`mt-0.5 w-9 h-5 rounded-full transition-colors relative flex items-center shrink-0 ${value ? "bg-primary" : "bg-border"}`}>
          <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`} />
        </div>
        <span className="text-sm text-ink">{label}</span>
      </label>
      {hint && <p className="text-xs text-muted mt-1 pl-[2.9rem]">{hint}</p>}
    </div>
  );
}

function stripTags(s: string) {
  return String(s).replace(/<[^>]+>/g, "").trim();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}
