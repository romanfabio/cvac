import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import {
  type Content,
  layout,
  lint,
  locateDiagnostics,
  parseContent,
  resolveVariant,
  usedTags,
} from "../src/index.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "variants", "cv.yaml");
const source = readFileSync(FIXTURE, "utf8");
const fonts = loadBundledFonts();

function parse(src: string): Content {
  const r = parseContent(src);
  if (!r.value) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
const cv = parse(source);

/** Companies, bullets and skill names of a variant, for compact assertions. */
function summary(c: Content) {
  const exp = c.sections.find((s) => s.type === "experience");
  const skills = c.sections.find((s) => s.type === "skills");
  return {
    sections: c.sections.map((s) => s.id ?? s.type),
    companies: exp?.type === "experience" ? exp.items.map((i) => i.company) : [],
    bullets:
      exp?.type === "experience"
        ? exp.items.flatMap((i) =>
            (i.highlights ?? []).map((h) =>
              typeof h === "string" ? h : "text" in h ? String(h.text) : JSON.stringify(h),
            ),
          )
        : [],
    skills: skills?.type === "skills" ? skills.items.map((i) => i.name) : [],
  };
}

describe("resolveVariant", () => {
  it("keeps everything without a variant", () => {
    const v = resolveVariant(cv, undefined);
    expect(v.content).toBe(cv);
    expect(summary(v.content).companies).toEqual(["Acme Corp", "Globex", "Initech"]);
  });

  it("keeps untagged elements plus those with the variant's tags", () => {
    const v = resolveVariant(cv, "backend");
    expect(summary(v.content)).toEqual({
      sections: ["experience", "summary-skills", "education"],
      companies: ["Globex", "Initech"],
      bullets: [
        "Designed an event-driven pipeline processing 2M events/day",
        "On-call for the payments platform",
        "Built internal tooling in Python",
      ],
      skills: ["Backend", "Cloud"],
    });
    expect(v.content.basics.title).toEqual({
      $l10n: { en: "Senior Backend Engineer", it: "Ingegnere Backend Senior" },
    });
  });

  it("applies exclude, section selection/order and summary override", () => {
    const v = resolveVariant(cv, "lead");
    expect(summary(v.content)).toEqual({
      sections: ["summary-skills", "experience", "education"],
      companies: ["Acme Corp", "Initech"],
      bullets: ["Grew the platform team from 3 to 9 engineers", "Built internal tooling in Python"],
      skills: ["Leadership", "Cloud"],
    });
    expect(v.content.basics.summary).toBe(
      "Engineering leader who grows teams and ships reliable platforms.",
    );
  });

  it("accepts a bare tag as an ad-hoc variant, filtering items before bullets", () => {
    const v = resolveVariant(cv, "hands-on");
    expect(v.diagnostics).toEqual([]);
    // The hands-on bullet lives in an item tagged 'lead', which this tag does
    // not select, so the whole item (and its bullets) is left out.
    expect(summary(v.content).companies).toEqual(["Initech"]);
  });

  it("rejects unknown names, listing variants and tags", () => {
    const v = resolveVariant(cv, "backnd");
    expect(v.diagnostics).toMatchObject([
      {
        code: "unknown-variant",
        severity: "error",
        help: "Variants: backend, lead. Tags: backend, hands-on, lead.",
      },
    ]);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(cv);
    resolveVariant(cv, "lead");
    expect(JSON.stringify(cv)).toBe(before);
  });

  it("collects tags from sections, items and bullets", () => {
    expect([...usedTags(cv)].sort()).toEqual(["backend", "hands-on", "lead"]);
  });
});

describe("path mapping", () => {
  it("maps filtered indices back to the original document", () => {
    const v = resolveVariant(cv, "lead");
    // Filtered: sections[1] = experience (originally 0), items[1] = Initech (originally 2).
    expect(v.mapPath(["sections", 1, "items", 1, "highlights", 0])).toEqual([
      "sections",
      0,
      "items",
      2,
      "highlights",
      0,
    ]);
    expect(v.mapPath(["sections", 0, "items", 0, "name"])).toEqual([
      "sections",
      1,
      "items",
      1,
      "name",
    ]);
    expect(v.mapPath(["basics", "summary"])).toEqual(["meta", "variants", "lead", "summary"]);
    expect(v.mapPath(["basics", "email"])).toEqual(["basics", "email"]);
  });

  it("lint findings on a variant point at the original YAML line", () => {
    const src = source.replace(
      "company: Initech\n        role: Developer\n        start: 2014\n",
      "company: Initech\n        role: Developer\n",
    );
    const c = parse(src);
    const ds = locateDiagnostics(lint(c, { variant: "lead", fonts }), src, {
      origin: "content",
      file: "cv.yaml",
    });
    const missing = ds.find((d) => d.code === "lint/missing-dates");
    expect(missing?.path).toEqual(["sections", 0, "items", 2]);
    const line = src.split("\n")[(missing?.range?.start.line ?? 0) - 1];
    expect(line).toContain("company: Initech");
  });

  it("missing translations in an override point at the variant", () => {
    const c = parse(
      source.replace(
        "summary: Engineering leader who grows teams and ships reliable platforms.",
        "summary: { en: Engineering leader }",
      ),
    );
    const l = layout(c, { variant: "lead", locale: "it" });
    expect(l.diagnostics).toMatchObject([
      { code: "missing-translation", path: ["meta", "variants", "lead", "summary"] },
    ]);
  });

  it("variant layouts carry their own keywords", () => {
    expect(layout(cv, { variant: "backend" }).layout?.meta.keywords).toEqual([
      "Go",
      "PostgreSQL",
      "Kafka",
      "Azure",
      "Kubernetes",
    ]);
  });
});

describe("variant validation", () => {
  const base = `basics: { name: J, email: j@example.com }
sections:
  - type: experience
    items: [{ company: A, role: B, start: 2020, tags: [x] }]
`;

  it("rejects sections that do not exist", () => {
    const r = parseContent(
      `meta:\n  variants:\n    v: { sections: [experience, projects] }\n${base}`,
    );
    expect(r.value).toBeUndefined();
    expect(r.diagnostics).toMatchObject([
      {
        code: "unknown-section",
        path: ["meta", "variants", "v", "sections", 1],
        range: { start: { line: 3 } },
      },
    ]);
  });

  it("warns about tags nobody uses", () => {
    const r = parseContent(`meta:\n  variants:\n    v: { tags: [x, y], exclude: [z] }\n${base}`);
    expect(r.value).toBeDefined();
    expect(r.diagnostics.map((d) => [d.code, d.path?.at(-2), d.message])).toEqual([
      ["unused-tag", "tags", "Variant 'v' uses tag 'y', but no section, item or bullet has it"],
      ["unused-tag", "exclude", "Variant 'v' uses tag 'z', but no section, item or bullet has it"],
    ]);
  });

  it("requires file-name-safe variant names", () => {
    const r = parseContent(`meta:\n  variants:\n    "Back End": { tags: [x] }\n${base}`);
    expect(r.diagnostics[0]?.message).toContain("Variant names are lowercase");
  });

  it("accepts tagged bullets and reports malformed ones", () => {
    const r = parseContent(
      base.replace(
        "tags: [x] }",
        "tags: [x], highlights: [{ text: T, tags: [x] }, { text: T, tag: [x] }] }",
      ),
    );
    expect(r.value).toBeUndefined();
    expect(r.diagnostics.some((d) => d.path?.join(".").includes("highlights.1"))).toBe(true);
  });
});

describe("locale resolution and variants", () => {
  it("does not warn about translations in variants that are not built", () => {
    const c = parse(
      source.replace(
        "summary: Engineering leader who grows teams and ships reliable platforms.",
        "summary: { en: Engineering leader }",
      ),
    );
    expect(layout(c, { locale: "it" }).diagnostics).toEqual([]);
    expect(layout(c, { locale: "it", variant: "backend" }).diagnostics).toEqual([]);
  });
});
