import Anthropic from "@anthropic-ai/sdk";
import { resolveRef } from "../src/github/fetch";
import { explain, type ModelOptions } from "../src/llm/explain";
import { render } from "../src/output/render";
import type { PrRef } from "../src/output/links";
import { prepare, type Prepared } from "../src/pipeline";

export interface LocalRun {
  repo: string;
  base: string;
  head: string;
  title?: string;
  body?: string;
  /** `owner/repo#123`, only used to build working links. */
  pr?: string;
  exclude?: string[];
  maxDiffChars?: number;
}

export function prepareLocal(run: LocalRun): Prepared {
  return prepare({
    cwd: run.repo,
    baseSha: resolveRef(run.repo, run.base),
    headSha: resolveRef(run.repo, run.head),
    title: run.title ?? "",
    body: run.body ?? "",
    exclude: run.exclude ?? [],
    maxDiffChars: run.maxDiffChars ?? 300_000,
  });
}

export async function explainLocal(run: LocalRun, options: ModelOptions): Promise<string> {
  const prepared = prepareLocal(run);
  const explanation = await explain(new Anthropic({ maxRetries: 3 }), options, prepared.prompt);
  const output = render({
    pr: parsePrRef(run.pr),
    explanation,
    facts: prepared.facts,
    shown: prepared.prompt.shown,
    notExplained: prepared.prompt.notExplained,
  });
  return `${output.summary}\n\n${output.text}\n`;
}

function parsePrRef(ref: string | undefined): PrRef {
  const m = ref ? /^([^/]+)\/([^#]+)#(\d+)$/.exec(ref) : null;
  if (!m) return { serverUrl: "https://github.com", owner: "local", repo: "local", number: 0 };
  return { serverUrl: "https://github.com", owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}
