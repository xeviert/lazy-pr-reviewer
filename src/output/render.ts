import { addedLines, visibleHeadLines, type FileDiff } from "../analysis/diff";
import type { Fact } from "../analysis/facts";
import type { Skipped } from "../analysis/filter";
import type { Explanation } from "../llm/explain";
import { diffLink, type PrRef } from "./links";
import { NOTE_MARKER } from "./prBody";

/** GitHub rejects check run `output.summary` and `output.text` above this. */
export const CHECK_OUTPUT_LIMIT = 65_535;

/** PR bodies max out at 65,536 characters; leave room for the author's own text. */
export const PR_SECTION_LIMIT = 60_000;

export interface RenderInput {
  pr: PrRef;
  explanation: Explanation;
  facts: Fact[];
  shown: FileDiff[];
  notExplained: Skipped[];
  /** Check run page, linked from the PR body section. */
  checkUrl?: string;
}

/** A walkthrough step, question, or warning pinned to a changed line in the Files tab. */
export interface Note {
  path: string;
  line: number;
  level: "notice" | "warning";
  title: string;
  message: string;
}

/** Fallback for notes when review comments can't be posted. Plain text: GitHub doesn't render markdown here. */
export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning";
  title: string;
  message: string;
}

export interface CheckOutput {
  title: string;
  summary: string;
  text: string;
  annotations?: Annotation[];
}

export interface RenderOutput {
  check: CheckOutput;
  notes: Note[];
  /** Goes between the markers in the PR body. */
  prSection: string;
}

export function render(input: RenderInput): RenderOutput {
  const { pr, explanation, facts, shown } = input;
  const visible = new Map(shown.map((f) => [f.path, visibleHeadLines(f)]));
  const link = (path: string, line?: number) => {
    const lines = visible.get(path);
    if (!lines) return undefined;
    return diffLink(pr, path, line !== undefined && lines.has(line) ? line : undefined);
  };
  const notes: Note[] = [];
  const annotate = (path: string, line: number, level: Note["level"], title: string, message: string) => {
    if (visible.get(path)?.has(line)) notes.push({ path, line, level, title, message });
  };

  const summary: string[] = ["### What this PR does", explanation.summary, ""];

  if (explanation.ai_directed_text.length > 0) {
    summary.push("> [!WARNING]", "> This PR contains text addressed to AI tools. Read these lines yourself:");
    for (const t of explanation.ai_directed_text) {
      summary.push(`> - ${anchor(`${t.path}:${t.line}`, link(t.path, t.line))}: "${t.excerpt}"`);
      annotate(t.path, t.line, "warning", "Text addressed to AI tools", `This text tries to steer AI tools. Read it yourself: "${t.excerpt}"`);
    }
    summary.push("");
  }

  summary.push("### Facts (from the diff, not the model)");
  if (facts.length === 0) summary.push("_None detected._");
  for (const fact of facts) {
    const where = fact.line === undefined ? fact.path : `${fact.path}:${fact.line}`;
    summary.push(`- **${fact.kind}** ${anchor(where, link(fact.path, fact.line))}: ${fact.detail}`);
  }
  summary.push(
    "",
    "_Facts come from pattern matching on added lines and can miss things. The walkthrough is written by a model and can be wrong. Follow the links and read the code._",
  );

  const text: string[] = ["## Walkthrough"];
  const byPath = new Map(shown.map((f) => [f.path, f]));
  let dropped = 0;
  explanation.files.forEach((file, i) => {
    const href = link(file.path);
    const name = href ? `[${file.path}](${href})` : `${file.path} _(not in the diff)_`;
    text.push(`${i + 1}. **${name}** (${file.role})`, `   ${indent(file.explanation)}`);
    if (file.connects_to.length > 0) text.push(`   Connects to: ${file.connects_to.map(code).join(", ")}`);
    const diff = byPath.get(file.path);
    const first = diff && firstChangedLine(diff);
    if (first !== undefined) {
      const connects = file.connects_to.length > 0 ? `\n\nConnects to: ${file.connects_to.join(", ")}` : "";
      annotate(file.path, first, "notice", `Step ${i + 1} of ${explanation.files.length} (${file.role})`, file.explanation + connects);
    }
    for (const q of file.check_yourself) {
      const lines = visible.get(file.path);
      if (!lines?.has(q.line)) {
        dropped++;
        continue;
      }
      text.push(`   > **Check yourself:** [line ${q.line}](${diffLink(pr, file.path, q.line)}): ${q.question}`);
      annotate(file.path, q.line, "notice", "Check yourself", q.question);
    }
    text.push("");
  });

  const covered = new Set(explanation.files.map((f) => f.path));
  const uncovered = shown.filter((f) => !covered.has(f.path));
  if (uncovered.length > 0) {
    text.push("**Changed files the walkthrough skipped:**");
    for (const f of uncovered) text.push(`- [${f.path}](${diffLink(pr, f.path)})`);
    text.push("");
  }
  if (dropped > 0) text.push(`_${dropped} check-yourself question(s) dropped because they pointed at lines outside the diff._`, "");

  if (explanation.concepts.length > 0) {
    text.push("<details><summary>New concepts</summary>", "");
    for (const c of explanation.concepts) text.push(`- **${c.name}**: ${c.explanation}`);
    text.push("", "</details>", "");
  }

  if (input.notExplained.length > 0) {
    text.push("## Not explained");
    for (const s of input.notExplained) text.push(`- ${s.path} (${s.reason})`);
  }

  const walkthrough = input.checkUrl ? `[Lazy PR Reviewer check](${input.checkUrl})` : "the Lazy PR Reviewer check";
  const prSection = [
    ...summary,
    "",
    `_The full walkthrough is in ${walkthrough}. Steps and check-yourself questions are also pinned to their lines in the Files tab._`,
  ];

  return {
    check: {
      title: `Explained ${shown.length} file(s), ${facts.length} fact(s)`,
      summary: limit(summary.join("\n")),
      text: limit(text.join("\n")),
    },
    notes,
    prSection: limit(prSection.join("\n"), PR_SECTION_LIMIT),
  };
}

export function toAnnotations(notes: Note[]): Annotation[] {
  return notes.map((n) => ({ path: n.path, start_line: n.line, end_line: n.line, annotation_level: n.level, title: n.title, message: n.message }));
}

export function toCommentBody(note: Note): string {
  return `**${note.title}**\n\n${note.message}\n\n${NOTE_MARKER}`;
}

/** Where a walkthrough step is pinned: the first added line, or the first visible line for deletion-only files. */
function firstChangedLine(file: FileDiff): number | undefined {
  const added = addedLines(file)[0]?.newLine;
  if (added !== undefined) return added;
  const visible = [...visibleHeadLines(file)];
  return visible.length > 0 ? Math.min(...visible) : undefined;
}

function anchor(label: string, href: string | undefined): string {
  return href ? `[${label}](${href})` : label;
}

function code(name: string): string {
  return name.includes("`") ? name : `\`${name}\``;
}

function indent(text: string): string {
  return text.replace(/\n/g, "\n   ");
}

function limit(text: string, max = CHECK_OUTPUT_LIMIT): string {
  if (text.length <= max) return text;
  const note = "\n\n_Output truncated to fit GitHub's size limit._";
  return text.slice(0, max - note.length) + note;
}
