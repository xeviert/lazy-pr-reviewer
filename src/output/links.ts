import { createHash } from "node:crypto";

export interface PrRef {
  serverUrl: string;
  owner: string;
  repo: string;
  number: number;
}

/** GitHub's Files tab anchor: `diff-` + sha256 of the path, then `R<line>` for the head side. */
export function diffLink(pr: PrRef, path: string, line?: number): string {
  const anchor = `diff-${createHash("sha256").update(path).digest("hex")}`;
  return `${pr.serverUrl}/${pr.owner}/${pr.repo}/pull/${pr.number}/files#${anchor}${line === undefined ? "" : `R${line}`}`;
}
