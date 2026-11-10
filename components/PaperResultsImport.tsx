"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import SlidePanel from "@/components/ui/SlidePanel";
import Button from "@/components/ui/Button";
import api from "@/lib/api";
import { PAPER_FIELDS, PAPER_LABELS, PaperField, PaperRow, guessPaperColumns, mapPaperRow, validatePaperRows } from "@/lib/paperResults";

interface ReviewRow { row: number; reference: string; fullName: string; action: string; error?: string; matches?: string }
interface Review { rows: ReviewRow[]; errors: number; review: string }

export default function PaperResultsImport({ sessionId, published, onClose, onSaved }: {
  sessionId: string; published: boolean; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [filename, setFilename] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [numericCells, setNumericCells] = useState<Record<string, number>[]>([]);
  const [columns, setColumns] = useState(guessPaperColumns([]));
  const [distinct, setDistinct] = useState<Record<number, boolean>>({});
  const [correct, setCorrect] = useState(false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [reviewChanged, setReviewChanged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function selectSheet(book: XLSX.WorkBook, name: string) {
    setReview(null); setDistinct({}); setSheet(name); setError("");
    const fullRange = book.Sheets[name]?.["!fullref"] || book.Sheets[name]?.["!ref"];
    if (fullRange && XLSX.utils.decode_range(fullRange).e.r > 2000) {
      setHeaders([]); setRecords([]); setError("This worksheet exceeds 2,000 data rows. Split it into smaller files before importing."); return;
    }
    const matrix = XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], { header: 1, defval: "", raw: false });
    const raw = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: true });
    const headings = (matrix[0] || []).map(v => String(v).trim());
    if (!headings.length || headings.some(h => !h) || new Set(headings).size !== headings.length) {
      setHeaders([]); setRecords([]); setError("The first row must contain unique, non-empty column headings."); return;
    }
    const included = matrix.slice(1).map((row, i) => ({ row, index: i + 1 }))
      .filter(({ row }) => row.some(v => String(v).trim()));
    const data = included.map(({ row }) => Object.fromEntries(headings.map((h, i) => [h, String(row[i] ?? "").trim()])));
    setNumericCells(included.map(({ index }) => Object.fromEntries(headings.flatMap((h, i) =>
      typeof raw[index]?.[i] === "number" ? [[h, raw[index][i] as number]] : []))));
    setHeaders(headings); setRecords(data); setColumns(guessPaperColumns(headings));
  }
  async function readFile(file?: File) {
    if (!file) return;
    setReview(null); setError(""); setRecords([]); setWorkbook(null); setBusy(true);
    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("Choose an Excel or CSV file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Keep each upload below 5 MB.");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: 2002 });
      setFilename(file.name); setWorkbook(book); selectSheet(book, book.SheetNames[0]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read that spreadsheet."); }
    finally { setBusy(false); }
  }
  function template() {
    const book = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([PAPER_FIELDS.map(f => PAPER_LABELS[f])]);
    ws["!cols"] = PAPER_FIELDS.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(book, ws, "Paper results");
    XLSX.writeFile(book, "gifted-paper-results-template.xlsx");
  }
  function mappedRows(): PaperRow[] {
    return records.map((record, i) => mapPaperRow(record, numericCells[i] || {}, columns, !!distinct[i]));
  }
  async function send(commit = false) {
    setError("");
    const rows = mappedRows();
    const validation = validatePaperRows(rows);
    if (validation) { setError(validation); return; }
    setBusy(true);
    try {
      const res = await api.post("/import-paper-results", {
        sessionId, rows, filename, correct, reason, commit, review: review?.review,
      }, { timeout: 60000 });
      if (commit) {
        onSaved(`Paper results saved: ${res.data.added} added, ${res.data.updated} corrected, ${res.data.skipped} unchanged. Print slips to distribute result-access credentials.`);
      } else { setReview(res.data); setReviewChanged(false); }
    } catch (e) {
      setReview(null);
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ||
        "Could not confirm the import. Review the file again before retrying; unchanged references will be skipped.");
    } finally { setBusy(false); }
  }
  const previewRows = mappedRows();
  const ready = records.length > 0 && ["reference", "fullName", "score", "maximum"].every(f => columns[f as PaperField]);
  return <SlidePanel open onClose={() => { if (!busy) onClose(); }} title="Import paper-based results" width="lg">
    <div className="space-y-5 text-sm">
      <p>Import marked papers into this sitting. Use a stable candidate reference each time. Marks may include up to two decimal places. School and grade are optional.</p>
      {published && <p className="text-amber-800 bg-amber-50 p-3">Results are already published. Withdraw results before adding or correcting records, then publish the combined results again.</p>}
      <Button variant="secondary" onClick={template}>Download spreadsheet template</Button>
      <label className="block font-medium">Results spreadsheet
        <input className="block mt-2 w-full" type="file" accept=".xlsx,.xls,.csv" disabled={busy}
          onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      <p className="text-muted">Up to 2,000 candidates and 5 MB per upload. Keep references formatted as text to preserve leading zeros.</p>
      {workbook && <label className="block">Worksheet
        <select className="block w-full border p-2 mt-1" value={sheet} disabled={busy}
          onChange={e => selectSheet(workbook, e.target.value)}>
          {workbook.SheetNames.map(name => <option key={name}>{name}</option>)}
        </select>
      </label>}
      {headers.length > 0 && <>
        <p>{records.length} rows found. Match the spreadsheet columns below.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PAPER_FIELDS.map(field => <label key={field}>{PAPER_LABELS[field]}
            <select className="block w-full border p-2 mt-1" disabled={busy} value={columns[field]}
              onChange={e => { setColumns({ ...columns, [field]: e.target.value }); setReview(null); setDistinct({}); }}>
              <option value="">Choose column</option>
              {headers.map(h => <option key={h}>{h}</option>)}
            </select>
          </label>)}
        </div>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={correct} disabled={busy}
          onChange={e => { setCorrect(e.target.checked); setReview(null); }} /> Correct existing paper records with matching references</label>
        {correct && <label className="block">Reason for corrections
          <textarea className="block w-full border p-2 mt-1" value={reason} maxLength={2000} disabled={busy}
            onChange={e => { setReason(e.target.value); setReview(null); }} />
        </label>}
        <p className="text-muted">Changed records with active certificates require those certificates to be withdrawn first. Online results cannot be overwritten.</p>
        <Button disabled={!ready || busy} onClick={() => send()}>{busy ? "Checking paper results..." : "Review paper results"}</Button>
      </>}
      {review && <div className="space-y-3">
        <p className="font-medium">{review.rows.filter(r => r.action === "add").length} new, {review.rows.filter(r => r.action === "update").length} corrections, {review.rows.filter(r => r.action === "skip").length} unchanged. {review.errors} rows need attention.</p>
        <div className="max-h-96 overflow-y-auto divide-y border rounded">
          {review.rows.map(r => <div key={r.row} className="p-3 space-y-1">
            <p className="font-medium">{r.fullName} · {r.reference} · {r.action}</p>
            <p className="text-muted">School: {previewRows[r.row - 1]?.school || "Not supplied"} · Grade: {previewRows[r.row - 1]?.grade || "Not supplied"}</p>
            <p>{previewRows[r.row - 1]?.score} / {previewRows[r.row - 1]?.maximum} marks</p>
            {r.error && <p className="text-danger">{r.error}</p>}
            {r.matches && <><p className="text-muted">Possible match: {r.matches}</p>
              <label className="flex items-start gap-2"><input type="checkbox" disabled={busy}
                checked={!!distinct[r.row - 1]} onChange={e => {
                  setDistinct({ ...distinct, [r.row - 1]: e.target.checked });
                  setReviewChanged(true);
                }} /> I checked: this is a different person. Review again to apply.</label></>}
          </div>)}
        </div>
        <p>Paper candidates follow this sitting’s certificate rules. With certificates set to “As each candidate submits”, eligible certificates are issued during import.</p>
        {reviewChanged && <p className="text-amber-800">Duplicate decisions changed. Select Review paper results to validate them.</p>}
        <Button disabled={busy || review.errors > 0 || reviewChanged} onClick={() => send(true)}>{busy ? "Saving paper results..." : "Import reviewed results"}</Button>
      </div>}
      {error && <p role="alert" className="text-danger bg-red-50 p-3">{error}</p>}
    </div>
  </SlidePanel>;
}
