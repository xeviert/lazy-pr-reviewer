// Explain a local branch without GitHub.
//   npm run dry-run -- --repo ../my-app --base main --head feature/x [--title "..."] [--body-file pr.md] [--pr owner/repo#12] [--prompt-only]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Effort } from "../src/llm/explain";
import { explainLocal, prepareLocal, type LocalRun } from "./local";

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "." },
    base: { type: "string" },
    head: { type: "string", default: "HEAD" },
    title: { type: "string" },
    "body-file": { type: "string" },
    pr: { type: "string" },
    model: { type: "string", default: "claude-opus-5" },
    effort: { type: "string", default: "medium" },
    "max-tokens": { type: "string", default: "32000" },
    "prompt-only": { type: "boolean", default: false },
  },
});

if (!values.base) {
  console.error("--base is required");
  process.exit(1);
}

const run: LocalRun = {
  repo: values.repo,
  base: values.base,
  head: values.head,
  title: values.title,
  body: values["body-file"] ? readFileSync(values["body-file"], "utf8") : undefined,
  pr: values.pr,
};

if (values["prompt-only"]) {
  const { prompt } = prepareLocal(run);
  console.log(`--- system ---\n${prompt.system}\n\n--- user ---\n${prompt.user}`);
} else {
  const options = { model: values.model, effort: values.effort as Effort, maxTokens: Number(values["max-tokens"]) };
  console.log(await explainLocal(run, options));
}
