"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import Button from "@/components/ui/Button";
import SlidePanel from "@/components/ui/SlidePanel";
import api from "@/lib/api";
import type { FormField } from "@/lib/registrationFields";
import { UploadCloud, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

// Bringing a Google Form export across.
//
// The hard part is not parsing the file, it is deciding which spreadsheet
// column is which question. Google Form headers are whole sentences, so the
// mapping is guessed and then shown for correction rather than assumed.

const SKIP = "__skip__";
const EMAIL = "__email__";

function normalise(s: string) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Best guess at which field a spreadsheet column belongs to. */
function guess(header: string, fields: FormField[]): string {
  const h = normalise(header);
  if (/(email|e mail)/.test(h)) return EMAIL;

  // Exact-ish label match first, then a containment match
  const exact = fields.find((f) => normalise(f.label) === h || normalise(f.key) === h);
  if (exact) return exact.key;

  const loose = fields.find((f) => {
    const l = normalise(f.label);
    return l.length > 3 && (h.includes(l) || l.includes(h));
  });
  return loose ? loose.key : SKIP;
}

interface Props {
  formId: string;
  fields: FormField[];
  onClose: () => void;
  onImported: () => void;
}

export default function ImportPanel({ formId, fields, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]       = useState<Record<string, unknown>[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap]         = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const [done, setDone]       = useState<{ imported: number; skipped: number; unmatched: string[] } | null>(null);

  const readFile = async (file: File) => {
    setError(""); setDone(null); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (parsed.length === 0) { setError("That file has no rows we could read."); return; }

      const cols = Object.keys(parsed[0]);
      setRows(parsed);
      setHeaders(cols);
      setMap(Object.fromEntries(cols.map((c) => [c, guess(c, fields)])));
    } catch {
      setError("We could not read that file. Export it as .csv or .xlsx and try again.");
    }
  };

  const emailColumn = Object.entries(map).find(([, v]) => v === EMAIL)?.[0];
  const mappedCount = Object.values(map).filter((v) => v !== SKIP && v !== EMAIL).length;

  const run = async () => {
    if (!rows || !emailColumn) return;
    setBusy(true); setError("");
    try {
      // Reshape each spreadsheet row into answers keyed by field
      const payload = rows.map((r) => {
        const out: Record<string, unknown> = { __email: String(r[emailColumn] ?? "").trim() };
        for (const [col, target] of Object.entries(map)) {
          if (target === SKIP || target === EMAIL) continue;
          out[target] = r[col];
        }
        return out;
      });

      const res = await api.post("/import-registrations", {
        formId, rows: payload, source: fileName || "Google Forms",
      });
      setDone(res.data);
      onImported();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || "The import did not go through. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <SlidePanel open onClose={onClose} title="Import existing responses" width="lg">
      <div className="space-y-5">
        {done ? (
          <div className="space-y-4">
            <div className="text-center py-6">
              <CheckCircle2 size={36} className="text-emerald-600 mx-auto mb-3" />
              <p className="text-lg font-semibold text-ink">{done.imported} registrations imported</p>
              {done.skipped > 0 && (
                <p className="text-sm text-muted mt-1">
                  {done.skipped} already had a registration on this form and were left alone.
                </p>
              )}
            </div>

            {done.unmatched.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {done.unmatched.length} row{done.unmatched.length === 1 ? "" : "s"} had no matching account
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  These people are not on Gifted, so there was nobody to attach the registration to.
                  They need an account first, then run the import again.
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto text-xs font-mono text-amber-900 space-y-0.5">
                  {done.unmatched.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              </div>
            )}

            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Export the responses sheet from Google Forms, then match its columns to the questions
              on this form. Rows are attached to accounts by email address.
            </p>

            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl py-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
              {rows ? (
                <>
                  <FileSpreadsheet size={22} className="mx-auto mb-2 text-primary" />
                  <p className="text-sm font-medium text-ink">{fileName}</p>
                  <p className="text-xs text-muted mt-1">{rows.length} rows · tap to pick another file</p>
                </>
              ) : (
                <>
                  <UploadCloud size={22} className="mx-auto mb-2 text-subtle" />
                  <p className="text-sm text-ink font-medium">Choose your responses file</p>
                  <p className="text-xs text-muted mt-1">CSV or Excel</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />

            {rows && (
              <>
                <div>
                  <p className="text-sm font-semibold text-ink mb-1">Match the columns</p>
                  <p className="text-xs text-muted mb-3">
                    We have guessed from the column names. Correct anything wrong, and set which
                    column holds the email address.
                  </p>

                  <div className="border border-border rounded-xl divide-y divide-border max-h-80 overflow-y-auto">
                    {headers.map((h) => (
                      <div key={h} className="px-3 py-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink truncate" title={h}>{h}</p>
                          <p className="text-xs text-subtle truncate">
                            e.g. {String(rows[0][h] ?? "").slice(0, 40) || "(empty)"}
                          </p>
                        </div>
                        <select value={map[h]} onChange={(e) => setMap({ ...map, [h]: e.target.value })}
                          className="shrink-0 w-48 border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary">
                          <option value={SKIP}>Do not import</option>
                          <option value={EMAIL}>Email address (to match)</option>
                          {fields
                            .filter((f) => f.type !== "section" && f.type !== "info")
                            .map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {!emailColumn && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    Pick which column holds the email address. Without it there is no way to tell
                    whose registration each row is.
                  </p>
                )}

                <p className="text-xs text-muted">
                  {rows.length} rows · {mappedCount} question{mappedCount === 1 ? "" : "s"} matched
                  {headers.length - mappedCount - (emailColumn ? 1 : 0) > 0 &&
                    ` · ${headers.length - mappedCount - (emailColumn ? 1 : 0)} column(s) skipped`}
                </p>

                {error && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <div className="flex gap-3 pt-2 border-t border-border">
                  <Button onClick={run} disabled={busy || !emailColumn}>
                    {busy ? <><Loader2 size={13} className="animate-spin" /> Importing...</>
                          : `Import ${rows.length} rows`}
                  </Button>
                  <Button variant="secondary" onClick={onClose}>Cancel</Button>
                </div>
              </>
            )}

            {error && !rows && <p className="text-sm text-danger bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </>
        )}
      </div>
    </SlidePanel>
  );
}
