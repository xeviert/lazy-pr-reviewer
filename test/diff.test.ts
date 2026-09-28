import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, visibleHeadLines } from "../src/analysis/diff";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import express from "express";
+import { rateLimit } from "./middleware/rateLimit";
 const app = express();
-app.use(logger);
+app.use(rateLimit);
 app.listen(3000);
@@ -20,2 +21,3 @@ function routes() {
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/src/middleware/rateLimit.ts b/src/middleware/rateLimit.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/middleware/rateLimit.ts
@@ -0,0 +1,2 @@
+--- not a header, just content
+export const rateLimit = () => {};
diff --git a/old.ts b/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/src/a b.ts b/src/c d.ts
similarity index 90%
rename from src/a b.ts
rename to src/c d.ts
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(DIFF);

  it("finds every file with its status", () => {
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ["src/app.ts", "modified", false],
      ["src/middleware/rateLimit.ts", "added", false],
      ["old.ts", "deleted", false],
      ["src/c d.ts", "renamed", false],
      ["logo.png", "modified", true],
    ]);
    expect(files[3]!.oldPath).toBe("src/a b.ts");
  });

  it("numbers head-side lines across hunks", () => {
    const app = files[0]!;
    const added = app.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add"));
    expect(added.map((l) => [l.newLine, l.text])).toEqual([
      [2, 'import { rateLimit } from "./middleware/rateLimit";'],
      [4, "app.use(rateLimit);"],
      [22, "const b = 2;"],
    ]);
    expect([...visibleHeadLines(app)]).toEqual([1, 2, 3, 4, 5, 21, 22, 23]);
  });

  it("treats header-like lines inside a hunk as content", () => {
    expect(files[1]!.hunks[0]!.lines[0]).toEqual({ kind: "add", text: "--- not a header, just content", newLine: 1 });
  });

  it("strips CRLF line endings", () => {
    const [file] = parseUnifiedDiff(DIFF.replace(/\n/g, "\r\n"));
    expect(file!.hunks[0]!.lines[1]!.text).toBe('import { rateLimit } from "./middleware/rateLimit";');
  });
});
