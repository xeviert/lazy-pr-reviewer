import { visibleHeadLines, type FileDiff } from "../analysis/diff";
import type { Fact } from "../analysis/facts";
import type { Skipped } from "../analysis/filter";
import type { Explanation } from "../llm/explain";
import { diffLink, type PrRef } from "./links";

/** GitHub rejects check run `output.summary` and `output.text` above this. */
export const CHECK_OUTPUT_LIMIT = 65_535;

export interface RenderInput {
  pr: PrRef;
  explanation: Explanation;
  facts: Fact[];
  shown: FileDiff[];
  notExplained: Skipped[];
}

export interface CheckOutput {
  title: string;
  summary: string;
  text: string;
}

export function render(input: RenderInput): CheckOutput {
  const { pr, explanation, facts, shown } = input;
  const visible = new Map(shown.map((f) => [f.path, visibleHeadLines(f)]));
  const link = (path: string, line?: number) => {
    const lines = visible.get(path);
    if (!lines) return undefined;
    return diffLink(pr, path, line !== undefined && lines.has(line) ? line : undefined);
  };

  const summary: string[] = ["### What this PR does", explanation.summary, ""];

  if (explanation.ai_directed_text.length > 0) {
    summary.push("> [!WARNING]", "> This PR contains text addressed to AI tools. Read these lines yourself:");
    for (const t of explanation.ai_directed_text) {
      summary.push(`> - ${anchor(`${t.path}:${t.line}`, link(t.path, t.line))}: "${t.excerpt}"`);
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
  let dropped = 0;
  explanation.files.forEach((file, i) => {
    const href = link(file.path);
    const name = href ? `[${file.path}](${href})` : `${file.path} _(not in the diff)_`;
    text.push(`${i + 1}. **${name}** (${file.role})`, `   ${indent(file.explanation)}`);
    if (file.connects_to.length > 0) text.push(`   Connects to: ${file.connects_to.map(code).join(", ")}`);
    for (const q of file.check_yourself) {
      const lines = visible.get(file.path);
      if (!lines?.has(q.line)) {
        dropped++;
        continue;
      }
      text.push(`   > **Check yourself:** [line ${q.line}](${diffLink(pr, file.path, q.line)}): ${q.question}`);
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

  return {
    title: `Explained ${shown.length} file(s), ${facts.length} fact(s)`,
    summary: limit(summary.join("\n")),
    text: limit(text.join("\n")),
  };
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

function limit(text: string): string {
  if (text.length <= CHECK_OUTPUT_LIMIT) return text;
  const note = "\n\n_Output truncated to fit GitHub's check run limit._";
  return text.slice(0, CHECK_OUTPUT_LIMIT - note.length) + note;
}
