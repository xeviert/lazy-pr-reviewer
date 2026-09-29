import { describe, expect, it, vi } from "vitest";
import { ANNOTATION_BATCH, finishCheck } from "../src/github/publish";
import type { Annotation } from "../src/output/render";

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
