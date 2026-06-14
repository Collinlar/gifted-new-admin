"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import MathEditor from "@/components/ui/MathEditor";
import api from "@/lib/api";
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

const GRADES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const DIFFICULTIES = ["Easy", "Medium", "Hard", "Expert"];
const PROGRAMS = ["Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "General Science", "English", "History"];

interface Answer {
  text: string;
  isCorrect: boolean;
}

interface Question {
  question: string;
  answers: Answer[];
  explanation: string;
  image?: string;
  expanded: boolean;
}

const blankQuestion = (): Question => ({
  question: "",
  answers: [
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
  ],
  explanation: "",
  image: "",
  expanded: true,
});

export default function AddQuizPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Meta fields
  const [title, setTitle] = useState("");
  const [examMode, setExamMode] = useState("quiz");
  const [contest, setContest] = useState(false);
  const [instructor, setInstructor] = useState("");
  const [level, setLevel] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState<string[]>([""]);
  const [timeLimit, setTimeLimit] = useState("");
  const [numQuestions, setNumQuestions] = useState("");
  const [grades, setGrades] = useState<string[]>([]);
  const [program, setProgram] = useState("");
  const [featured, setFeatured] = useState(false);
  const [published, setPublished] = useState(false);
  const [attemptsAllowed, setAttemptsAllowed] = useState("1");
  const [allowReview, setAllowReview] = useState(false);
  const [displayScores, setDisplayScores] = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [tags, setTags] = useState("");
  const [features, setFeatures] = useState("");

  // Questions
  const [questions, setQuestions] = useState<Question[]>([blankQuestion()]);

  const toggleGrade = (g: string) => {
    setGrades((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  };

  const addInstruction = () => setInstructions([...instructions, ""]);
  const updateInstruction = (i: number, val: string) => {
    const u = [...instructions]; u[i] = val; setInstructions(u);
  };
  const removeInstruction = (i: number) => setInstructions(instructions.filter((_, idx) => idx !== i));

  const addQuestion = () => setQuestions([...questions, blankQuestion()]);
  const removeQuestion = (i: number) => setQuestions(questions.filter((_, idx) => idx !== i));
  const toggleQuestion = (i: number) => {
    const u = [...questions]; u[i] = { ...u[i], expanded: !u[i].expanded }; setQuestions(u);
  };

  const updateQuestion = (qi: number, field: string, val: string) => {
    const u = [...questions]; u[qi] = { ...u[qi], [field]: val }; setQuestions(u);
  };

  const updateAnswer = (qi: number, ai: number, text: string) => {
    const u = [...questions];
    u[qi].answers[ai] = { ...u[qi].answers[ai], text };
    setQuestions(u);
  };

  const setCorrectAnswer = (qi: number, ai: number) => {
    const u = [...questions];
    u[qi].answers = u[qi].answers.map((a, idx) => ({ ...a, isCorrect: idx === ai }));
    setQuestions(u);
  };

  const handleSave = async () => {
    setError("");
    if (!title.trim()) return setError("Give this quiz a title.");
    const validQs = questions.filter((q) => q.question.trim());
    if (validQs.length === 0) return setError("Add at least one question.");

    setSaving(true);
    try {
      const payload = {
        title,
        examMode,
        contest,
        instructor,
        level,
        difficulty,
        description,
        instructions: instructions.filter(Boolean),
        duration: timeLimit ? Number(timeLimit) : undefined,
        numberOfQuestions: numQuestions ? Number(numQuestions) : undefined,
        grade: grades,
        program,
        featured,
        published,
        attemptsAllowed: Number(attemptsAllowed) || 1,
        allowReview,
        displayScores,
        showFeedback,
        shuffleQuestions,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        features: features.split(",").map((f) => f.trim()).filter(Boolean),
        questions: validQs.map((q) => ({
          question: q.question,
          answers: q.answers.map((a) => a.text).filter(Boolean),
          correctAnswer: q.answers.find((a) => a.isCorrect)?.text || q.answers.filter(Boolean)[0]?.text || "",
          explanation: q.explanation,
          image: q.image,
        })),
      };
      await api.post("/add-exam", payload);
      router.push("/assessment");
    } catch {
      setError("Could not save the quiz. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGuard>
      <DashboardShell title="Create Quiz">
        <div className="space-y-6 max-w-3xl pb-16">
          <Button variant="ghost" size="sm" onClick={() => router.push("/assessment")}>
            <ArrowLeft size={14} /> Back to quizzes
          </Button>

          {/* Basic Info */}
          <Card title="Basic information">
            <div className="space-y-4">
              <Input label="Quiz title" placeholder="e.g. Grade 10 Mathematics Challenge" value={title} onChange={(e) => setTitle(e.target.value)} />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Exam mode</label>
                  <select value={examMode} onChange={(e) => setExamMode(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="quiz">Quiz</option>
                    <option value="exam">Exam</option>
                    <option value="practice">Practice</option>
                  </select>
                </div>
                <Input label="Instructor" placeholder="Instructor name" value={instructor} onChange={(e) => setInstructor(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Level</label>
                  <select value={level} onChange={(e) => setLevel(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="">Select level</option>
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Difficulty</label>
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="">Select difficulty</option>
                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-ink">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                  placeholder="Brief description of this quiz..."
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary resize-none" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-ink">Instructions</label>
                  <button type="button" onClick={addInstruction} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Plus size={12} /> Add instruction
                  </button>
                </div>
                {instructions.map((inst, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={inst} onChange={(e) => updateInstruction(i, e.target.value)}
                      placeholder={`Instruction ${i + 1}`}
                      className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
                    {instructions.length > 1 && (
                      <button onClick={() => removeInstruction(i)} className="p-2 text-subtle hover:text-danger rounded-lg">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Settings */}
          <Card title="Settings">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="Time limit (minutes)" type="number" placeholder="e.g. 60" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
                <Input label="Number of questions" type="number" placeholder="e.g. 20" value={numQuestions} onChange={(e) => setNumQuestions(e.target.value)} />
                <Input label="Attempts allowed" type="number" placeholder="1" value={attemptsAllowed} onChange={(e) => setAttemptsAllowed(e.target.value)} />
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Program</label>
                  <select value={program} onChange={(e) => setProgram(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary">
                    <option value="">Select program</option>
                    {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
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

              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {[
                  { label: "Use as contest", value: contest, set: setContest },
                  { label: "Feature this quiz", value: featured, set: setFeatured },
                  { label: "Publish this quiz", value: published, set: setPublished },
                  { label: "Allow review after completion", value: allowReview, set: setAllowReview },
                  { label: "Display scores after submission", value: displayScores, set: setDisplayScores },
                  { label: "Show feedback form after quiz", value: showFeedback, set: setShowFeedback },
                  { label: "Shuffle questions", value: shuffleQuestions, set: setShuffleQuestions },
                ].map(({ label, value, set }) => (
                  <label key={label} className="flex items-center gap-2.5 cursor-pointer select-none">
                    <div onClick={() => set(!value)}
                      className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${value ? "bg-primary" : "bg-border"}`}>
                      <span className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`} />
                    </div>
                    <span className="text-sm text-ink">{label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Tags <span className="text-muted font-normal">(comma-separated)</span></label>
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="math, algebra, grade10"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-ink">Features <span className="text-muted font-normal">(comma-separated)</span></label>
                  <input value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="timed, adaptive, review"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary" />
                </div>
              </div>
            </div>
          </Card>

          {/* Questions */}
          <Card
            title={`Questions (${questions.length})`}
            action={
              <Button size="sm" onClick={addQuestion}><Plus size={13} /> Add question</Button>
            }
          >
            <div className="space-y-4">
              {questions.map((q, qi) => (
                <div key={qi} className="border border-border rounded-xl overflow-hidden">
                  {/* Question header */}
                  <div className="bg-surface px-4 py-3 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => toggleQuestion(qi)}
                      className="flex items-center gap-2 flex-1 text-left">
                      {q.expanded ? <ChevronUp size={14} className="text-muted shrink-0" /> : <ChevronDown size={14} className="text-muted shrink-0" />}
                      <span className="text-sm font-medium text-ink">
                        Question {qi + 1}
                        {q.question && <span className="font-normal text-muted ml-2 truncate max-w-xs inline-block align-bottom">
                          — {q.question.replace(/<[^>]+>/g, "").slice(0, 60)}{q.question.length > 60 ? "..." : ""}
                        </span>}
                      </span>
                    </button>
                    {questions.length > 1 && (
                      <button onClick={() => removeQuestion(qi)} className="p-1.5 text-subtle hover:text-danger rounded-lg transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  {q.expanded && (
                    <div className="p-4 space-y-4">
                      {/* Question text with MathEditor */}
                      <MathEditor
                        label="Question text"
                        value={q.question}
                        onChange={(val) => updateQuestion(qi, "question", val)}
                        placeholder="Type the question..."
                        rows={3}
                      />

                      {/* Answer options */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-ink">Answer options <span className="text-muted font-normal text-xs">(click the circle to mark correct)</span></label>
                        {q.answers.map((ans, ai) => (
                          <div key={ai} className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => setCorrectAnswer(qi, ai)}
                              className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${ans.isCorrect ? "border-primary bg-primary" : "border-border hover:border-primary/50"}`}
                            >
                              {ans.isCorrect && <span className="w-2 h-2 rounded-full bg-white" />}
                            </button>
                            <div className="flex-1">
                              <MathEditor
                                value={ans.text}
                                onChange={(val) => updateAnswer(qi, ai, val)}
                                placeholder={`Option ${String.fromCharCode(65 + ai)}`}
                                rows={2}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Explanation */}
                      <MathEditor
                        label="Explanation (optional)"
                        value={q.explanation}
                        onChange={(val) => updateQuestion(qi, "explanation", val)}
                        placeholder="Explain why the correct answer is right..."
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              ))}

              <button type="button" onClick={addQuestion}
                className="w-full border-2 border-dashed border-border rounded-xl py-4 text-sm text-muted hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center gap-2">
                <Plus size={14} /> Add another question
              </button>
            </div>
          </Card>

          {error && (
            <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
          )}

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving quiz..." : "Save quiz"}
            </Button>
            <Button variant="secondary" onClick={() => router.push("/assessment")}>Cancel</Button>
          </div>
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}
