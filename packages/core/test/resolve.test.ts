import { describe, expect, it } from "vitest";
import {
  formatRange,
  labelsFor,
  layout,
  parseContent,
  parseTheme,
  resolveLocale,
  resolveTheme,
  selectFace,
  toPoints,
} from "../src/index.ts";

const parse = (src: string) => {
  const r = parseContent(src);
  if (!r.value) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
};

const cv = parse(`
meta: { defaultLocale: en }
basics:
  name: Jane
  email: j@example.com
  title: { en: Engineer, it: Ingegnere }
  summary: { it: Solo italiano }
`);

describe("resolveLocale", () => {
  it("picks the requested language", () => {
    expect(resolveLocale(cv, "it").content.basics.title).toBe("Ingegnere");
  });

  it("falls back to the base language", () => {
    expect(resolveLocale(cv, "en-GB").content.basics.title).toBe("Engineer");
  });

  it("falls back and warns when a translation is missing", () => {
    const r = resolveLocale(cv, "en");
    expect(r.content.basics.summary).toBe("Solo italiano");
    expect(r.diagnostics).toMatchObject([
      { code: "missing-translation", severity: "warning", path: ["basics", "summary"] },
    ]);
  });

  it("defaults to meta.defaultLocale", () => {
    expect(resolveLocale(cv).locale).toBe("en");
  });

  it("NFC-normalizes text", () => {
    const r = resolveLocale(parse('basics:\n  name: "Café"\n  email: a@b.co\n'));
    expect(r.content.basics.name).toBe("Café");
  });
});

describe("dates and labels", () => {
  const en = labelsFor("en");
  const it_ = labelsFor("it");

  it("formats ranges", () => {
    expect(formatRange("2021-03", "present", "MMM YYYY", en)).toBe("Mar 2021 – Present");
    expect(formatRange("2016", "2021-02", "MMM YYYY", en)).toBe("2016 – Feb 2021");
    expect(formatRange("2021-03", "present", "MMMM YYYY", it_)).toBe("marzo 2021 – Presente");
    expect(formatRange("2021-03-15", undefined, "MM/YYYY", en)).toBe("03/2021");
    expect(formatRange("2020", "2020", "YYYY", en)).toBe("2020");
  });

  it("falls back to English labels for unknown locales", () => {
    expect(labelsFor("de").sections.experience).toBe("Experience");
    expect(labelsFor("it-CH").sections.experience).toBe("Esperienza");
  });
});

describe("theme", () => {
  it("converts lengths to points", () => {
    expect(toPoints("1in")).toBe(72);
    expect(toPoints("25.4mm")).toBe(72);
    expect(toPoints("2.54cm")).toBe(72);
    expect(toPoints(10)).toBe(10);
  });

  it("layers user tokens over the default theme", () => {
    const t = parseTheme(
      "page: { size: Letter, margins: 1in }\ntokens:\n  colors: { accent: '#aa0000' }\n  fonts:\n    body: { family: Source Sans 3, size: 11pt }\n",
    );
    const { theme } = resolveTheme(t.value);
    expect(theme.page).toMatchObject({ width: 612, height: 792, margins: { top: 72, left: 72 } });
    expect(theme.colors.accent).toBe("#aa0000");
    expect(theme.colors.text).toBe("#1a1a1a");
    expect(theme.fonts.body).toEqual({
      family: "Source Sans 3",
      size: 11,
      weight: 400,
      italic: false,
    });
  });

  it("rejects unknown base themes", () => {
    const { diagnostics } = resolveTheme({ extends: "fancy" });
    expect(diagnostics[0]?.code).toBe("unknown-theme");
  });
});

describe("font selection", () => {
  const face = (weight: number, italic = false) => ({
    family: "F",
    weight,
    italic,
    data: new Uint8Array(),
  });
  const fonts = [face(400), face(600), face(400, true)];

  it("matches family case-insensitively, then italic, then nearest weight", () => {
    expect(selectFace(fonts, { family: "f", weight: 700, italic: false })?.weight).toBe(600);
    expect(selectFace(fonts, { family: "F", weight: 300, italic: false })?.weight).toBe(400);
    expect(selectFace(fonts, { family: "F", weight: 700, italic: true })).toMatchObject({
      italic: true,
    });
    expect(selectFace(fonts, { family: "Nope", weight: 400, italic: false })).toBeUndefined();
  });
});

describe("layout", () => {
  it("emits blocks in semantic reading order with localized headings", () => {
    const c = parse(`
basics: { name: Jane, email: j@example.com }
sections:
  - type: skills
    items: [{ name: Cloud, keywords: [Azure] }]
  - type: experience
    items: [{ company: Acme, role: Dev, start: 2020, end: present }]
`);
    const l = layout(c, { locale: "it" }).layout;
    const flat = l?.blocks.flatMap((b) => (b.kind === "group" ? b.blocks : [b])) ?? [];
    const text = flat.map((b) => [...b.runs, ...(b.aside ?? [])].map((r) => r.text).join(""));
    expect(text).toEqual([
      "Jane",
      "j@example.com",
      "Competenze",
      "Cloud: Azure",
      "Esperienza",
      "Dev2020 – Presente",
      "Acme",
    ]);
    expect(l?.meta).toMatchObject({
      title: "Jane – CV",
      author: "Jane",
      lang: "it",
      keywords: ["Azure"],
    });
  });

  it("skips empty sections", () => {
    const c = parse(
      "basics: { name: J, email: j@example.com }\nsections:\n  - { type: projects, items: [] }\n",
    );
    expect(layout(c).layout?.blocks).toHaveLength(2);
  });
});
