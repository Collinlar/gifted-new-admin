import assert from "node:assert/strict";
import { answerHasContent, normalizeExamQuestions, questionHasContent } from "../lib/assessmentMedia.ts";

const imageOnly = {
  question: '<img src="question.png" alt="Diagram">',
  answers: ["", ""],
  answerMedia: [[{ url: "answer-a.png" }], [{ url: "answer-b.png" }]],
  correctAnswerIndex: 1,
};

assert.equal(questionHasContent(imageOnly), true);
assert.equal(answerHasContent("", imageOnly.answerMedia[0]), true);

const [normalized] = normalizeExamQuestions([imageOnly]);
assert.equal(normalized.question, "");
assert.deepEqual(normalized.media, [{ url: "question.png", title: undefined, alt: "Diagram" }]);
assert.deepEqual(normalized.answers, ["", ""]);
assert.equal((normalized.answerValues as string[]).length, 2);
assert.notEqual((normalized.answerValues as string[])[0], (normalized.answerValues as string[])[1]);
assert.equal(normalized.correctAnswerIndex, 1);
assert.equal(normalized.correctAnswer, (normalized.answerValues as string[])[1]);

const [legacyText] = normalizeExamQuestions([{
  question: "2 + 2?",
  answers: ["3", "4"],
  correctAnswer: "4",
  correctAnswerIndex: null,
}]);
assert.deepEqual(legacyText.answers, ["3", "4"]);
assert.equal(legacyText.correctAnswerIndex, 1);
assert.equal(legacyText.correctAnswer, "4");

console.log("admin assessment media regression checks passed");
