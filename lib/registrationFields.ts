// The shared field vocabulary.
//
// Prefill only works when forms agree on names. If one form calls it
// `parent_phone` and the next calls it `guardian_number`, the second form asks
// a question the platform already knew the answer to, and the whole point is
// lost.
//
// So the builder offers these first and treats a custom key as the exception.

export type FieldType =
  | "text" | "textarea" | "email" | "tel" | "number" | "date"
  | "select" | "multiselect" | "checkbox" | "file" | "section" | "info";

export interface FormField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Prefills from the user's profile, e.g. "profile.school_name". */
  source?: string | null;
  /** Feed this answer into memory so later forms arrive filled in. */
  remember?: boolean;
  /** Half width on the grid. */
  half?: boolean;
}

export interface StandardField {
  key: string;
  label: string;
  type: FieldType;
  source?: string;
  remember?: boolean;
  options?: string[];
  placeholder?: string;
  half?: boolean;
  group: string;
}

export const GRADES = ["JHS 1", "JHS 2", "JHS 3", "SHS 1", "SHS 2", "SHS 3"];

// Fields sourced from the profile are answered before the student sees them.
// Fields marked remember are answered once, ever.
export const STANDARD_FIELDS: StandardField[] = [
  // Already on file — these should never be typed again
  { group: "Already known", key: "first_name",    label: "First name",     type: "text",  source: "profile.first_name",    half: true },
  { group: "Already known", key: "last_name",     label: "Last name",      type: "text",  source: "profile.last_name",     half: true },
  { group: "Already known", key: "email",         label: "Email",          type: "email", source: "profile.email" },
  { group: "Already known", key: "mobile_number", label: "Phone",          type: "tel",   source: "profile.mobile_number", half: true },
  { group: "Already known", key: "date_of_birth", label: "Date of birth",  type: "date",  source: "profile.date_of_birth", half: true },
  { group: "Already known", key: "gender",        label: "Gender",         type: "select", source: "profile.gender", half: true,
    options: ["Prefer not to say", "Female", "Male"] },
  { group: "Already known", key: "country",       label: "Country",        type: "select", source: "profile.country", half: true,
    options: ["Ghana", "Nigeria", "Kenya", "Other"] },
  { group: "Already known", key: "school_name",   label: "School",         type: "text",  source: "profile.school_name", remember: true },
  { group: "Already known", key: "grade",         label: "Grade",          type: "select", source: "profile.grade", remember: true, half: true, options: GRADES },

  // Asked once, then remembered across every future form
  { group: "Asked once",  key: "parent_name",       label: "Parent or guardian name",  type: "text", remember: true, half: true },
  { group: "Asked once",  key: "parent_phone",      label: "Parent or guardian phone", type: "tel",  remember: true, half: true },
  { group: "Asked once",  key: "parent_email",      label: "Parent or guardian email", type: "email", remember: true },
  { group: "Asked once",  key: "emergency_contact", label: "Emergency contact",        type: "tel",  remember: true, half: true },
  { group: "Asked once",  key: "school_contact",    label: "School contact number",    type: "tel",  remember: true, half: true },
  { group: "Asked once",  key: "region",            label: "Region",                   type: "select", remember: true, half: true,
    options: ["Greater Accra","Ashanti","Western","Eastern","Central","Volta","Northern","Upper East","Upper West","Bono","Ahafo","Bono East","Oti","Savannah","North East","Western North"] },
  { group: "Asked once",  key: "dietary_needs",     label: "Dietary requirements",     type: "text", remember: true },
  { group: "Asked once",  key: "medical_notes",     label: "Medical notes we should know", type: "textarea", remember: true },
  { group: "Asked once",  key: "t_shirt_size",      label: "T-shirt size",             type: "select", remember: true, half: true,
    options: ["XS","S","M","L","XL","XXL"] },

  // Genuinely per programme
  { group: "This programme", key: "category",           label: "Category entering",        type: "select", options: [], half: true },
  { group: "This programme", key: "previous_olympiads", label: "Olympiads entered before", type: "textarea" },
  { group: "This programme", key: "teacher_name",       label: "Teacher supporting entry", type: "text", half: true },
  { group: "This programme", key: "how_did_you_hear",   label: "How did you hear about this?", type: "select", half: true,
    options: ["School", "A teacher", "Social media", "A friend", "Gifted platform", "Other"] },
  { group: "This programme", key: "consent_parent",     label: "Parent or guardian consents to this entry", type: "checkbox" },
  { group: "This programme", key: "consent_media",      label: "Happy for photos to be used in programme material", type: "checkbox" },
  { group: "This programme", key: "supporting_document",label: "Supporting document",      type: "file" },
  { group: "This programme", key: "notes",              label: "Anything else we should know", type: "textarea" },
];

export const FIELD_GROUPS = ["Already known", "Asked once", "This programme"];

export const TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text", textarea: "Long text", email: "Email", tel: "Phone",
  number: "Number", date: "Date", select: "Choose one", multiselect: "Choose several",
  checkbox: "Tick box", file: "File upload", section: "Section heading", info: "Note",
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export function fieldFromStandard(s: StandardField): FormField {
  return {
    id: uid(),
    key: s.key,
    label: s.label,
    type: s.type,
    required: false,
    options: s.options ? [...s.options] : undefined,
    source: s.source || null,
    remember: !!s.remember,
    half: !!s.half,
  };
}

// How much of this form the platform can answer on the student's behalf. This
// is the number that tells you whether a form is actually short.
export function prefillableCount(fields: FormField[]): number {
  return fields.filter((f) => f.source || f.remember).length;
}
