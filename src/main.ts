import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { readConfig } from "./config";
import { finishCheck, startCheck, type CheckTarget } from "./github/publish";
import { render } from "./output/render";
import { explain } from "./llm/explain";
import { prepare } from "./pipeline";

async function run(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.setFailed("Lazy PR Reviewer only runs on pull_request events.");
    return;
  }

  const config = readConfig();
  const { owner, repo } = github.context.repo;

  if (pr.head.repo?.full_name !== pr.base.repo.full_name) {
    core.notice("Skipping fork PR: its GITHUB_TOKEN is read-only and secrets are unavailable.");
    return;
  }
  if (!config.apiKey) {
    core.notice("Skipping: anthropic-api-key is empty. Dependabot and fork PRs don't receive repository secrets.");
    return;
  }

  const octokit = github.getOctokit(config.githubToken);
  const target: CheckTarget = { owner, repo, headSha: pr.head.sha };
  const checkRunId = await startCheck(octokit, target);

  try {
    const prepared = prepare({
      cwd: config.workingDirectory,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      title: pr.title ?? "",
      body: pr.body ?? "",
      exclude: config.exclude,
      maxDiffChars: config.maxDiffChars,
    });

    if (prepared.prompt.shown.length === 0) {
      await finishCheck(octokit, target, checkRunId, {
        title: "Nothing to explain",
        summary: "No changed file could be explained. Reasons are listed below.",
        text: prepared.prompt.notExplained.map((s) => `- ${s.path} (${s.reason})`).join("\n"),
      });
      return;
    }

    const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 3 });
    const explanation = await explain(client, config, prepared.prompt);
    const output = render({
      pr: { serverUrl: github.context.serverUrl, owner, repo, number: pr.number },
      explanation,
      facts: prepared.facts,
      shown: prepared.prompt.shown,
      notExplained: prepared.prompt.notExplained,
    });
    await finishCheck(octokit, target, checkRunId, output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishCheck(octokit, target, checkRunId, { title: "Explanation failed", summary: message, text: "" });
    core.setFailed(message);
  }
}

await run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
