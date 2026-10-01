import * as core from "@actions/core";
import type { getOctokit } from "@actions/github";
import { NOTE_MARKER, spliceSection } from "../output/prBody";
import { toCommentBody, type CheckOutput, type Note } from "../output/render";

type Octokit = ReturnType<typeof getOctokit>;

export const CHECK_NAME = "Lazy PR Reviewer";

export interface CheckTarget {
  owner: string;
  repo: string;
  headSha: string;
}

export interface PullTarget extends CheckTarget {
  number: number;
}

export async function startCheck(octokit: Octokit, target: CheckTarget): Promise<{ id: number; url: string }> {
  const { data } = await octokit.rest.checks.create({
    owner: target.owner,
    repo: target.repo,
    name: CHECK_NAME,
    head_sha: target.headSha,
    status: "in_progress",
  });
  return { id: data.id, url: data.html_url ?? "" };
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

/**
 * Posts notes as one `COMMENT` review, then deletes the previous runs' notes.
 * Posting first means a failed post leaves the old notes up. Throws only if posting fails.
 */
export async function publishNotes(octokit: Octokit, target: PullTarget, notes: Note[]): Promise<void> {
  const pull = { owner: target.owner, repo: target.repo, pull_number: target.number };
  let reviewId: number | undefined;
  if (notes.length > 0) {
    const { data } = await octokit.rest.pulls.createReview({
      ...pull,
      commit_id: target.headSha,
      event: "COMMENT",
      comments: notes.map((n) => ({ path: n.path, line: n.line, side: "RIGHT", body: toCommentBody(n) })),
    });
    reviewId = data.id;
  }

  try {
    const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { ...pull, per_page: 100 });
    const replied = new Set(comments.map((c) => c.in_reply_to_id).filter((id) => id !== undefined));
    const stale = comments.filter(
      (c) => c.user?.type === "Bot" && c.body.includes(NOTE_MARKER) && c.pull_request_review_id !== reviewId && !replied.has(c.id),
    );
    for (const c of stale) await octokit.rest.pulls.deleteReviewComment({ owner: target.owner, repo: target.repo, comment_id: c.id });
  } catch (error) {
    core.warning(`Couldn't remove notes from earlier runs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Re-fetches the body right before writing, to keep the window for clobbering an author's edit small. */
export async function updatePrBody(octokit: Octokit, target: PullTarget, section: string): Promise<void> {
  const pull = { owner: target.owner, repo: target.repo, pull_number: target.number };
  const { data } = await octokit.rest.pulls.get(pull);
  const before = data.body ?? "";
  const after = spliceSection(before, section);
  if (after !== before) await octokit.rest.pulls.update({ ...pull, body: after });
}
