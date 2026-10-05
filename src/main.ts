import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { readConfig } from "./config";
import { finishCheck, publishNotes, startCheck, updatePrBody, type PullTarget } from "./github/publish";
import { stripSection } from "./output/prBody";
import { render, toAnnotations, type Annotation, type Note } from "./output/render";
import { explain } from "./llm/explain";
import { prepare } from "./pipeline";

type Octokit = ReturnType<typeof github.getOctokit>;

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
  const target: PullTarget = { owner, repo, headSha: pr.head.sha, number: pr.number };
  const check = await startCheck(octokit, target);

  try {
    const prepared = prepare({
      cwd: config.workingDirectory,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      title: pr.title ?? "",
      body: stripSection(pr.body ?? ""),
      exclude: config.exclude,
      maxDiffChars: config.maxDiffChars,
    });

    if (prepared.prompt.shown.length === 0) {
      await publishInline(octokit, target, [], "### What this PR does\n_Nothing to explain: no changed file could be explained._");
      await finishCheck(octokit, target, check.id, {
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
      checkUrl: check.url,
    });
    const annotations = await publishInline(octokit, target, output.notes, output.prSection);
    await finishCheck(octokit, target, check.id, { ...output.check, annotations });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishCheck(octokit, target, check.id, { title: "Explanation failed", summary: message, text: "" });
    core.setFailed(message);
  }
}

/**
 * Review comments and the PR body section need `pull-requests: write`. Without it, notes fall back to
 * check annotations, so workflows set up before this permission was required keep working.
 */
async function publishInline(octokit: Octokit, target: PullTarget, notes: Note[], prSection: string): Promise<Annotation[] | undefined> {
  let fallback: Annotation[] | undefined;
  try {
    await publishNotes(octokit, target, notes);
  } catch (error) {
    core.warning(`Couldn't post review comments, using check annotations instead. Does the workflow grant \`pull-requests: write\`? ${describe(error)}`);
    fallback = toAnnotations(notes);
  }
  try {
    await updatePrBody(octokit, target, prSection);
  } catch (error) {
    core.warning(`Couldn't update the PR description. ${describe(error)}`);
  }
  return fallback;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
