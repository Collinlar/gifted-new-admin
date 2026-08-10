import * as XLSX from "xlsx";

// ── Sheet contract ─────────────────────────────────────────────────────────
// One row per question. Flat columns rather than nested JSON, because the
// people preparing these files work in Excel, not a code editor.

export const COLUMNS = [
  "question", "option_a", "option_b", "option_c", "option_d", "option_e",
  "correct", "explanation", "image_url", "image_title",
] as const;

const LETTERS = ["A", "B", "C", "D", "E"] as const;

export interface ParsedQuestion {
  rowNumber: number;      // 1-based spreadsheet row, for error messages
  question: string;
  rawOptions: string[];   // five slots, blanks preserved so letters stay aligned
  correctLetter: string;  // A to E
  explanation: string;
  image: string;
  imageTitle: string;     // caption printed under the picture, also its alt text
  errors: string[];       // blocking: row cannot be imported
  warnings: string[];     // non-blocking: worth a look
  skip: boolean;          // excluded by the user
}

export function downloadTemplate() {
  const sample = [
    {
      question: "What is the value of 7 × 8?",
      option_a: "48", option_b: "54", option_c: "56", option_d: "64", option_e: "",
      correct: "C",
      explanation: "7 × 8 = 56",
      image_url: "",
      image_title: "",
    },
    {
      question: "The factor tree of 2023 is shown below. How many whole numbers divide it?",
      option_a: "3", option_b: "5", option_c: "6", option_d: "8", option_e: "",
      correct: "C",
      explanation: "2023 = 7 × 17 × 17, giving six divisors.",
      image_url: "https://example.com/factor-tree.png",
      image_title: "Figure 1: the factor tree of 2023",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sample, { header: COLUMNS as unknown as string[] });
  ws["!cols"] = [
    { wch: 52 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    { wch: 9 }, { wch: 40 }, { wch: 30 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  XLSX.writeFile(wb, "gifted-question-template.xlsx");
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export async function parseQuestionFile(file: File): Promise<ParsedQuestion[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  // Tolerate header casing and spacing differences, since these files are
  // often edited by hand before they reach us.
  const normaliseKey = (k: string) => k.toLowerCase().replace(/[\s-]+/g, "_").trim();

  const seen = new Map<string, number>();

  return raw.map((rowRaw, i) => {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rowRaw)) row[normaliseKey(k)] = v;

    const rowNumber = i + 2; // +1 for zero index, +1 for the header row
    const question = str(row.question);
    const rawOptions = LETTERS.map((L) => str(row[`option_${L.toLowerCase()}`]));
    const correctLetter = str(row.correct).toUpperCase().slice(0, 1);
    const explanation = str(row.explanation);
    // Files in the wild head this column "Image", "image url" or "image_url",
    // and silently dropping the pictures is worse than accepting all three.
    const image = str(row.image_url ?? row.image ?? row.imageurl ?? row.image_link);
    const imageTitle = str(row.image_title ?? row.image_caption ?? row.imagetitle);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!question) errors.push("Question text is empty");

    if (rawOptions.filter(Boolean).length < 2) errors.push("Needs at least two answer options");

    if (!correctLetter) {
      errors.push("No correct answer given");
    } else if (!LETTERS.includes(correctLetter as typeof LETTERS[number])) {
      errors.push(`Correct answer must be a letter from A to E, got "${str(row.correct)}"`);
    } else {
      const idx = LETTERS.indexOf(correctLetter as typeof LETTERS[number]);
      if (!rawOptions[idx]) errors.push(`Correct answer is ${correctLetter}, but option ${correctLetter} is blank`);
    }

    // Trailing blanks are fine. A gap in the middle usually means a mistake.
    const lastFilled = rawOptions.reduce((acc, o, idx) => (o ? idx : acc), -1);
    for (let idx = 0; idx < lastFilled; idx++) {
      if (!rawOptions[idx]) { warnings.push(`Option ${LETTERS[idx]} is blank but later options are filled`); break; }
    }

    if (question) {
      const key = question.toLowerCase().replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      const prev = seen.get(key);
      if (prev) warnings.push(`Same question text as row ${prev}`);
      else seen.set(key, rowNumber);
    }

    if (image && !/^https?:\/\//i.test(image)) {
      warnings.push("Image link does not start with http, it may not load");
    }

    return {
      rowNumber, question, rawOptions, correctLetter, explanation, image, imageTitle,
      errors, warnings, skip: errors.length > 0,
    };
  });
}

// Convert to the shape the exams table already stores.
export function toExamQuestions(rows: ParsedQuestion[]) {
  return rows
    .filter((r) => !r.skip && r.errors.length === 0)
    .map((r) => {
      // Resolve the correct answer against the lettered slot BEFORE dropping
      // blanks, otherwise a gap in the middle of the options shifts the answer
      // onto the wrong choice.
      const idx = LETTERS.indexOf(r.correctLetter as typeof LETTERS[number]);
      return {
        question: r.question,
        answers: r.rawOptions.filter(Boolean),
        correctAnswer: r.rawOptions[idx] ?? "",
        explanation: r.explanation,
        image: r.image,
        imageTitle: r.imageTitle,
      };
    });
}
