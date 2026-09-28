import { addedLines, type FileDiff } from "./diff";

export type FactKind = "dependency" | "script" | "env" | "network" | "filesystem" | "process" | "dynamic-code" | "export" | "ci";

export interface Fact {
  id: string;
  kind: FactKind;
  path: string;
  line?: number;
  detail: string;
}

type Draft = Omit<Fact, "id">;

interface LineRule {
  kind: FactKind;
  pattern: RegExp;
  /** Builds the detail from a match. */
  detail: (m: RegExpExecArray) => string;
  /** Limit the rule to these extensions. */
  extensions?: string[];
}

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const envName = (m: RegExpExecArray) => `reads \`${m[1]}\``;
const call = (label: string) => () => `\`${label}\` call`;

const LINE_RULES: LineRule[] = [
  { kind: "env", pattern: /process\.env\.([A-Za-z_][\w]*)/g, detail: envName },
  { kind: "env", pattern: /process\.env\[\s*['"`]([^'"`]+)['"`]\s*\]/g, detail: envName },
  { kind: "env", pattern: /\bprocess\.env\b(?!\s*[.[])/g, detail: () => "reads the whole environment: `process.env`" },
  { kind: "env", pattern: /import\.meta\.env\.([A-Za-z_][\w]*)/g, detail: envName },
  { kind: "env", pattern: /Deno\.env\.get\(\s*['"]([^'"]+)['"]/g, detail: envName },
  { kind: "env", pattern: /os\.(?:getenv|environ\.get)\(\s*['"]([^'"]+)['"]/g, detail: envName },
  { kind: "env", pattern: /os\.environ\[\s*['"]([^'"]+)['"]\s*\]/g, detail: envName },
  { kind: "env", pattern: /os\.(?:Getenv|LookupEnv)\(\s*"([^"]+)"/g, detail: envName },
  { kind: "env", pattern: /env::var\(\s*"([^"]+)"/g, detail: envName },

  { kind: "network", pattern: /(?<![\w.])fetch\s*\(/g, detail: call("fetch()") },
  { kind: "network", pattern: /\b(?:window|globalThis|self)\.fetch\s*\(/g, detail: call("fetch()") },
  { kind: "network", pattern: /\baxios(?:\.\w+)?\s*\(/g, detail: call("axios") },
  { kind: "network", pattern: /\bhttps?\.(?:request|get)\s*\(/g, detail: call("http.request") },
  { kind: "network", pattern: /\bnew\s+WebSocket\s*\(/g, detail: call("new WebSocket()") },
  { kind: "network", pattern: /\bXMLHttpRequest\b/g, detail: call("XMLHttpRequest") },
  { kind: "network", pattern: /\bnet\.(?:connect|createConnection)\s*\(/g, detail: call("net.connect") },
  { kind: "network", pattern: /\brequests\.(?:get|post|put|patch|delete|request)\s*\(/g, detail: call("requests") },
  { kind: "network", pattern: /\burllib\.request\b/g, detail: call("urllib.request") },
  { kind: "network", pattern: /\bhttp\.(?:Get|Post|NewRequest)\s*\(/g, detail: call("http.NewRequest") },

  {
    kind: "filesystem",
    pattern:
      /\b(?:fs|fsp|fs\.promises)\.(writeFile|appendFile|rm|rmdir|unlink|rename|copyFile|mkdir|chmod|createWriteStream|writeFileSync|appendFileSync|rmSync|rmdirSync|unlinkSync|renameSync|copyFileSync|mkdirSync|chmodSync)\b/g,
    detail: (m) => `writes or deletes files: \`fs.${m[1]}\``,
  },
  {
    kind: "filesystem",
    pattern: /(?<![\w.])(writeFileSync|appendFileSync|rmSync|unlinkSync|rmdirSync)\s*\(/g,
    detail: (m) => `writes or deletes files: \`${m[1]}\``,
  },
  { kind: "filesystem", pattern: /\bshutil\.rmtree\b|\bos\.(?:remove|unlink|rmdir)\s*\(/g, detail: (m) => `deletes files: \`${m[0]}\`` },
  { kind: "filesystem", pattern: /\bos\.(?:WriteFile|Remove|RemoveAll)\s*\(/g, detail: (m) => `writes or deletes files: \`${m[0]}\`` },

  { kind: "process", pattern: /\bchild_process\b/g, detail: () => "uses `child_process`" },
  {
    kind: "process",
    // Not preceded by "." so `regex.exec(` doesn't match.
    pattern: /(?<![\w.])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g,
    detail: (m) => `runs a process: \`${m[1]}()\``,
    extensions: JS_EXTENSIONS,
  },
  { kind: "process", pattern: /\b(execa|Bun\.spawn|Deno\.Command)\b/g, detail: (m) => `runs a process: \`${m[1]}\`` },
  { kind: "process", pattern: /\bsubprocess\.\w+|\bos\.system\s*\(/g, detail: (m) => `runs a process: \`${m[0]}\`` },
  { kind: "process", pattern: /\bexec\.Command\s*\(/g, detail: () => "runs a process: `exec.Command`" },

  { kind: "dynamic-code", pattern: /(?<![\w.])eval\s*\(/g, detail: () => "evaluates code at runtime: `eval()`" },
  { kind: "dynamic-code", pattern: /\bnew\s+Function\s*\(/g, detail: () => "evaluates code at runtime: `new Function()`" },
  { kind: "dynamic-code", pattern: /\bvm\.run\w*/g, detail: (m) => `evaluates code at runtime: \`${m[0]}\`` },
  { kind: "dynamic-code", pattern: /\bdangerouslySetInnerHTML\b/g, detail: () => "renders raw HTML: `dangerouslySetInnerHTML`" },
  { kind: "dynamic-code", pattern: /\.(?:innerHTML|outerHTML)\s*=(?!=)/g, detail: () => "renders raw HTML: `innerHTML` assignment" },

  {
    kind: "export",
    pattern:
      /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    detail: (m) => `exports \`${m[1]}\``,
    extensions: JS_EXTENSIONS,
  },
  {
    kind: "export",
    pattern: /^\s*export\s+default\s+(?!(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|enum)\b)/g,
    detail: () => "adds a default export",
    extensions: JS_EXTENSIONS,
  },
  {
    kind: "export",
    pattern: /^\s*export\s+(?:type\s+)?\{([^}]*)\}/g,
    detail: (m) => `exports ${formatNames(m[1] ?? "")}`,
    extensions: JS_EXTENSIONS,
  },
  {
    kind: "export",
    pattern: /^\s*export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,
    detail: (m) => `re-exports everything from \`${m[1]}\``,
    extensions: JS_EXTENSIONS,
  },
  { kind: "export", pattern: /\bmodule\.exports\b/g, detail: () => "assigns `module.exports`", extensions: JS_EXTENSIONS },
];

const OTHER_MANIFESTS = [
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)go\.mod$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)Gemfile$/,
  /(^|\/)composer\.json$/,
  /(^|\/)pom\.xml$/,
  /(^|\/)build\.gradle(\.kts)?$/,
];

const CI_PATH = /^\.github\/(workflows|actions)\//;

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

export interface ManifestContents {
  path: string;
  before?: string;
  after?: string;
}

export function extractFacts(files: FileDiff[], manifests: ManifestContents[]): Fact[] {
  const drafts: Draft[] = [];

  for (const file of files) {
    if (CI_PATH.test(file.path)) drafts.push({ kind: "ci", path: file.path, detail: `CI workflow or action ${file.status}` });
    if (OTHER_MANIFESTS.some((re) => re.test(file.path))) drafts.push(manifestChanged(file));
    drafts.push(...lineFacts(file));
  }
  for (const manifest of manifests) drafts.push(...packageJsonFacts(manifest));

  return assignIds(dedupe(drafts));
}

export function isPackageJson(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

function lineFacts(file: FileDiff): Draft[] {
  const ext = extensionOf(file.path);
  const rules = LINE_RULES.filter((r) => !r.extensions || r.extensions.includes(ext));
  const drafts: Draft[] = [];

  for (const line of addedLines(file)) {
    if (isComment(line.text, ext)) continue;
    for (const rule of rules) {
      for (const m of line.text.matchAll(rule.pattern)) {
        drafts.push({ kind: rule.kind, path: file.path, line: line.newLine, detail: rule.detail(m as RegExpExecArray) });
      }
    }
  }
  return drafts;
}

function manifestChanged(file: FileDiff): Draft {
  const lines = file.hunks.flatMap((h) => h.lines);
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;
  return { kind: "dependency", path: file.path, detail: `dependency manifest ${file.status} (+${added} / -${removed} lines)` };
}

function packageJsonFacts({ path, before, after }: ManifestContents): Draft[] {
  const old = parseJson(before);
  const next = parseJson(after);
  if ((before && !old) || (after && !next)) return [{ kind: "dependency", path, detail: "package.json changed but could not be parsed" }];

  const drafts: Draft[] = [];
  for (const section of DEP_SECTIONS) {
    const a = record(old?.[section]);
    const b = record(next?.[section]);
    for (const [name, version] of Object.entries(b)) {
      if (!(name in a)) drafts.push({ kind: "dependency", path, detail: `adds ${label(section)} \`${name}\` ${version}` });
      else if (a[name] !== version) drafts.push({ kind: "dependency", path, detail: `changes ${label(section)} \`${name}\` ${a[name]} → ${version}` });
    }
    for (const name of Object.keys(a)) {
      if (!(name in b)) drafts.push({ kind: "dependency", path, detail: `removes ${label(section)} \`${name}\`` });
    }
  }

  const oldScripts = record(old?.scripts);
  const newScripts = record(next?.scripts);
  for (const [name, command] of Object.entries(newScripts)) {
    if (!(name in oldScripts)) drafts.push({ kind: "script", path, detail: `adds npm script \`${name}\`: \`${command}\`` });
    else if (oldScripts[name] !== command) drafts.push({ kind: "script", path, detail: `changes npm script \`${name}\` to \`${command}\`` });
  }
  for (const name of Object.keys(oldScripts)) {
    if (!(name in newScripts)) drafts.push({ kind: "script", path, detail: `removes npm script \`${name}\`` });
  }
  return drafts;
}

function label(section: (typeof DEP_SECTIONS)[number]): string {
  return section === "dependencies" ? "dependency" : section.replace(/Dependencies$/, " dependency");
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
}

function formatNames(list: string): string {
  const names = list
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
    .filter(Boolean);
  return names.map((n) => `\`${n}\``).join(", ");
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(dot) : "";
}

function isComment(text: string, ext: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("* ") || t === "*") return true;
  // `#` starts private fields in JS, so only treat it as a comment elsewhere.
  return t.startsWith("#") && !JS_EXTENSIONS.includes(ext);
}

function dedupe(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = `${d.kind}|${d.path}|${d.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assignIds(drafts: Draft[]): Fact[] {
  return drafts
    .sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0))
    .map((d, i) => ({ id: `F${i + 1}`, ...d }));
}
