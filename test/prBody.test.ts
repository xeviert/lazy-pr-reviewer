import { describe, expect, it } from "vitest";
import { SECTION_END, SECTION_START, spliceSection, stripSection } from "../src/output/prBody";

const block = (section: string) => `${SECTION_START}\n${section}\n${SECTION_END}`;

describe("spliceSection", () => {
  it("appends a section to a body without one", () => {
    expect(spliceSection("Author text.\n", "new")).toBe(`Author text.\n\n${block("new")}`);
  });

  it("uses only the section for an empty body", () => {
    expect(spliceSection("", "new")).toBe(block("new"));
  });

  it("replaces an existing section and keeps the author's text around it", () => {
    const body = `Before.\n\n${block("old")}\n\nAfter.`;
    expect(spliceSection(body, "new")).toBe(`Before.\n\n${block("new")}\n\nAfter.`);
  });

  it("appends when the end marker is missing, and the next run repairs it", () => {
    const broken = `Text ${SECTION_START} dangling`;
    const once = spliceSection(broken, "new");
    expect(once).toBe(`${broken}\n\n${block("new")}`);
    expect(spliceSection(once, "newer")).toBe(`Text ${block("newer")}`);
  });
});

describe("stripSection", () => {
  it("removes the section so it isn't fed back to the model", () => {
    expect(stripSection(spliceSection("Author text.", "ours"))).toBe("Author text.");
  });

  it("leaves bodies without a section unchanged", () => {
    expect(stripSection("  Author text.\n")).toBe("  Author text.\n");
  });
});
