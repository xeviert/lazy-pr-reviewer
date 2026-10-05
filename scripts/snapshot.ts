// Saves what the action posted on a real PR as an eval baseline, and adds the PR to eval/cases.json.
//   npm run snapshot -- --pr owner/repo#12 --id my-case [--repo ../local-clone]
// Writes eval/baseline/<id>.md: PR description section, review notes with any human replies, and the check run output.
// Public repos work without auth; set GITHUB_TOKEN for private ones.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CHECK_NAME } from "../src/github/publish";
import { NOTE_MARKER, extractSection, stripSection } from "../src/output/prBody";
import type { LocalRun } from "./local";

const { values } = parseArgs({
  options: {
    pr: { type: "string" },
    id: { type: "string" },
    repo: { type: "string" },
    cases: { type: "string", default: "eval/cases.json" },
  },
});

const ref = values.pr ? /^([^/]+)\/([^#]+)#(\d+)$/.exec(values.pr) : null;
if (!ref || !values.id) {
  console.error("Usage: npm run snapshot -- --pr owner/repo#12 --id my-case [--repo ../local-clone]");
  process.exit(1);
}
const [, owner, repo, number] = ref as unknown as [string, string, string, string];

async function api<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface Pull {
  title: string;
  body: string | null;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
}
interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: { login: string } | null;
  in_reply_to_id?: number;
}
interface CheckRun {
  html_url: string;
  completed_at: string | null;
  output: { title: string | null; summary: string | null; text: string | null };
}

const pull = await api<Pull>(`pulls/${number}`);

const comments: ReviewComment[] = [];
for (let page = 1; ; page++) {
  const batch = await api<ReviewComment[]>(`pulls/${number}/comments?per_page=100&page=${page}`);
  comments.push(...batch);
  if (batch.length < 100) break;
}

const { check_runs } = await api<{ check_runs: CheckRun[] }>(
  `commits/${pull.head.sha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=latest`,
);
const check = check_runs[0];

const out: string[] = [
  `# Baseline: ${values.pr}`,
  "",
  `- PR: ${pull.html_url}`,
  `- Head: \`${pull.head.sha}\``,
  `- Check run: ${check ? `${check.html_url} (completed ${check.completed_at})` : "_not found for this head_"}`,
  `- Captured: ${new Date().toISOString()}`,
  "",
  "## PR description section",
  "",
  extractSection(pull.body ?? "") ?? "_No section._",
  "",
  "## Files tab notes",
  "",
];

const notes = comments.filter((c) => c.body.includes(NOTE_MARKER));
if (notes.length === 0) out.push("_None._", "");
for (const note of notes) {
  out.push(`### ${note.path}:${note.line ?? "outdated"}`, "", note.body.replace(NOTE_MARKER, "").trim(), "");
  for (const reply of comments.filter((c) => c.in_reply_to_id === note.id)) {
    out.push(`> **Reply from ${reply.user?.login ?? "unknown"}:** ${reply.body.replace(/\n/g, "\n> ")}`, "");
  }
}

out.push("## Check run", "");
if (check) out.push(`**${check.output.title ?? ""}**`, "", check.output.summary ?? "", "", check.output.text ?? "");
else out.push("_None._");

mkdirSync("eval/baseline", { recursive: true });
const file = `eval/baseline/${values.id}.md`;
writeFileSync(file, out.join("\n") + "\n");

const entry: LocalRun & { id: string } = {
  id: values.id,
  repo: values.repo ?? `../${repo}`,
  base: pull.base.sha,
  head: pull.head.sha,
  title: pull.title,
  body: stripSection(pull.body ?? ""),
  pr: values.pr,
};
const cases = existsSync(values.cases) ? (JSON.parse(readFileSync(values.cases, "utf8")) as (typeof entry)[]) : [];
const at = cases.findIndex((c) => c.id === entry.id);
if (at === -1) cases.push(entry);
else cases[at] = entry;
writeFileSync(values.cases, JSON.stringify(cases, null, 2) + "\n");

console.log(`Wrote ${file} (${notes.length} notes) and ${at === -1 ? "added" : "updated"} "${entry.id}" in ${values.cases}.`);
