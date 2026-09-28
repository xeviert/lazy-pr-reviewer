// Runs every case in eval/cases.json and writes eval/out/<id>.md for comparison with eval/expected/<id>.md.
//   npm run eval [-- --only <id>] [--model claude-sonnet-5] [--effort medium]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Effort } from "../src/llm/explain";
import { explainLocal, type LocalRun } from "./local";

interface EvalCase extends LocalRun {
  id: string;
}

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "eval/cases.json" },
    only: { type: "string" },
    model: { type: "string", default: "claude-opus-5" },
    effort: { type: "string", default: "high" },
  },
});

const cases = (JSON.parse(readFileSync(values.cases, "utf8")) as EvalCase[]).filter((c) => !values.only || c.id === values.only);
const options = { model: values.model, effort: values.effort as Effort, maxTokens: 32_000 };
mkdirSync("eval/out", { recursive: true });

for (const c of cases) {
  process.stdout.write(`${c.id} ... `);
  try {
    writeFileSync(`eval/out/${c.id}.md`, await explainLocal(c, options));
    console.log("ok");
  } catch (error) {
    console.log(`failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
