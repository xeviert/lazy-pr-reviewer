export const SECTION_START = "<!-- lazy-pr-reviewer:start -->";
export const SECTION_END = "<!-- lazy-pr-reviewer:end -->";

/** Hidden tag on every review comment we post, so the next run can find and replace them. */
export const NOTE_MARKER = "<!-- lazy-pr-reviewer -->";

/** Replaces our marked section of the PR body, or appends one. The author's text outside the markers is left alone. */
export function spliceSection(body: string, section: string): string {
  const block = `${SECTION_START}\n${section}\n${SECTION_END}`;
  const range = findSection(body);
  if (!range) return body.trim() ? `${body.trimEnd()}\n\n${block}` : block;
  return body.slice(0, range.start) + block + body.slice(range.end);
}

/** The PR body without our section. The body is model input, so this keeps our own output out of the next run's prompt. */
export function stripSection(body: string): string {
  const range = findSection(body);
  return range ? (body.slice(0, range.start) + body.slice(range.end)).trim() : body;
}

export function extractSection(body: string): string | undefined {
  const range = findSection(body);
  return range ? body.slice(range.start + SECTION_START.length, range.end - SECTION_END.length).trim() : undefined;
}

function findSection(body: string): { start: number; end: number } | undefined {
  const start = body.indexOf(SECTION_START);
  if (start === -1) return undefined;
  const end = body.indexOf(SECTION_END, start);
  if (end === -1) return undefined;
  return { start, end: end + SECTION_END.length };
}
