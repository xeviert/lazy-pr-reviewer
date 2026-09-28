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

/** Always `neutral`: the explanation is not a verdict, so it shouldn't show as a pass or a fail. */
export async function finishCheck(octokit: Octokit, target: CheckTarget, checkRunId: number, output: CheckOutput): Promise<void> {
  await octokit.rest.checks.update({
    owner: target.owner,
    repo: target.repo,
    check_run_id: checkRunId,
    status: "completed",
    conclusion: "neutral",
    output,
  });
}
