export interface AssessmentMedia {
  url: string;
  title?: string;
  alt?: string;
}

const MEDIA_OPTION_VALUE = "__assessment_media_option_";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeMedia(value: unknown): AssessmentMedia[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const out: AssessmentMedia[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const media = typeof item === "string"
      ? { url: item.trim() }
      : item && typeof item === "object"
        ? {
            url: text((item as Record<string, unknown>).url || (item as Record<string, unknown>).src),
            title: text((item as Record<string, unknown>).title || (item as Record<string, unknown>).caption) || undefined,
            alt: text((item as Record<string, unknown>).alt) || undefined,
          }
        : { url: "" };
    if (!media.url || seen.has(media.url)) continue;
    seen.add(media.url);
    out.push(media);
  }
  return out;
}

function attr(tag: string, name: string): string {
  const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2].trim();
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]?.trim() || "";
}

/** Pull legacy img tags out of rich text so markup never appears as answer text. */
export function splitLegacyImages(value: unknown): { content: string; media: AssessmentMedia[] } {
  let content = text(value);
  // Some imports escaped the tag itself, which is why learners saw HTML code.
  content = content.replace(/&lt;(img\b[\s\S]*?)&gt;/gi, "<$1>");
  const media: AssessmentMedia[] = [];
  content = content.replace(/<img\b[^>]*>/gi, (tag) => {
    const url = attr(tag, "src");
    if (url) media.push({
      url,
      title: attr(tag, "title") || undefined,
      alt: attr(tag, "alt") || undefined,
    });
    return "";
  });
  return { content: content.trim(), media: normalizeMedia(media) };
}

export function questionMedia(question: Record<string, unknown>): AssessmentMedia[] {
  return normalizeMedia([
    ...normalizeMedia(question.media || question.images),
    ...(text(question.image) ? [{ url: text(question.image), title: text(question.imageTitle) || undefined }] : []),
  ]);
}

export function answerMedia(question: Record<string, unknown>, count: number): AssessmentMedia[][] {
  const raw = Array.isArray(question.answerMedia) ? question.answerMedia :
    Array.isArray(question.answerImages) ? question.answerImages : [];
  return Array.from({ length: count }, (_, index) => normalizeMedia(raw[index]));
}

export function questionHasContent(question: Record<string, unknown>): boolean {
  const prompt = splitLegacyImages(question.question);
  return !!prompt.content || prompt.media.length > 0 || questionMedia(question).length > 0;
}

export function answerHasContent(textValue: unknown, mediaValue: unknown): boolean {
  const answer = splitLegacyImages(textValue);
  return !!answer.content || answer.media.length > 0 || normalizeMedia(mediaValue).length > 0;
}

export function normalizeExamQuestions(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const question = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
    const prompt = splitLegacyImages(question.question);
    const originalAnswers = Array.isArray(question.answers) ? question.answers.map((a) => String(a ?? "")) : [];
    const originalAnswerMedia = answerMedia(question, originalAnswers.length);
    const existingValues = Array.isArray(question.answerValues) && question.answerValues.length === originalAnswers.length
      ? question.answerValues.map((value) => String(value ?? "")) : originalAnswers;
    const prepared = originalAnswers.map((answer, index) => {
      const clean = splitLegacyImages(answer);
      const media = normalizeMedia([...originalAnswerMedia[index], ...clean.media]);
      return { answer: clean.content, media, previousValue: existingValues[index], original: answer, originalIndex: index };
    }).filter((item) => !!item.answer || item.media.length > 0);
    const cleanedAnswers = prepared.map((item) => item.answer);
    const storedCorrectIndex = question.correctAnswerIndex;
    const existingCorrectIndex = storedCorrectIndex === null || storedCorrectIndex === undefined || storedCorrectIndex === ""
      ? Number.NaN : Number(storedCorrectIndex);
    const rawCorrect = String(question.correctValue ?? question.correctAnswer ?? "");
    let correctIndex = Number.isInteger(existingCorrectIndex) && existingCorrectIndex >= 0
      ? prepared.findIndex((item) => item.originalIndex === existingCorrectIndex)
      : prepared.findIndex((item) => item.original === rawCorrect || item.previousValue === rawCorrect);
    if (correctIndex < 0 && prepared.length === 1) correctIndex = 0;
    const values = prepared.map((item, index) => item.answer ||
      (item.previousValue.startsWith(MEDIA_OPTION_VALUE) ? item.previousValue : `${MEDIA_OPTION_VALUE}${index + 1}__`));
    const media = normalizeMedia([...questionMedia(question), ...prompt.media]);
    const first = media[0];
    return {
      ...question,
      question: prompt.content,
      answers: cleanedAnswers,
      answerValues: values,
      correctAnswerIndex: correctIndex,
      correctAnswer: correctIndex >= 0 ? values[correctIndex] : rawCorrect,
      correctValue: correctIndex >= 0 ? values[correctIndex] : rawCorrect,
      media,
      answerMedia: prepared.map((item) => item.media),
      // Backwards compatibility for clients that have not yet moved to arrays.
      image: first?.url || "",
      imageTitle: first?.title || first?.alt || "",
    };
  });
}
