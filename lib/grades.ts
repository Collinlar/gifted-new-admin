// The one grade system. Kept in step with gifted-project/src/lib/grades.js,
// where it is defined and commented. Change both or neither.
//
// Content has always been tagged with a number: exams.grade is an integer[]
// of 1 to 12, courses.grade holds "1" to "12". The user side had drifted into
// five different formats in one column, so a student who signed up as "JHS 1"
// matched nothing and saw an empty track. This file is the single definition
// both sides now read.
//
// A grade is an integer 1 to 12. It is displayed with the Ghanaian stage
// beside it, because students and parents think in Class, JHS and SHS, and
// because "Grade 7 (JHS 1)" is the convention 820 of the backfilled rows
// already used.

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/**
 * Any legacy value to a grade number, or null when it cannot be known.
 *
 * Order matters and is the whole point of this function. "SHS 3" is Grade 12,
 * not Grade 3. Reaching for the first number in the string, which is the
 * obvious implementation, moves 46 real secondary students into primary
 * school. Every branch below was checked against all 50 distinct values in
 * the users table.
 */
export function parseGrade(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return inRange(raw)

  const s = String(raw).trim()
  if (!s) return null

  // "Grade 12 (SHS 3)" and "Grade 4 (Class 4)": the Grade number is
  // authoritative and already correct, so it is read before anything else.
  let m = s.match(/grade\s*(\d{1,2})/i)
  if (m) return inRange(+m[1])

  // SHS 1 to 3 are Grades 10 to 12
  m = s.match(/\bshs\s*(\d)/i)
  if (m) { const n = +m[1]; return n >= 1 && n <= 3 ? n + 9 : null }

  // JHS 1 to 3 are Grades 7 to 9
  m = s.match(/\bjhs\s*(\d)/i)
  if (m) { const n = +m[1]; return n >= 1 && n <= 3 ? n + 6 : null }

  // Basic N, Class N and Primary N are already the grade number
  m = s.match(/\b(?:basic|class|primary)\s*(\d{1,2})/i)
  if (m) return inRange(+m[1])

  // A bare number and nothing else. Anchored on purpose: "Level 400" and
  // "10-12" are not grades and must fall through to the prompt rather than
  // be guessed at.
  m = s.match(/^(\d{1,2})$/)
  if (m) return inRange(+m[1])

  return null
}

function inRange(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}

/** The Ghanaian stage for a grade: Class 1 to 6, JHS 1 to 3, SHS 1 to 3. */
export function gradeStage(n: unknown): string {
  const g = parseGrade(n)
  if (!g) return ''
  if (g <= 6) return `Class ${g}`
  if (g <= 9) return `JHS ${g - 6}`
  return `SHS ${g - 9}`
}

/** "Grade 7 (JHS 1)". What a student should see. */
export function gradeLabel(n: unknown): string {
  const g = parseGrade(n)
  if (!g) return ''
  return `Grade ${g} (${gradeStage(g)})`
}

/** "Grade 7". For tight spaces such as table cells and cards. */
export function gradeShort(n: unknown): string {
  const g = parseGrade(n)
  return g ? `Grade ${g}` : ''
}

/** Options for a select, in school order. */
export const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))

/**
 * Does a piece of content belong to this student?
 *
 * Content with no grade tag is for everybody, and a student whose grade we do
 * not know yet sees everything rather than nothing. That second rule is what
 * keeps the 5,086 users with no usable grade from staring at an empty page
 * while they wait to be asked.
 */
export function matchesGrade(userGrade: unknown, contentGrade: unknown): boolean {
  const mine = parseGrade(userGrade)
  if (!mine) return true

  const raw = Array.isArray(contentGrade) ? contentGrade : contentGrade == null ? [] : [contentGrade]
  const tagged = raw.map(parseGrade).filter(Boolean)
  if (tagged.length === 0) return true

  return tagged.includes(mine)
}
