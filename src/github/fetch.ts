import { execFileSync } from "node:child_process";
import { isPackageJson, type ManifestContents } from "../analysis/facts";
import { parseUnifiedDiff, type FileDiff } from "../analysis/diff";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasCommit(cwd: string, sha: string): boolean {
  try {
    git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export interface LocalDiff {
  mergeBase: string;
  files: FileDiff[];
}

/** Same comparison GitHub shows on the Files tab: merge base of base and head, to head. */
export function loadDiff(cwd: string, baseSha: string, headSha: string): LocalDiff {
  for (const sha of [baseSha, headSha]) {
    if (!hasCommit(cwd, sha)) git(cwd, ["fetch", "--no-tags", "origin", sha]);
  }

  let mergeBase: string;
  try {
    mergeBase = git(cwd, ["merge-base", baseSha, headSha]).trim();
  } catch {
    throw new Error("No merge base between base and head. Check out the repo with `actions/checkout` and `fetch-depth: 0`.");
  }

  const text = git(cwd, ["diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", mergeBase, headSha]);
  return { mergeBase, files: parseUnifiedDiff(text) };
}

export function readFileAt(cwd: string, sha: string, path: string): string | undefined {
  try {
    return git(cwd, ["show", `${sha}:${path}`]);
  } catch {
    return undefined;
  }
}

export function loadManifests(cwd: string, diff: LocalDiff, headSha: string): ManifestContents[] {
  return diff.files
    .filter((f) => isPackageJson(f.path))
    .map((f) => ({
      path: f.path,
      before: f.status === "added" ? undefined : readFileAt(cwd, diff.mergeBase, f.oldPath ?? f.path),
      after: f.status === "deleted" ? undefined : readFileAt(cwd, headSha, f.path),
    }));
}

export function resolveRef(cwd: string, ref: string): string {
  return git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}
