export const PAPER_FIELDS = ["reference", "fullName", "school", "grade", "score", "maximum"] as const;
export type PaperField = typeof PAPER_FIELDS[number];
export type PaperRow = Record<PaperField, string> & { distinct?: boolean };
export const PAPER_LABELS: Record<PaperField, string> = {
  reference: "Candidate reference", fullName: "Full name", school: "School",
  grade: "Grade / class", score: "Marks earned", maximum: "Maximum marks",
};
const aliases: Record<PaperField, string[]> = {
  reference: ["reference", "candidatereference", "candidateid", "indexnumber", "accesscode"],
  fullName: ["fullname", "name", "candidatename"], school: ["school", "schoolname"],
  grade: ["grade", "class", "gradeclass"], score: ["score", "marksearned", "marks"],
  maximum: ["maximum", "maximummarks", "outof", "totalquestions", "total"],
};
export function guessPaperColumns(headers: string[]): Record<PaperField, string> {
  return Object.fromEntries(PAPER_FIELDS.map(field => [field, headers.find(h =>
    aliases[field].includes(h.toLowerCase().replace(/[^a-z0-9]/g, ""))) || ""])) as Record<PaperField, string>;
}
export function mapPaperRow(record: Record<string, string>, numericCells: Record<string, number>, columns: Record<PaperField, string>, distinct = false): PaperRow {
  return { ...Object.fromEntries(PAPER_FIELDS.map(field => {
    const numeric = numericCells[columns[field]];
    // Marks use the stored number, not a rounded Excel display format.
    // References use displayed text so formats such as 000123 survive.
    return [field, (field === "score" || field === "maximum") && typeof numeric === "number"
      ? String(numeric) : record[columns[field]] || ""];
  })), distinct } as PaperRow;
}
export function validatePaperRows(value: unknown): string | null {
  if (!Array.isArray(value) || !value.length || value.length > 2000) return "Upload between 1 and 2,000 candidates per batch.";
  const refs = new Set<string>();
  for (const [i, row] of value.entries()) {
    const at = `Row ${i + 2}: `;
    if (!row || typeof row !== "object") return at + "Candidate details are missing.";
    for (const key of PAPER_FIELDS) {
      if (typeof row[key] !== "string" || row[key].length > 200) return at + `${PAPER_LABELS[key]} must be text of at most 200 characters.`;
    }
    const ref = row.reference.trim().toUpperCase();
    if (!ref || !row.fullName.trim()) return at + "Candidate reference and full name are required.";
    if (refs.has(ref)) return at + `Reference ${ref} appears more than once.`;
    refs.add(ref);
    if (![row.score, row.maximum].every(v => /^\d+(\.\d{1,2})?$/.test(v.trim()))) return at + "Use numeric marks with up to two decimal places.";
    const score = Number(row.score), maximum = Number(row.maximum);
    if (maximum <= 0 || maximum > 1000000 || score > maximum) return at + "Maximum marks must be positive (up to 1,000,000), and marks earned must be between zero and the maximum.";
    if (row.distinct !== undefined && typeof row.distinct !== "boolean") return at + "Invalid duplicate review.";
  }
  return null;
}
