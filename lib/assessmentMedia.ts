export interface AssessmentMedia {
  url: string;
  title?: string;
  alt?: string;
}

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

export function normalizeExamQuestions(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const question = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
    const prompt = splitLegacyImages(question.question);
    const originalAnswers = Array.isArray(question.answers) ? question.answers.map((a) => String(a ?? "")) : [];
    const correctIndex = originalAnswers.findIndex((answer) => answer === String(question.correctAnswer ?? ""));
    const existingAnswerMedia = answerMedia(question, originalAnswers.length);
    const cleanedAnswers = originalAnswers.map((answer, index) => {
      const clean = splitLegacyImages(answer);
      existingAnswerMedia[index] = normalizeMedia([...existingAnswerMedia[index], ...clean.media]);
      return clean.content;
    });
    const media = normalizeMedia([...questionMedia(question), ...prompt.media]);
    const first = media[0];
    return {
      ...question,
      question: prompt.content,
      answers: cleanedAnswers,
      correctAnswer: correctIndex >= 0 ? cleanedAnswers[correctIndex] : text(question.correctAnswer),
      media,
      answerMedia: existingAnswerMedia,
      // Backwards compatibility for clients that have not yet moved to arrays.
      image: first?.url || "",
      imageTitle: first?.title || first?.alt || "",
    };
  });
}
