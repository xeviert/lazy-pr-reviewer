import type { getOctokit } from "@actions/github";
import type { CheckOutput } from "../output/render";

type Octokit = ReturnType<typeof getOctokit>;

export const CHECK_NAME = "Lazy PR Reviewer";

export interface CheckTarget {
  owner: string;
  repo: string;
  headSha: string;
}

export async function startCheck(octokit: Octokit, target: CheckTarget): Promise<number> {
  const { data } = await octokit.rest.checks.create({
    owner: target.owner,
    repo: target.repo,
    name: CHECK_NAME,
    head_sha: target.headSha,
    status: "in_progress",
  });
  return data.id;
}

/** GitHub accepts at most 50 annotations per request; each update appends to the ones already sent. */
export const ANNOTATION_BATCH = 50;

/** Always `neutral`: the explanation is not a verdict, so it shouldn't show as a pass or a fail. */
export async function finishCheck(octokit: Octokit, target: CheckTarget, checkRunId: number, output: CheckOutput): Promise<void> {
  const { annotations = [], ...rest } = output;
  const batches: CheckOutput["annotations"][] = [];
  for (let i = 0; i < annotations.length; i += ANNOTATION_BATCH) batches.push(annotations.slice(i, i + ANNOTATION_BATCH));
  const last = batches.pop();

  const base = { owner: target.owner, repo: target.repo, check_run_id: checkRunId };
  for (const batch of batches) await octokit.rest.checks.update({ ...base, output: { ...rest, annotations: batch } });
  await octokit.rest.checks.update({ ...base, status: "completed", conclusion: "neutral", output: { ...rest, annotations: last } });
}
