import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Prompt } from "./prompt";

export const ExplanationSchema = z.object({
  summary: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      role: z.enum(["entry", "wiring", "logic", "data", "config", "test", "docs", "build", "other"]),
      explanation: z.string(),
      connects_to: z.array(z.string()),
      check_yourself: z.array(z.object({ line: z.number().int(), question: z.string() })),
    }),
  ),
  concepts: z.array(z.object({ name: z.string(), explanation: z.string() })),
  ai_directed_text: z.array(z.object({ path: z.string(), line: z.number().int(), excerpt: z.string() })),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelOptions {
  model: string;
  effort: Effort;
  maxTokens: number;
}

// Server-side refusal fallback; only sent for models documented to accept it.
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

export async function explain(client: Anthropic, options: ModelOptions, prompt: Prompt): Promise<Explanation> {
  const fallback = FALLBACK_MODELS.has(options.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const stream = client.beta.messages.stream({
    model: options.model,
    max_tokens: options.maxTokens,
    ...fallback,
    output_config: { effort: options.effort, format: betaZodOutputFormat(ExplanationSchema) },
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(`The model declined to explain this PR (category: ${message.stop_details?.category ?? "unspecified"}).`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(`The explanation hit max-tokens (${options.maxTokens}). Raise the max-tokens input.`);
  }
  if (!message.parsed_output) throw new Error("The model returned output that doesn't match the explanation schema.");
  return message.parsed_output;
}
