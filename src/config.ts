import * as core from "@actions/core";
import type { Effort } from "./llm/explain";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  apiKey: string;
  githubToken: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  maxDiffChars: number;
  exclude: string[];
  workingDirectory: string;
}

export function readConfig(): Config {
  const effort = core.getInput("effort") || "medium";
  if (!EFFORTS.includes(effort as Effort)) throw new Error(`effort must be one of ${EFFORTS.join(", ")}; got "${effort}".`);

  return {
    apiKey: core.getInput("anthropic-api-key"),
    githubToken: core.getInput("github-token", { required: true }),
    model: core.getInput("model") || "claude-opus-5",
    effort: effort as Effort,
    maxTokens: positiveInt("max-tokens", 32_000),
    maxDiffChars: positiveInt("max-diff-chars", 300_000),
    exclude: core.getMultilineInput("exclude"),
    workingDirectory: core.getInput("working-directory") || ".",
  };
}

function positiveInt(name: string, fallback: number): number {
  const raw = core.getInput(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer; got "${raw}".`);
  return value;
}
