"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import api from "@/lib/api";
import { downloadTemplate, parseQuestionFile, toExamQuestions, ParsedQuestion } from "@/lib/questionSheet";
import {
  ArrowLeft, Download, UploadCloud, FileSpreadsheet, AlertTriangle,
  CheckCircle2, XCircle, Loader2, Undo2,
} from "lucide-react";

const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const LETTERS = ["A", "B", "C", "D", "E"];

interface ExamOption { id: string; title: string; numberOfQuestions?: number }

export default function BulkUploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [target, setTarget]   = useState<"new" | "existing">("new");
  const [exams, setExams]     = useState<ExamOption[]>([]);
  const [examId, setExamId]   = useState("");

  // New exam meta
  const [title, setTitle]         = useState("");
  const [program, setProgram]     = useState("");
  const [grades, setGrades]       = useState<string[]>([]);
  const [timeLimit, setTimeLimit] = useState("");

  const [rows, setRows]       = useState<ParsedQuestion[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError]     = useState("");
  const [done, setDone]       = useState<{ imported: number; total: number } | null>(null);

  useEffect(() => {
    api.get("/announcement-content-options")
      .then((res) => setExams(res.data.exams || []))
      .catch(() => setExams([]));
  }, []);

  const stats = useMemo(() => {
    if (!rows) return null;
    return {
      total:    rows.length,
      ready:    rows.filter((r) => !r.skip && r.errors.length === 0).length,
      blocked:  rows.filter((r) => r.errors.length > 0).length,
      warned:   rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
      skipped:  rows.filter((r) => r.skip && r.errors.length === 0).length,
    };
  }, [rows]);

  const handleFile = async (file: File) => {
    setError(""); setDone(null); setParsing(true); setFileName(file.name);
    try {
      const parsed = await parseQuestionFile(file);
      if (parsed.length === 0) {
        setError("That file has no rows we could read. Check it uses the template columns.");
        setRows(null);
      } else {
        setRows(parsed);
        if (!title && target === "new") setTitle(file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
      }
    } catch {
      setError("We could not read that file. Save it as .xlsx or .csv and try again.");
      setRows(null);
    } finally {
      setParsing(false);
    }
  };

  const patchRow = (rowNumber: number, patch: Partial<ParsedQuestion>) => {
    setRows((prev) => prev && prev.map((r) => {
      if (r.rowNumber !== rowNumber) return r;
      const next = { ...r, ...patch };
      // Re-validate the two fields the preview lets you edit.
      const errors = r.errors.filter((e) => !e.startsWith("Correct answer") && !e.startsWith("No correct") && e !== "Question text is empty");
      if (!next.question.trim()) errors.push("Question text is empty");
      const idx = LETTERS.indexOf(next.correctLetter);
      if (!next.correctLetter) errors.push("No correct answer given");
      else if (idx < 0) errors.push("Correct answer must be a letter from A to E");
      else if (!next.rawOptions[idx]) errors.push(`Correct answer is ${next.correctLetter}, but option ${next.correctLetter} is blank`);
      return { ...next, errors, skip: errors.length > 0 ? true : next.skip };
    }));
  };

  const handleImport = async () => {
    setError("");
    const questions = rows ? toExamQuestions(rows) : [];
    if (questions.length === 0) return setError("There are no valid rows to import yet.");
    if (target === "new" && !title.trim()) return setError("Give this assessment a title.");
    if (target === "existing" && !examId) return setError("Choose which assessment to add these to.");

    setImporting(true);
    try {
      const res = await api.post("/bulk-add-exam", {
        examId: target === "existing" ? examId : undefined,
        title, program, grade: grades,
        duration: timeLimit ? Number(timeLimit) : undefined,
        questions,
      });
      setDone({ imported: res.data.imported, total: res.data.total });
      setRows(null);
    } catch {
      setError("The import did not go through. Try again in a moment.");
    } finally {
      setImporting(false);
    }
  };

  const toggleGrade = (g: string) =>
    setGrades((p) => p.includes(g) ? p.filter((x) => x !== g) : [...p, g]);

  return (
    <AuthGuard>
      <DashboardShell title="Bulk question upload">
        <div className="space-y-6 max-w-5xl pb-16">
          <Button variant="ghost" size="sm" onClick={() => router.push("/assessment")}>
            <ArrowLeft size={14} /> Back to assessments
          </Button>

          {done ? (
            <Card>
              <div className="py-10 text-center space-y-4">
                <CheckCircle2 size={40} className="text-emerald-600 mx-auto" />
                <div>
                  <p className="text-lg font-semibold text-ink">
                    {done.imported} question{done.imported === 1 ? "" : "s"} imported
                  </p>
                  <p className="text-sm text-muted mt-1">This assessment now holds {done.total} questions.</p>
                </div>
                <div className="flex gap-3 justify-center pt-2">
                  <Button onClick={() => router.push("/assessment")}>See all assessments</Button>
                  <Button variant="secondary" onClick={() => { setDone(null); setFileName(""); }}>
                    Upload another file
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              {/* Step 1: where do these go */}
              <Card title="Where should these questions go?">
                <div className="space-y-4">
                  <div className="flex gap-2">
                    {([["new", "Create a new assessment"], ["existing", "Add to an existing one"]] as const).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setTarget(v)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                          target === v ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {target === "new" ? (
                    <div className="space-y-4">
                      <Input label="Assessment title" placeholder="e.g. Grade 10 Mathematics Mock" value={title} onChange={(e) => setTitle(e.target.value)} />
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="Program" placeholder="e.g. Mathematics" value={program} onChange={(e) => setProgram(e.target.value)} />
                        <Input label="Time limit (minutes)" type="number" placeholder="e.g. 60" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-ink">Grade levels</label>
                        <div className="flex flex-wrap gap-1.5">
                          {GRADES.map((g) => (
                            <button key={g} type="button" onClick={() => toggleGrade(g)}
                              className={`px-2.5 py-1 rounded text-xs border font-medium transition-colors ${grades.includes(g) ? "bg-primary text-white border-primary" : "border-border text-muted hover:border-primary hover:text-primary"}`}>
                              Gr. {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-ink">Assessment</label>
                      <select value={examId} onChange={(e) => setExamId(e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                        <option value="">Choose an assessment...</option>
                        {exams.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}{x.numberOfQuestions ? ` (${x.numberOfQuestions} questions)` : ""}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted pt-1">New questions are added to the end. Nothing existing is replaced.</p>
                    </div>
                  )}
                </div>
              </Card>

              {/* Step 2: the file */}
              <Card title="Your question file">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" size="sm" onClick={downloadTemplate}>
                      <Download size={14} /> Download the template
                    </Button>
                    <p className="text-xs text-muted">
                      Columns: question, option_a to option_e, correct, explanation, image_url
                    </p>
                  </div>

                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) handleFile(f);
                    }}
                    className="border-2 border-dashed border-border rounded-xl py-10 text-center cursor-pointer hover:border-primary/50 hover:bg-surface/40 transition-colors"
                  >
                    {parsing ? (
                      <><Loader2 size={22} className="mx-auto mb-2 animate-spin text-primary" />
                        <p className="text-sm text-muted">Reading your questions...</p></>
                    ) : fileName ? (
                      <><FileSpreadsheet size={22} className="mx-auto mb-2 text-primary" />
                        <p className="text-sm font-medium text-ink">{fileName}</p>
                        <p className="text-xs text-muted mt-1">Tap to pick a different file</p></>
                    ) : (
                      <><UploadCloud size={22} className="mx-auto mb-2 text-subtle" />
                        <p className="text-sm text-ink font-medium">Drop your file here, or tap to browse</p>
                        <p className="text-xs text-muted mt-1">Excel or CSV, up to a few thousand rows</p></>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                </div>
              </Card>

              {/* Step 3: preview */}
              {rows && stats && (
                <Card title={`Check before importing (${stats.total} rows)`}>
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Pill tone="ok"    label={`${stats.ready} ready to import`} />
                      {stats.blocked > 0 && <Pill tone="bad"  label={`${stats.blocked} need fixing`} />}
                      {stats.warned  > 0 && <Pill tone="warn" label={`${stats.warned} worth a look`} />}
                      {stats.skipped > 0 && <Pill tone="mute" label={`${stats.skipped} skipped`} />}
                    </div>

                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className="max-h-[28rem] overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-surface sticky top-0 z-10">
                            <tr className="border-b border-border">
                              <th className="text-left px-3 py-2 text-muted font-medium w-14">Row</th>
                              <th className="text-left px-3 py-2 text-muted font-medium">Question</th>
                              <th className="text-left px-3 py-2 text-muted font-medium w-44">Options</th>
                              <th className="text-left px-3 py-2 text-muted font-medium w-24">Correct</th>
                              <th className="text-left px-3 py-2 text-muted font-medium w-24">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const bad = r.errors.length > 0;
                              return (
                                <tr key={r.rowNumber}
                                  className={`border-b border-border last:border-0 align-top ${
                                    bad ? "bg-red-50/50" : r.skip ? "opacity-50" : ""
                                  }`}>
                                  <td className="px-3 py-2 text-subtle">{r.rowNumber}</td>
                                  <td className="px-3 py-2">
                                    <input
                                      value={r.question}
                                      onChange={(e) => patchRow(r.rowNumber, { question: e.target.value })}
                                      className="w-full bg-transparent border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 text-sm focus:outline-none"
                                    />
                                    {(r.errors.length > 0 || r.warnings.length > 0) && (
                                      <div className="mt-1 space-y-0.5">
                                        {r.errors.map((e, i) => (
                                          <p key={i} className="text-xs text-danger flex items-center gap-1">
                                            <XCircle size={10} className="shrink-0" /> {e}
                                          </p>
                                        ))}
                                        {r.warnings.map((w, i) => (
                                          <p key={i} className="text-xs text-amber-600 flex items-center gap-1">
                                            <AlertTriangle size={10} className="shrink-0" /> {w}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-muted">
                                    {r.rawOptions.map((o, i) => o ? (
                                      <div key={i} className="truncate">
                                        <span className="font-semibold text-ink">{LETTERS[i]}.</span> {o}
                                      </div>
                                    ) : null)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={r.correctLetter}
                                      onChange={(e) => patchRow(r.rowNumber, { correctLetter: e.target.value })}
                                      className="border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                                    >
                                      <option value="">Pick</option>
                                      {LETTERS.map((L, i) => (
                                        <option key={L} value={L} disabled={!r.rawOptions[i]}>{L}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    {bad ? (
                                      <span className="text-xs font-semibold text-danger">Needs fixing</span>
                                    ) : (
                                      <button
                                        onClick={() => patchRow(r.rowNumber, { skip: !r.skip })}
                                        className={`text-xs font-semibold flex items-center gap-1 ${r.skip ? "text-muted hover:text-ink" : "text-danger hover:underline"}`}
                                      >
                                        {r.skip ? <><Undo2 size={11} /> Include</> : "Skip"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {stats.blocked > 0 && (
                      <p className="text-xs text-muted">
                        Rows that need fixing are left out of the import. Fix them here, or correct the
                        spreadsheet and upload it again.
                      </p>
                    )}
                  </div>
                </Card>
              )}

              {error && (
                <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
              )}

              {rows && stats && (
                <div className="flex gap-3">
                  <Button onClick={handleImport} disabled={importing || stats.ready === 0}>
                    {importing
                      ? "Importing your questions..."
                      : `Import ${stats.ready} question${stats.ready === 1 ? "" : "s"}`}
                  </Button>
                  <Button variant="secondary" onClick={() => { setRows(null); setFileName(""); }}>
                    Start over
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}

function Pill({ tone, label }: { tone: "ok" | "bad" | "warn" | "mute"; label: string }) {
  const tones = {
    ok:   "bg-emerald-50 text-emerald-700 border-emerald-200",
    bad:  "bg-red-50 text-danger border-red-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    mute: "bg-surface text-muted border-border",
  };
  return <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${tones[tone]}`}>{label}</span>;
}
