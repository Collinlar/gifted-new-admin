"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import ImageField from "@/components/ui/ImageField";
import api from "@/lib/api";
import {
  Eye, Globe, Undo2, Plus, Trash2, ChevronUp, ChevronDown,
  Loader2, ChevronRight, Check, AlertCircle, ImageIcon,
} from "lucide-react";

// The homepage editor.
//
// Everything on the public page used to live in Home.jsx, so changing a
// closing date meant a code change and a deploy. That is why all three dates
// on the live site still read "tbc".
//
// Edits here write to a draft, not to the page. The public site keeps showing
// the last published version until someone presses Publish, which means the
// hero can be rewritten on Tuesday and the events added on Wednesday without
// anybody seeing a half-finished homepage in between.

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://gifted-project-eight.vercel.app";

// Which sections can be reordered or switched off. The hero is not among them:
// the brand, the headline and the programme list are one composed unit, and
// hiding it would leave a page that opens on a statistics strip.
const MOVEABLE = new Set(["proof", "steps", "dates"]);

// Pictures shipped with the site are stored as site-relative paths like
// /math.jpg. Those resolve on the public site and 404 here, so previews in
// the admin point them back at the site. Anything uploaded through the admin
// is already a full URL and passes through untouched.
const resolveImg = (src: string) =>
  src && src.startsWith("/") ? `${SITE}${src}` : src;
const STRUCTURAL_NOTE = "Always shown. This is the top of the page.";

// ── What each section is made of ───────────────────────────────────────────
//
// Declarative so the editor is one component rather than seven. `list` fields
// are repeatable: the six programmes, the three events, the menu items.

type Field =
  | { k: string; label: string; type: "text" | "area" | "image"; hint?: string; placeholder?: string }
  | { k: string; label: string; type: "lines"; hint?: string }
  | { k: string; label: string; type: "list"; itemLabel: string; addLabel: string; fields: Field[]; max?: number };

const SCHEMA: Record<string, { blurb: string; summary: string; fields: Field[] }> = {
  brand: {
    summary: "Wordmark and menu",
    blurb: "The name in the top left and the menu beside it.",
    fields: [
      { k: "wordmark", label: "Site name", type: "text" },
      { k: "kicker", label: "The small line beside it", type: "text", placeholder: "Olympiad Edu Center" },
      { k: "signInLabel", label: "Sign in button", type: "text" },
      {
        k: "nav", label: "Menu", type: "list", itemLabel: "Menu item", addLabel: "Add a menu item", max: 5,
        fields: [
          { k: "label", label: "Wording", type: "text" },
          { k: "target", label: "Goes to", type: "text", hint: "#dates for a part of this page, /login for a page in the app, or a full web address" },
        ],
      },
    ],
  },

  hero: {
    summary: "Headline, paragraph, buttons",
    blurb: "The first thing anyone sees. Keep the headline short, it is set very large.",
    fields: [
      { k: "eyebrow", label: "Small line above the headline", type: "text", placeholder: "Accra · since 2019" },
      {
        k: "headline", label: "Headline", type: "lines",
        hint: "One line per line break. The headline breaks exactly where you write it rather than wherever the browser decides.",
      },
      { k: "lede", label: "The paragraph under it", type: "area" },
      { k: "primaryLabel", label: "Main button", type: "text" },
      { k: "primaryTarget", label: "Main button goes to", type: "text", hint: "#dates, /login, or a full web address" },
      { k: "secondaryLabel", label: "Second button", type: "text", hint: "Leave empty to show only one button" },
      { k: "secondaryTarget", label: "Second button goes to", type: "text" },
    ],
  },

  programmes: {
    summary: "The list, and the hero background pictures",
    blurb: "The list on the right of the hero. Each one's picture becomes the background when it is highlighted, so use wide images.",
    fields: [
      { k: "heading", label: "Heading", type: "text", hint: "Only shown on phones, where the list sits under the headline" },
      {
        k: "items", label: "Programmes", type: "list", itemLabel: "Programme", addLabel: "Add a programme",
        fields: [
          { k: "title", label: "Name", type: "text" },
          { k: "meta", label: "Short detail on the right", type: "text", placeholder: "Ages 12–18" },
          { k: "line", label: "The sentence shown when it is highlighted", type: "area" },
          { k: "img", label: "Background picture", type: "image" },
          { k: "target", label: "Clicking it goes to", type: "text", placeholder: "/login" },
        ],
      },
    ],
  },

  proof: {
    summary: "The numbers and the line beside them",
    blurb: "The band of numbers under the hero.",
    fields: [
      {
        k: "stats", label: "Numbers", type: "list", itemLabel: "Number", addLabel: "Add a number", max: 4,
        fields: [
          { k: "value", label: "The number", type: "text", placeholder: "12,000" },
          { k: "label", label: "What it counts", type: "text", placeholder: "Students on the platform" },
        ],
      },
      { k: "line", label: "The paragraph beside them", type: "area" },
    ],
  },

  steps: {
    summary: "The three steps",
    blurb: "Three steps explaining how a student gets from browsing to certified.",
    fields: [
      { k: "kicker", label: "Small heading above", type: "text" },
      {
        k: "items", label: "Steps", type: "list", itemLabel: "Step", addLabel: "Add a step", max: 5,
        fields: [
          { k: "n", label: "Number", type: "text", placeholder: "01" },
          { k: "title", label: "Title", type: "text" },
          { k: "body", label: "Explanation", type: "area" },
        ],
      },
    ],
  },

  dates: {
    summary: "What is open for registration",
    blurb: "What is open for registration. This is the section most worth keeping current.",
    fields: [
      { k: "heading", label: "Heading", type: "text" },
      { k: "note", label: "The line under it", type: "area" },
      { k: "ctaLabel", label: "Button on every row", type: "text", placeholder: "Register" },
      {
        k: "items", label: "What is open", type: "list", itemLabel: "Entry", addLabel: "Add something open",
        fields: [
          { k: "term", label: "Term or timing", type: "text", placeholder: "Term 3" },
          { k: "name", label: "Name", type: "text" },
          { k: "what", label: "What it is", type: "area" },
          { k: "when", label: "When", type: "text", hint: "Free text, so it can say a real date or \"closes 14 March\"" },
          { k: "target", label: "Button goes to", type: "text", placeholder: "/sign-up" },
        ],
      },
    ],
  },

  footer: {
    summary: "Contact details",
    blurb: "Contact details at the very bottom. Leave a field empty to drop it.",
    fields: [
      { k: "brand", label: "Name", type: "text" },
      { k: "email", label: "Email", type: "text" },
      { k: "phone", label: "Phone", type: "text" },
      { k: "address", label: "Address", type: "text" },
      { k: "copyright", label: "Copyright line", type: "text" },
    ],
  },
};

