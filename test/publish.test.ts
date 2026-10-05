import { describe, expect, it, vi } from "vitest";
import { ANNOTATION_BATCH, finishCheck, publishNotes, updatePrBody } from "../src/github/publish";
import { NOTE_MARKER, SECTION_END, SECTION_START } from "../src/output/prBody";
import type { Annotation, Note } from "../src/output/render";

const target = { owner: "o", repo: "r", headSha: "abc" };

function fakeOctokit() {
  const update = vi.fn().mockResolvedValue({});
  return { octokit: { rest: { checks: { update } } } as never, update };
}

const note = (line: number): Annotation => ({
  path: "a.ts",
  start_line: line,
  end_line: line,
  annotation_level: "notice",
  title: "t",
  message: "m",
});

describe("finishCheck", () => {
  it("sends annotations in batches and completes on the last request", async () => {
    const { octokit, update } = fakeOctokit();
    const annotations = Array.from({ length: ANNOTATION_BATCH * 2 + 1 }, (_, i) => note(i + 1));
    await finishCheck(octokit, target, 1, { title: "t", summary: "s", text: "x", annotations });

    const calls = update.mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.output.annotations.length)).toEqual([ANNOTATION_BATCH, ANNOTATION_BATCH, 1]);
    expect(calls.map((c) => c.conclusion)).toEqual([undefined, undefined, "neutral"]);
  });

  it("completes in one request without annotations", async () => {
    const { octokit, update } = fakeOctokit();
    await finishCheck(octokit, target, 1, { title: "t", summary: "s", text: "" });
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0]).toMatchObject({ status: "completed", conclusion: "neutral" });
  });
});

const pull = { ...target, number: 7 };

const step: Note = { path: "a.ts", line: 3, level: "notice", title: "Step 1 of 1 (logic)", message: "Does a thing." };

function fakePulls(existing: object[]) {
  const calls: string[] = [];
  const createReview = vi.fn(async () => (calls.push("create"), { data: { id: 2 } }));
  const deleteReviewComment = vi.fn(async ({ comment_id }: { comment_id: number }) => (calls.push(`delete ${comment_id}`), {}));
  const listReviewComments = vi.fn();
  const paginate = vi.fn(async () => existing);
  const octokit = { paginate, rest: { pulls: { createReview, deleteReviewComment, listReviewComments } } } as never;
  return { octokit, calls, createReview };
}

const comment = (id: number, extra: object = {}) => ({
  id,
  body: `note ${NOTE_MARKER}`,
  user: { type: "Bot" },
  pull_request_review_id: 1,
  ...extra,
});

describe("publishNotes", () => {
  it("posts the new review before deleting old notes", async () => {
    const { octokit, calls, createReview } = fakePulls([comment(10)]);
    await publishNotes(octokit, pull, [step]);
    expect(calls).toEqual(["create", "delete 10"]);
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        pull_number: 7,
        commit_id: "abc",
        event: "COMMENT",
        comments: [{ path: "a.ts", line: 3, side: "RIGHT", body: expect.stringContaining(NOTE_MARKER) }],
      }),
    );
  });

  it("only deletes unreplied bot notes from earlier reviews", async () => {
    const { octokit, calls } = fakePulls([
      comment(10),
      comment(11, { user: { type: "User" } }),
      comment(12, { body: "no marker" }),
      comment(13, { pull_request_review_id: 2 }),
      comment(14),
      comment(15, { body: "a reply", user: { type: "User" }, in_reply_to_id: 14 }),
    ]);
    await publishNotes(octokit, pull, [step]);
    expect(calls).toEqual(["create", "delete 10"]);
  });

  it("skips the review but still clears old notes when there are none", async () => {
    const { octokit, calls, createReview } = fakePulls([comment(10)]);
    await publishNotes(octokit, pull, []);
    expect(createReview).not.toHaveBeenCalled();
    expect(calls).toEqual(["delete 10"]);
  });
});

describe("updatePrBody", () => {
  function fakeBody(body: string | null) {
    const get = vi.fn().mockResolvedValue({ data: { body } });
    const update = vi.fn().mockResolvedValue({});
    return { octokit: { rest: { pulls: { get, update } } } as never, get, update };
  }

  it("re-fetches the body and splices in the section", async () => {
    const { octokit, update } = fakeBody("Author text.");
    await updatePrBody(octokit, pull, "ours");
    expect(update).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      pull_number: 7,
      body: `Author text.

${SECTION_START}
ours
${SECTION_END}`,
    });
  });

  it("skips the write when nothing changed", async () => {
    const { octokit, update } = fakeBody(`${SECTION_START}
ours
${SECTION_END}`);
    await updatePrBody(octokit, pull, "ours");
    expect(update).not.toHaveBeenCalled();
  });
});
