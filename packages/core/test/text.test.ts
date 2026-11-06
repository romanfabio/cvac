import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMarkdown, buildText, layout, parseContent } from "../src/index.ts";
import { FIXTURES, fixtureOptions, loadFixture } from "./fixtures.ts";

/**
 * Markdown and plain text. Their goldens are the files themselves
 * (fixtures/golden-text/), so a change shows up as a readable diff.
 * UPDATE_GOLDEN=1 rewrites them, as for the PDF and DOCX hashes.
 */

const GOLDEN_DIR = join(FIXTURES, "golden-text");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** [fixture[:variant][+theme], locale] */
const CASES: [string, string][] = [
  ["basic", "en"],
  ["basic", "it"],
  ["long", "en"],
  ["sidebar", "en"],
  ["variants:backend", "en"],
  ["multilingual", "fr"],
  ["basic+minimal", "en"],
];

const fileName = (name: string, locale: string, ext: string) =>
  `${name.replace(":", "@").replace("+", "~")}.${locale}.${ext}`;

function build(name: string, locale: string) {
  const f = loadFixture(name);
  const opts = { locale, ...fixtureOptions(f) };
  const md = buildMarkdown(f.content, opts);
  const txt = buildText(f.content, opts);
  if (md.text === undefined || txt.text === undefined) {
    throw new Error(JSON.stringify([...md.diagnostics, ...txt.diagnostics]));
  }
  return { md: md.text, txt: txt.text };
}

function golden(file: string, actual: string) {
  const path = join(GOLDEN_DIR, file);
  if (UPDATE || !existsSync(path)) {
    if (!UPDATE) throw new Error(`No golden file ${file}; run UPDATE_GOLDEN=1 npm test`);
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  expect(actual, `${file} changed; if intended, run UPDATE_GOLDEN=1 npm test`).toBe(
    readFileSync(path, "utf8"),
  );
}

describe("golden Markdown and text", () => {
  for (const [name, locale] of CASES) {
    it(`${name}.${locale}`, () => {
      const { md, txt } = build(name, locale);
      golden(fileName(name, locale, "md"), md);
      golden(fileName(name, locale, "txt"), txt);
    });
  }
});

/** Strip the Markdown this renderer writes, leaving the text. */
function unMarkdown(md: string): string {
  return md
    .replace(/\\\n/g, "\n")
    .replace(/^#{1,3} |^- /gm, "")
    .replace(/(?<!\\)\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*>|[^)\s]*)\)/g, "$1")
    .replace(/(?<!\\)\*/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/&amp;/g, "&");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("text round-trip", () => {
  for (const [name, locale] of [...CASES, ["long+academic", "en"] as [string, string]]) {
    it(`${name}.${locale}: every run is in both files, in CV order`, () => {
      const f = loadFixture(name);
      const l = layout(f.content, { locale, linear: true, ...fixtureOptions(f) }).layout;
      if (!l) throw new Error("layout failed");
      const runs = l.blocks
        .flatMap((b) => (b.kind === "group" ? b.blocks : [b]))
        .flatMap((p) => [...p.runs, ...(p.aside ?? [])])
        .map((r) => norm(r.text))
        .filter(Boolean);
      const { md, txt } = build(name, locale);
      for (const [label, text] of [
        ["md", norm(unMarkdown(md))],
        ["txt", norm(txt)],
      ] as const) {
        let pos = 0;
        for (const run of runs) {
          const at = text.indexOf(run, pos);
          expect(at, `${label}: "${run}" missing or out of order`).toBeGreaterThanOrEqual(0);
          pos = at + run.length;
        }
      }
    });
  }
});

const cv = (body: string) => {
  const r = parseContent(`version: 1\n${body}`);
  if (!r.value) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
};

describe("Markdown", () => {
  it("escapes characters that would become Markdown syntax", () => {
    const md = buildMarkdown(
      cv(`basics:
  name: "Ann *Star* <b>"
  email: ann@example.com
  summary: "1. Built [things] with snake_case & C#, ~2 years"
sections:
  - type: custom
    title: "# Notes"
    items:
      - title: "- not a list"
        url: "https://example.com/a_(b)"
        highlights: ["+ plus", "> quote", "\`code\`"]
`),
    ).text as string;
    expect(md).toContain("# Ann \\*Star\\* \\<b\\>\n");
    expect(md).toContain("1\\. Built \\[things\\] with snake\\_case & C#, \\~2 years\n");
    expect(md).toContain("## # Notes\n");
    expect(md).toContain("### [- not a list](<https://example.com/a_(b)>)\n");
    expect(md).toContain("- \\+ plus\n- \\> quote\n- \\`code\\`\n");
    expect(unMarkdown(md)).toContain("1. Built [things] with snake_case & C#, ~2 years");
  });

  it("puts emphasis inside the spaces around a run", () => {
    const md = buildMarkdown(
      cv(`basics: { name: A, email: a@example.com }
sections:
  - type: skills
    items: [{ name: Data, keywords: [SQL] }]
  - type: languages
    items: [{ language: Italian, fluency: C2 }, { language: English }]
`),
    ).text as string;
    expect(md).toContain("**Data**: SQL\n");
    expect(md).toContain("**Italian** (C2) · **English**\n");
  });

  it("leaves out the photo", () => {
    const f = loadFixture("sidebar");
    const md = buildMarkdown(f.content, { locale: "en", ...fixtureOptions(f) }).text as string;
    expect(md).not.toMatch(/!\[/);
  });
});

describe("plain text", () => {
  it("shows a link's address only when the text does not", () => {
    const txt = buildText(
      cv(`basics:
  name: A
  email: a@example.com
  url: https://a.example.com/
sections:
  - type: projects
    items: [{ name: Tool, url: "https://github.com/a/tool" }]
`),
    ).text as string;
    expect(txt).toContain("a@example.com · a.example.com\n");
    expect(txt).toContain("Tool (https://github.com/a/tool)\n");
  });

  it("underlines headings and ends with one newline", () => {
    const txt = buildText(
      cv(`basics: { name: A, email: a@example.com, summary: Hi }
`),
    ).text as string;
    expect(txt).toBe("A\na@example.com\n\nSummary\n-------\n\nHi\n");
  });
});