interface Section {
  id: string; key: string; label: string;
  enabled: boolean; sort_order: number;
  content: Record<string, unknown>;
  draft: Record<string, unknown> | null;
  published_at: string | null;
}

type Content = Record<string, unknown>;

export default function HomepageEditor() {
  const [sections, setSections] = useState<Section[]>([]);
  const [selected, setSelected] = useState<string>("hero");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Edits are held here until saved, so typing does not fire a request per
  // keystroke and leaving a field half-typed does not become a draft.
  const [edits, setEdits] = useState<Record<string, Content>>({});

  // keepEdits matters on the paths that reload for a reason other than
  // saving. Reordering a section used to call this bare, which threw away
  // whatever the admin had typed into a different section and not yet saved.
  const load = async ({ keepEdits = false } = {}) => {
    setError("");
    try {
      const res = await api.get("/homepage");
      setSections(res.data.sections || []);
      if (!keepEdits) setEdits({});
    } catch (e) {
      setError(msg(e, "Could not load the homepage."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const current = sections.find((s) => s.key === selected);
  const live = (s: Section): Content => (s.draft ?? s.content ?? {}) as Content;
  const working = (s: Section): Content => edits[s.key] ?? live(s);

  const dirty = Object.keys(edits).length > 0;
  const unpublished = sections.filter((s) => s.draft !== null).length;

  const setField = (key: string, patch: Content) =>
    setEdits((p) => ({ ...p, [key]: { ...(p[key] ?? live(sections.find((s) => s.key === key)!)), ...patch } }));

  const save = async () => {
    setBusy(true); setNotice(""); setError("");
    try {
      await Promise.all(
        Object.entries(edits).map(([key, content]) =>
          api.put(`/homepage-section/${key}`, { content })
        )
      );
      setNotice("Saved as a draft. Nobody sees it until you publish.");
      await load();
    } catch (e) {
      setError(msg(e, "Could not save that."));
    } finally { setBusy(false); }
  };

  const publish = async () => {
    if (dirty) { setError("Save your changes first, then publish."); return; }
    if (!confirm("Publish the homepage? The public site changes immediately.")) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const res = await api.put("/publish-homepage", {});
      setNotice(`Published. ${res.data.sections} section${res.data.sections === 1 ? "" : "s"} updated on the live site.`);
      await load();
    } catch (e) {
      setError(msg(e, "Could not publish."));
    } finally { setBusy(false); }
  };

  const discard = async () => {
    if (!confirm("Throw away every unpublished change and go back to what is live?")) return;
    setBusy(true); setError("");
    try {
      await api.put("/discard-homepage-draft", {});
      setNotice("Back to the published version.");
      await load();
    } catch (e) {
      setError(msg(e, "Could not discard."));
    } finally { setBusy(false); }
  };

  const toggleEnabled = async (s: Section) => {
    setBusy(true); setError("");
    // Move it now. A switch that waits on a round trip reads as broken.
    setSections((p) => p.map((x) => (x.key === s.key ? { ...x, enabled: !x.enabled } : x)));
    try {
      await api.put(`/homepage-section/${s.key}`, { enabled: !s.enabled });
      setNotice(!s.enabled
        ? `${s.label} will show on the page.`
        : `${s.label} is hidden. Publish for this to reach the live site.`);
    } catch (e) {
      setError(msg(e, "Could not change that."));
      await load({ keepEdits: true });
    } finally { setBusy(false); }
  };

  const move = async (s: Section, direction: -1 | 1) => {
    const movable = sections.filter((x) => MOVEABLE.has(x.key));
    const at = movable.findIndex((x) => x.key === s.key);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= movable.length) return;

    const reordered = [...movable];
    [reordered[at], reordered[to]] = [reordered[to], reordered[at]];

    // Fixed sections keep their places; only the movable block is renumbered
    const fixedBefore = sections.filter((x) => !MOVEABLE.has(x.key) && x.sort_order < movable[0].sort_order);
    const fixedAfter  = sections.filter((x) => !MOVEABLE.has(x.key) && x.sort_order > movable[movable.length - 1].sort_order);
    const keys = [...fixedBefore, ...reordered, ...fixedAfter].map((x) => x.key);

    setBusy(true); setError("");
    try {
      await api.put("/homepage-order", { keys });
      await load({ keepEdits: true });
    } catch (e) {
      setError(msg(e, "Could not reorder."));
    } finally { setBusy(false); }
  };

  const ordered = useMemo(
    () => [...sections].sort((a, b) => a.sort_order - b.sort_order),
    [sections]
  );

  return (
    <AuthGuard>
      <DashboardShell title="Homepage">
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
          )}
          {notice && !error && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
              {notice}
            </p>
          )}

          {/* Status and the three things you can do to the whole page */}
          <div className="flex items-center justify-between gap-3 flex-wrap bg-card border border-border rounded-xl px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm">
              {dirty ? (
                <><AlertCircle size={15} className="text-amber-600" />
                  <span className="text-ink font-medium">You have unsaved edits</span></>
              ) : unpublished > 0 ? (
                <><AlertCircle size={15} className="text-amber-600" />
                  <span className="text-ink font-medium">
                    {unpublished} section{unpublished === 1 ? "" : "s"} changed but not published
                  </span></>
              ) : (
                <><Check size={15} className="text-emerald-600" />
                  <span className="text-muted">The live site matches what is here</span></>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <a href={`${SITE}/?preview=1`} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm"><Eye size={14} /> Preview</Button>
              </a>
              {unpublished > 0 && !dirty && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={discard}>
                  <Undo2 size={14} /> Discard changes
                </Button>
              )}
              <Button variant="secondary" size="sm" disabled={!dirty || busy} onClick={save}>
                {busy && dirty ? <Loader2 size={14} className="animate-spin" /> : null}
                Save draft
              </Button>
              <Button size="sm" disabled={busy || unpublished === 0 || dirty} onClick={publish}>
                <Globe size={14} /> Publish
              </Button>
            </div>
          </div>

          {loading ? (
            <Spinner text="Loading the homepage..." />
          ) : sections.length === 0 ? (
            <Card>
              <p className="text-sm text-muted text-center py-8">
                No sections found. Run <code className="text-ink">supabase/homepage.sql</code> first.
              </p>
            </Card>
          ) : (
            <div className="grid lg:grid-cols-[260px_1fr] gap-4 items-start">
              {/* Sections, in the order they appear down the page */}
              <Card padding={false} className="lg:sticky lg:top-4">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                    Down the page
                  </p>
                  <p className="text-[11px] text-subtle mt-0.5">Pick a part to edit it</p>
                </div>
                <div className="p-2 space-y-1">
                  {ordered.map((s, i) => {
                    const movable = MOVEABLE.has(s.key);
                    const changed = s.draft !== null || edits[s.key] !== undefined;
                    return (
                      <div key={s.key}
                        className={`rounded-lg border transition-colors ${
                          selected === s.key ? "border-primary bg-primary-light/40" : "border-transparent hover:bg-surface"}`}>
                        {/* Two lines, not one. A column of bare labels reads
                            as a table of contents rather than as the thing you
                            click, which is how the programme pictures ended up
                            looking like they were not in the admin at all. */}
                        <button onClick={() => setSelected(s.key)}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left">
                          <span className="text-[10px] font-mono text-subtle w-4 shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm truncate ${
                              s.enabled ? "text-ink font-medium" : "text-subtle line-through"}`}>
                              {s.label}
                            </span>
                            <span className="block text-[11px] text-subtle truncate">
                              {s.enabled
                                ? SCHEMA[s.key]?.summary || "Content"
                                : "Hidden from the page"}
                            </span>
                          </span>
                          {changed && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                              title="Changed but not published" />
                          )}
                          <ChevronRight size={13}
                            className={`shrink-0 ${selected === s.key ? "text-primary" : "text-subtle"}`} />
                        </button>

                        {selected === s.key && (
                          <div className="flex items-center gap-1 px-2.5 pb-2">
                            {movable ? (
                              <>
                                <button onClick={() => move(s, -1)} disabled={busy}
                                  className="p-1 rounded text-subtle hover:text-ink disabled:opacity-40"
                                  title="Move up the page">
                                  <ChevronUp size={13} />
                                </button>
                                <button onClick={() => move(s, 1)} disabled={busy}
                                  className="p-1 rounded text-subtle hover:text-ink disabled:opacity-40"
                                  title="Move down the page">
                                  <ChevronDown size={13} />
                                </button>
                                <button onClick={() => toggleEnabled(s)} disabled={busy}
                                  className="ml-auto text-[11px] font-medium text-muted hover:text-primary">
                                  {s.enabled ? "Hide this section" : "Show this section"}
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] text-subtle">{STRUCTURAL_NOTE}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {current && (
                <SectionEditor
                  key={current.key}
                  section={current}
                  value={working(current)}
                  onChange={(patch) => setField(current.key, patch)}
                  onJump={setSelected}
                />
              )}
            </div>
          )}
        </div>
      </DashboardShell>
    </AuthGuard>
  );
}

// ── One section ────────────────────────────────────────────────────────────

function SectionEditor({ section, value, onChange, onJump }: {
  section: Section; value: Content; onChange: (patch: Content) => void;
  onJump: (key: string) => void;
}) {
  const schema = SCHEMA[section.key];
  if (!schema) {
    return (
      <Card title={section.label}>
        <p className="text-sm text-muted">
          This section has no editor yet. It renders from whatever is stored against it.
        </p>
      </Card>
    );
  }

  return (
    <Card title={section.label} subtitle={schema.blurb}>
      {/* The photographs behind the hero are the programme pictures. Someone
          looking for "the hero background images" opens the hero, finds no
          image field, and reasonably concludes there is no control for them. */}
      {section.key === "hero" && (
        <button onClick={() => onJump("programmes")}
          className="w-full flex items-center gap-2.5 mb-5 px-3.5 py-3 rounded-lg border border-border bg-surface text-left hover:border-primary transition-colors">
          <ImageIcon size={15} className="text-muted shrink-0" />
          <span className="text-sm text-body flex-1">
            Looking for the background photographs? They come from the
            programme list, one picture each.
          </span>
          <span className="text-sm font-medium text-primary shrink-0">Open Programmes</span>
        </button>
      )}

      <div className="space-y-5">
        {schema.fields.map((f) => (
          <FieldEditor key={f.k} field={f}
            value={value[f.k]}
            onChange={(v) => onChange({ [f.k]: v })} />
        ))}
      </div>
    </Card>
  );
}

function FieldEditor({ field, value, onChange }: {
  field: Field; value: unknown; onChange: (v: unknown) => void;
}) {
  if (field.type === "list") return <ListEditor field={field} value={value} onChange={onChange} />;

  if (field.type === "lines") {
    // Stored as an array so the page can break the headline exactly where it
    // is written. Edited as a textarea, because "one line per line" is how
    // anyone would expect to type a headline.
    const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
    return (
      <Labelled field={field}>
        <textarea rows={3} value={text}
          onChange={(e) => onChange(e.target.value.split("\n"))}
          className={inputCls} />
      </Labelled>
    );
  }

  if (field.type === "image") {
    const src = String(value ?? "");
    // ImageField is shared with questions and certificates, where values are
    // always full URLs, so its own preview is left alone rather than taught
    // about site-relative paths. The six pictures that shipped with the site
    // get their preview here instead, and the stored value is untouched.
    const relative = src.startsWith("/");
    return (
      <div>
        <ImageField label={field.label} value={src} onChange={onChange} />
        {relative && (
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-border p-2">
            <img src={resolveImg(src)} alt=""
              className="w-24 h-16 object-cover rounded shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <p className="text-xs text-subtle">
              This picture ships with the site rather than being uploaded here,
              which is why the box above cannot show it. Upload a replacement to
              change it.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (field.type === "area") {
    return (
      <Labelled field={field}>
        <textarea rows={3} value={String(value ?? "")} placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)} className={inputCls} />
      </Labelled>
    );
  }

  return (
    <Labelled field={field}>
      <input type="text" value={String(value ?? "")} placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </Labelled>
  );
}

function ListEditor({ field, value, onChange }: {
  field: Extract<Field, { type: "list" }>; value: unknown; onChange: (v: unknown) => void;
}) {
  const items = (Array.isArray(value) ? value : []) as Content[];
  const [open, setOpen] = useState<number | null>(items.length ? 0 : null);

  const write = (next: Content[]) => onChange(next);

  const update = (i: number, patch: Content) =>
    write(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  const add = () => {
    const blank: Content = {};
    field.fields.forEach((f) => { blank[f.k] = ""; });
    write([...items, blank]);
    setOpen(items.length);
  };

  const remove = (i: number) => {
    if (!confirm(`Remove this ${field.itemLabel.toLowerCase()}?`)) return;
    write(items.filter((_, n) => n !== i));
    setOpen(null);
  };

  const move = (i: number, d: -1 | 1) => {
    const to = i + d;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[i], next[to]] = [next[to], next[i]];
    write(next);
    setOpen(to);
  };

  // The first text field is what identifies a row when it is collapsed
  const titleKey = field.fields.find((f) => f.type === "text")?.k || field.fields[0].k;
  // If the rows carry a picture, show it on the collapsed header. Six
  // programmes each hiding their photograph behind a click is six clicks to
  // answer "which images is the homepage using".
  const imageKey = field.fields.find((f) => f.type === "image")?.k;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted">
          {field.label} <span className="text-subtle">({items.length})</span>
        </span>
        {(!field.max || items.length < field.max) && (
          <Button variant="ghost" size="sm" onClick={add}>
            <Plus size={13} /> {field.addLabel}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-subtle border border-dashed border-border rounded-lg px-4 py-6 text-center">
          Nothing here. This part of the page will be empty.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-surface">
                <span className="text-xs text-subtle font-mono w-5 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {imageKey && (
                  <span className="w-10 h-7 rounded overflow-hidden bg-border shrink-0 grid place-items-center">
                    {item[imageKey] ? (
                      <img src={resolveImg(String(item[imageKey]))} alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <ImageIcon size={11} className="text-subtle" />
                    )}
                  </span>
                )}
                <button onClick={() => setOpen(open === i ? null : i)}
                  className="flex-1 text-left text-sm font-medium text-ink truncate">
                  {String(item[titleKey] || `Untitled ${field.itemLabel.toLowerCase()}`)}
                  {imageKey && !item[imageKey] && (
                    <span className="ml-2 text-[11px] font-normal text-amber-600">no picture</span>
                  )}
                </button>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-1 text-subtle hover:text-ink disabled:opacity-30" title="Move up">
                  <ChevronUp size={13} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === items.length - 1}
                  className="p-1 text-subtle hover:text-ink disabled:opacity-30" title="Move down">
                  <ChevronDown size={13} />
                </button>
                <button onClick={() => remove(i)}
                  className="p-1 text-subtle hover:text-danger" title="Remove">
                  <Trash2 size={13} />
                </button>
              </div>

              {open === i && (
                <div className="p-3 space-y-3">
                  {field.fields.map((f) => (
                    <FieldEditor key={f.k} field={f}
                      value={item[f.k]}
                      onChange={(v) => update(i, { [f.k]: v })} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary";

function Labelled({ field, children }: { field: Field; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1.5">{field.label}</label>
      {children}
      {"hint" in field && field.hint && (
        <p className="text-xs text-subtle mt-1.5">{field.hint}</p>
      )}
    </div>
  );
}

function msg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
         (e as Error)?.message || fallback;
}
