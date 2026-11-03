import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentJsonSchema,
  type Diagnostic,
  formatDiagnostic,
  parseContent,
  parseTheme,
} from "../src/index.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", name), "utf8");

const codes = (ds: Diagnostic[]) => ds.map((d) => d.code);

const minimal = `
basics:
  name: Jane
  email: jane@example.com
`;

describe("parseContent", () => {
  it("parses the basic fixture without diagnostics", () => {
    const r = parseContent(fixture("basic/cv.yaml"), { file: "cv.yaml" });
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.basics.name).toBe("Jane Doe");
    expect(r.value?.sections.map((s) => s.type)).toEqual([
      "experience",
      "education",
      "skills",
      "languages",
      "custom",
    ]);
  });

  it("normalizes bare-year dates to strings", () => {
    const r = parseContent(fixture("basic/cv.yaml"));
    const exp = r.value?.sections[0];
    expect(exp?.type === "experience" && exp.items[1]?.start).toBe("2016");
  });

  it("defaults sections to an empty list", () => {
    const r = parseContent(minimal);
    expect(r.value?.sections).toEqual([]);
  });

  it("reports YAML syntax errors with position", () => {
    const r = parseContent("basics:\n  name: [unclosed\n");
    expect(r.value).toBeUndefined();
    expect(r.diagnostics[0]?.code).toBe("yaml-syntax");
    expect(r.diagnostics[0]?.range?.start.line).toBeGreaterThan(0);
  });

  it("reports duplicate keys", () => {
    const r = parseContent("basics:\n  name: A\n  name: B\n  email: a@b.co\n");
    expect(codes(r.diagnostics)).toContain("yaml-syntax");
  });

  it("locates unknown properties at the key", () => {
    const r = parseContent(`${minimal}  nmae: typo\n`, { file: "cv.yaml" });
    expect(r.value).toBeUndefined();
    const d = r.diagnostics.find((x) => x.code === "unknown-property");
    expect(d?.message).toContain("'nmae'");
    expect(d?.range?.start).toEqual({ line: 5, column: 3 });
    expect(d && formatDiagnostic(d)).toMatch(/^cv\.yaml:5:3: error \[unknown-property\]/);
  });

  it("reports missing required properties", () => {
    const r = parseContent("basics:\n  email: jane@example.com\n");
    const d = r.diagnostics.find((x) => x.code === "required");
    expect(d?.message).toBe("Missing required property 'name' in 'basics'");
    expect(d?.range?.start.line).toBe(1);
  });

  it("reports unknown section types with the valid list", () => {
    const r = parseContent(`${minimal}sections:\n  - type: hobbies\n    items: []\n`);
    const d = r.diagnostics.find((x) => x.code === "unknown-section-type");
    expect(d?.message).toContain("experience, education");
    expect(d?.range?.start.line).toBe(6);
  });

  it("validates date formats", () => {
    const r = parseContent(
      `${minimal}sections:\n  - type: experience\n    items:\n      - { company: A, role: B, start: 2021-13 }\n`,
    );
    expect(r.diagnostics.map((d) => d.message).join()).toContain("Expected a date");
  });

  it("requires at least one contact (opinionated basics)", () => {
    const r = parseContent("basics:\n  name: Jane\n");
    expect(r.value).toBeUndefined();
    expect(codes(r.diagnostics)).toEqual(["missing-contact"]);
  });

  it("rejects duplicate section ids", () => {
    const r = parseContent(
      `${minimal}sections:\n  - { type: skills, items: [] }\n  - { type: skills, items: [] }\n`,
    );
    expect(codes(r.diagnostics)).toEqual(["duplicate-section-id"]);
    expect(r.diagnostics[0]?.range?.start.line).toBe(7);
  });

  it("warns about locales not declared in meta.locales", () => {
    const r = parseContent(
      `meta: { locales: [en] }\nbasics:\n  name: Jane\n  email: j@example.com\n  title: { en: Dev, fr: Dév }\n`,
    );
    expect(r.value).toBeDefined();
    expect(r.diagnostics).toMatchObject([
      { code: "unknown-locale", severity: "warning", path: ["basics", "title", "fr"] },
    ]);
  });
});

describe("parseTheme", () => {
  it("parses a theme and applies defaults", () => {
    const r = parseTheme(
      "extends: default\npage: { size: Letter }\ntokens:\n  colors: { accent: '#0055aa' }\n",
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.page).toEqual({ size: "Letter", margins: "18mm" });
  });

  it("rejects invalid lengths and colors", () => {
    const r = parseTheme("page: { margins: 2km }\ntokens:\n  colors: { accent: blue }\n");
    expect(r.diagnostics).toHaveLength(2);
  });
});

describe("JSON Schema", () => {
  it("is generated from the model and stable", () => {
    const a = JSON.stringify(contentJsonSchema());
    const b = JSON.stringify(contentJsonSchema());
    expect(a).toBe(b);
    expect(contentJsonSchema()).toMatchObject({ type: "object", required: ["basics"] });
  });
});

describe("diagnostic quality", () => {
  it("distinguishes wrong types from missing properties", () => {
    const r = parseContent("basics:\n  name: 5\n  email: j@example.com\n");
    expect(r.diagnostics).toMatchObject([
      { code: "invalid-type", message: "Expected string, got number 5 at 'basics.name'" },
    ]);
  });

  it("explains unquoted colons in text", () => {
    const r = parseContent(
      `${minimal}sections:\n  - type: experience\n    items:\n      - company: A\n        role: B\n        highlights:\n          - Led X: did Y\n`,
    );
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      code: "invalid-text",
      range: { start: { line: 11 } },
    });
    expect(r.diagnostics[0]?.message).toContain('wrap it in quotes: "Led X: ..."');
  });
});
