import { extractFacts, type Fact } from "./analysis/facts";
import { partitionFiles } from "./analysis/filter";
import { loadDiff, loadManifests } from "./github/fetch";
import { buildPrompt, type Prompt } from "./llm/prompt";

export interface PullRequestInput {
  cwd: string;
  baseSha: string;
  headSha: string;
  title: string;
  body: string;
  exclude: string[];
  maxDiffChars: number;
}

export interface Prepared {
  facts: Fact[];
  prompt: Prompt;
}

/** Everything before the model call. Deterministic, no network except `git fetch`. */
export function prepare(input: PullRequestInput): Prepared {
  const diff = loadDiff(input.cwd, input.baseSha, input.headSha);
  const { kept, skipped } = partitionFiles(diff.files, input.exclude);
  const facts = extractFacts(kept, loadManifests(input.cwd, diff, input.headSha));
  const prompt = buildPrompt({ title: input.title, body: input.body, files: kept, facts, skipped, maxDiffChars: input.maxDiffChars });
  return { facts, prompt };
}

