import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import {
  type Content,
  contrast,
  LINT_RULE_IDS,
  lint,
  lintRules,
  parseContent,
  type Theme,
} from "../src/index.ts";

const fonts = loadBundledFonts();
const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");

function cv(yaml: string): Content {
  const r = parseContent(yaml);
  if (!r.value) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}

/** A CV that passes every rule, to vary one thing at a time. */
const CLEAN = `
basics:
  name: Jane Doe
  title: Engineer
  email: jane@example.com
  phone: "+39 000"
sections:
  - type: experience
    items: [{ company: Acme, role: Dev, start: 2020-01, end: present }]
  - type: education
    items: [{ institution: Uni, end: 2019 }]
  - type: skills
    items: [{ name: Cloud, keywords: [Azure] }]
`;

const codes = (c: Content, opts: Parameters<typeof lint>[1] = {}) =>
  lint(c, { fonts, ...opts }).map((d) => d.code.replace("lint/", ""));

describe("lint rules", () => {
  it("has an implementation, default level and summary for every rule id", () => {
    expect(
      lintRules()
        .map((r) => r.id)
        .sort(),
    ).toEqual([...LINT_RULE_IDS].sort());
    for (const r of lintRules()) expect(r.summary.length).toBeGreaterThan(20);
  });

  it("finds nothing in a clean CV or the fixtures", () => {
    expect(codes(cv(CLEAN))).toEqual([]);
    expect(codes(cv(readFileSync(join(FIXTURES, "basic", "cv.yaml"), "utf8")))).toEqual([]);
    expect(
      codes(cv(readFileSync(join(FIXTURES, "basic", "cv.yaml"), "utf8")), { locale: "it" }),
    ).toEqual([]);
  });

  it("nonstandard-heading: flags creative titles, accepts known ones", () => {
    const withTitle = (t: string) =>
      cv(CLEAN.replace("  - type: experience\n", `  - type: experience\n    title: "${t}"\n`));
    expect(codes(withTitle("My Journey"))).toEqual(["nonstandard-heading"]);
    expect(codes(withTitle("Work Experience:"))).toEqual([]);
    expect(codes(withTitle("Esperienze lavorative"))).toEqual([]);
    expect(lint(withTitle("My Journey"), { fonts })[0]).toMatchObject({
      severity: "warning",
      path: ["sections", 0, "title"],
      origin: "content",
      help: expect.stringContaining("'Experience'"),
    });
  });

  it("nonstandard-heading: accepts the usual headings of every built-in language", () => {
    const withTitle = (t: string) =>
      cv(CLEAN.replace("  - type: experience\n", `  - type: experience\n    title: "${t}"\n`));
    for (const t of [
      "Berufserfahrung",
      "Experiencia laboral",
      "Expériences professionnelles",
      "Werkervaring",
      "Experiência profissional",
    ]) {
      expect(codes(withTitle(t)), t).toEqual([]);
    }
    // Hyphenated entries match too (punctuation is ignored on both sides).
    const skills = cv(
      CLEAN.replace("  - type: skills\n", '  - type: skills\n    title: "IT-Kenntnisse"\n'),
    );
    expect(codes(skills)).toEqual([]);
  });

  it("nonstandard-heading: suggests the default heading in the language being checked", () => {
    const c = cv(
      CLEAN.replace("  - type: experience\n", '  - type: experience\n    title: "Mein Weg"\n'),
    );
    expect(lint(c, { locale: "de" })[0]).toMatchObject({
      code: "lint/nonstandard-heading",
      help: expect.stringContaining("'Berufserfahrung'"),
    });
  });

  it("missing-dates and date-order", () => {
    const c = cv(
      CLEAN.replace(
        "{ company: Acme, role: Dev, start: 2020-01, end: present }",
        "{ company: Acme, role: Dev }",
      ).replace("{ institution: Uni, end: 2019 }", "{ institution: Uni }"),
    );
    expect(codes(c)).toEqual(["missing-dates", "missing-dates"]);
    const swapped = cv(
      CLEAN.replace("start: 2020-01, end: present", "start: 2020-01, end: 2019-12"),
    );
    expect(lint(swapped, { fonts })).toMatchObject([
      { code: "lint/date-order", severity: "error", path: ["sections", 0, "items", 0, "end"] },
    ]);
    // Different precision is compared at the common precision.
    expect(
      codes(cv(CLEAN.replace("start: 2020-01, end: present", "start: 2020-01, end: 2020"))),
    ).toEqual([]);
  });

  it("missing contact fields and headline", () => {
    const c = cv(
      CLEAN.replace("  title: Engineer\n", "").replace("  email: jane@example.com\n", ""),
    );
    expect(codes(c)).toEqual(["missing-email", "missing-headline"]);
    expect(codes(cv(CLEAN.replace('  phone: "+39 000"\n', "")))).toEqual(["missing-phone"]);
  });

  it("no-skills and empty-section", () => {
    const c = cv(CLEAN.replace("    items: [{ name: Cloud, keywords: [Azure] }]", "    items: []"));
    expect(codes(c)).toEqual(["no-skills", "empty-section"]);
  });

  it("photo", () => {
    expect(
      codes(cv(CLEAN.replace("  title: Engineer\n", "  title: Engineer\n  photo: me.jpg\n"))),
    ).toEqual(["photo"]);
  });

  it("large-photo: flags photos over 1 MB, when the photo bytes are given", () => {
    const c = cv(CLEAN.replace("  title: Engineer\n", "  title: Engineer\n  photo: me.jpg\n"));
    const assets = (n: number) => ({ "me.jpg": new Uint8Array(n) });
    expect(codes(c, { assets: assets(1_000_000) })).toEqual(["photo"]);
    expect(codes(c)).toEqual(["photo"]);
    const ds = lint(c, { assets: assets(4_200_000) }).filter((d) => d.code === "lint/large-photo");
    expect(ds).toMatchObject([
      {
        severity: "warning",
        message: expect.stringContaining("4.2 MB"),
        path: ["basics", "photo"],
      },
    ]);
  });

  it("emoji and missing-glyphs report the field and the characters", () => {
    const c = cv(
      CLEAN.replace("role: Dev", 'role: "Dev 🚀"').replace("name: Cloud", 'name: "Cloud ⟁ 漢"'),
    );
    const ds = lint(c, { fonts });
    expect(ds).toMatchObject([
      {
        code: "lint/emoji",
        path: ["sections", 0, "items", 0, "role"],
        message: "Text contains 🚀",
      },
      {
        code: "lint/missing-glyphs",
        severity: "error",
        path: ["sections", 2, "items", 0, "name"],
        message: expect.stringContaining("'⟁' (U+27C1), '漢' (U+6F22)"),
      },
    ]);
    // Without fonts the glyph rule cannot run.
    expect(lint(c).map((d) => d.code)).toEqual(["lint/emoji"]);
  });

  it("accepts accented Latin text the bundled font covers", () => {
    expect(
      codes(cv(CLEAN.replace("role: Dev", 'role: "Développeuse Ąę Łódź – Città ü ß"'))),
    ).toEqual([]);
  });

  it("checks the selected language's text", () => {
    const c = cv(CLEAN.replace("role: Dev", "role: { en: Dev, it: 'Svilupp 漢' }"));
    expect(codes(c, { locale: "en" })).toEqual([]);
    expect(codes(c, { locale: "it" })).toEqual(["missing-glyphs"]);
  });

  it("theme rules only flag values the user set", () => {
    const theme: Theme = {
      page: { size: "A4", margins: "5mm" },
      tokens: {
        fonts: { body: { family: "Source Sans 3", size: "8pt" } },
        colors: { muted: "#bbbbbb", accent: "#1f4e79" },
      },
    };
    expect(lint(cv(CLEAN), { fonts, theme })).toMatchObject([
      { code: "lint/small-font", path: ["tokens", "fonts", "body", "size"], origin: "theme" },
      { code: "lint/low-contrast", path: ["tokens", "colors", "muted"], origin: "theme" },
      { code: "lint/narrow-margins", severity: "info", path: ["page", "margins"], origin: "theme" },
    ]);
    expect(codes(cv(CLEAN), { theme: {} })).toEqual([]);
  });

  it("too-long uses the page count when given", () => {
    expect(codes(cv(CLEAN), { pages: 2 })).toEqual([]);
    expect(codes(cv(CLEAN), { pages: 3 })).toEqual(["too-long"]);
  });
});

describe("lint configuration (meta.lint)", () => {
  it("turns rules off and changes their level", () => {
    const c = cv(
      `meta: { lint: { missing-phone: error, missing-headline: off } }\n${CLEAN.replace("  title: Engineer\n", "").replace('  phone: "+39 000"\n', "")}`,
    );
    expect(lint(c, { fonts })).toMatchObject([{ code: "lint/missing-phone", severity: "error" }]);
  });

  it("rejects unknown rule names and levels with located errors", () => {
    const r = parseContent(`meta: { lint: { phot: off, emoji: loud } }\n${CLEAN}`);
    expect(r.value).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(["invalid-value", "unknown-property"]);
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777", "#fff")).toBeCloseTo(4.48, 2);
  });
});
