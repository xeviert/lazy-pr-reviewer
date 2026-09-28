export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffLine {
  kind: "add" | "del" | "context";
  text: string;
  /** Line number in the head version. Absent for deleted lines. */
  newLine?: number;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses `git diff` output. Expects `core.quotePath=false`. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let newLine = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (line.startsWith("diff --git ")) {
      file = { path: pathFromGitHeader(line), status: "modified", binary: false, hunks: [] };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;

    const header = HUNK_HEADER.exec(line);
    if (header) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      newLine = Number(header[1]);
      continue;
    }

    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.oldPath = line.slice("rename from ".length);
        file.status = "renamed";
      } else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
      else if (line.startsWith("Binary files ")) file.binary = true;
      else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) file.path = stripPrefix(line.slice(4));
      continue;
    }

    if (line.startsWith("+")) hunk.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    else if (line.startsWith("-")) hunk.lines.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) hunk.lines.push({ kind: "context", text: line.slice(1), newLine: newLine++ });
  }

  return files;
}

function stripPrefix(path: string): string {
  const trimmed = unquote(path.replace(/\t$/, ""));
  return trimmed.startsWith("a/") || trimmed.startsWith("b/") ? trimmed.slice(2) : trimmed;
}

function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/** Best effort: `diff --git a/x b/x`. Overwritten by `+++` or `rename to` when present. */
function pathFromGitHeader(line: string): string {
  const rest = line.slice("diff --git ".length);
  // Same path on both sides: "a/" + p + " b/" + p, so p has length (len - 5) / 2.
  const len = (rest.length - 5) / 2;
  if (Number.isInteger(len) && rest.slice(2, 2 + len) === rest.slice(len + 5)) return rest.slice(2, 2 + len);
  const split = rest.lastIndexOf(" b/");
  return split === -1 ? rest : rest.slice(split + 3);
}

export function addedLines(file: FileDiff): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add"));
}

/** Head-side line numbers visible in the diff. GitHub can only anchor links and comments to these. */
export function visibleHeadLines(file: FileDiff): Set<number> {
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) if (line.newLine !== undefined) lines.add(line.newLine);
  }
  return lines;
}
