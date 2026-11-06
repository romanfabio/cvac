import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import {
  type Block,
  BUILTIN_THEMES,
  buildDocx,
  buildPdf,
  type Content,
  contrast,
  flattenTheme,
  type LayoutDocument,
  layout,
  lint,
  type Measurer,
  mergeThemes,
  type Paragraph,
  parseContent,
  probeImage,
  resolveTheme,
  type TextStyle,
  type Theme,
  typeset,
} from "../src/index.ts";
import { FIXTURES, fixtureOptions, loadFixture } from "./fixtures.ts";

const fonts = loadBundledFonts();
const photoJpg = new Uint8Array(readFileSync(join(FIXTURES, "sidebar", "photo.jpg")));
const photoPng = new Uint8Array(readFileSync(join(FIXTURES, "sidebar", "photo.png")));

function cv(yaml: string): Content {
  const r = parseContent(yaml);
  if (!r.value) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}

const CV = cv(`
basics: { name: Jane, title: Dev, email: j@example.com, phone: "1", summary: Hello there. }
sections:
  - type: experience
    items: [{ company: Acme, role: Dev, start: 2020, end: present, highlights: [Did things] }]
  - type: skills
    items: [{ name: Cloud, keywords: [Azure] }]
  - type: languages
    items: [{ language: Italian, fluency: Native }]
`);

const text = (blocks: Block[]) =>
  blocks
    .flatMap((b) => (b.kind === "group" ? b.blocks : [b]))
    .map((p) => p.runs.map((r) => r.text).join(""));

describe("theme inheritance", () => {
  it("layers objects key by key and replaces arrays and scalars", () => {
    expect(
      mergeThemes(
        {
          layout: { type: "sidebar", sidebar: ["a", "b"], width: "30%" },
          tokens: { colors: { accent: "#111111" } },
        },
        { layout: { sidebar: ["c"] }, tokens: { colors: { text: "#222222" } } },
      ),
    ).toEqual({
      layout: { type: "sidebar", sidebar: ["c"], width: "30%" },
      tokens: { colors: { accent: "#111111", text: "#222222" } },
    });
  });

  it("resolves built-in bases, with the default theme at the bottom", () => {
    const { theme } = resolveTheme({
      extends: "sidebar",
      tokens: { colors: { accent: "#7a1f3d" } },
    });
    expect(theme.layout).toMatchObject({ type: "sidebar", side: "left", header: "main" });
    expect(theme.colors).toMatchObject({
      accent: "#7a1f3d",
      text: "#1a1a1a",
      sidebarBackground: "#eef2f7",
    });
    expect(theme.fonts.body.family).toBe("Source Sans 3");
    expect(resolveTheme().theme.layout).toEqual({ type: "single" });
  });

  it("does not let schema defaults override a base theme", () => {
    // The sidebar theme sets margins; a child that only sets the page size keeps them.
    const { theme } = resolveTheme({ extends: "sidebar", page: { size: "Letter" } });
    expect(theme.page).toMatchObject({ width: 612, margins: { left: 39.69, top: 45.35 } });
  });

  it("reports unknown bases", () => {
    expect(flattenTheme({ extends: "fancy" }).diagnostics).toMatchObject([
      {
        code: "unknown-theme",
        message: expect.stringContaining(
          "Available: default, compact, minimal, classic, academic, executive, modern, sidebar, sidebar-right, creative,",
        ),
      },
    ]);
  });

  it("computes the sidebar width from a percentage of the content width", () => {
    const { theme } = resolveTheme({
      layout: { type: "sidebar", width: "50%" },
      page: { margins: "20mm" },
    });
    const content = 595.28 - 2 * 56.69;
    expect(theme.layout.type === "sidebar" && theme.layout.width).toBeCloseTo(content / 2, 1);
  });

  it("puts the photo in the sidebar only when there is one", () => {
    expect(resolveTheme({ extends: "sidebar" }).theme.photo.position).toBe("sidebar");
    expect(resolveTheme({ photo: { position: "sidebar" } }).theme.photo.position).toBe(
      "header-right",
    );
  });
});

describe("regions", () => {
  const theme = {
    layout: { type: "sidebar" as const, sidebar: ["summary", "skills", "languages"] },
  };

  it("places sections by id and keeps CV order within each region", () => {
    const l = layout(CV, { theme }).layout as LayoutDocument;
    expect(text(l.regions?.header ?? [])).toEqual(["Jane", "Dev", "j@example.com · 1"]);
    expect(text(l.regions?.main ?? [])).toEqual(["Experience", "Dev", "Acme", "Did things"]);
    expect(text(l.regions?.sidebar ?? [])).toEqual([
      "Summary",
      "Hello there.",
      "Skills",
      "Cloud: Azure",
      "Languages",
      "Italian (Native)",
    ]);
    // Reading order: header, main, sidebar.
    expect(text(l.blocks)).toEqual([
      ...text(l.regions?.header ?? []),
      ...text(l.regions?.main ?? []),
      ...text(l.regions?.sidebar ?? []),
    ]);
  });

  it("linear layouts ignore the columns (DOCX)", () => {
    const l = layout(CV, { theme, linear: true }).layout as LayoutDocument;
    expect(l.regions?.columns).toBeUndefined();
    expect(text(l.blocks).slice(3, 6)).toEqual(["Summary", "Hello there.", "Experience"]);
  });

  it("gives sidebar entries their dates on a separate line", () => {
    const c = cv(`
basics: { name: J, email: j@example.com }
sections:
  - type: certifications
    items: [{ name: CKA, issuer: CNCF, date: 2022-03 }]
`);
    const side = layout(c, {
      theme: { layout: { type: "sidebar", sidebar: ["certifications"] } },
    }).layout;
    const entry = side?.regions?.sidebar[1];
    expect(entry?.kind === "group" && entry.blocks.map((p) => [p.runs[0]?.text, p.aside])).toEqual([
      ["CKA", undefined],
      ["Mar 2022", undefined],
      ["CNCF", undefined],
    ]);
  });
});

describe("multi-frame typesetting", () => {
  const mono: Measurer = {
    width: (t, s) => [...t].length * s.size * 0.5,
    ascent: (s) => s.size * 0.8,
    descent: (s) => s.size * 0.2,
  };
  const style: TextStyle = { family: "X", weight: 400, italic: false, size: 10, color: "#000000" };
  const p = (t: string): Paragraph => ({
    kind: "paragraph",
    role: "body",
    runs: [{ text: t, style }],
    indent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: 1,
  });
  const doc = (over: Partial<LayoutDocument>): LayoutDocument => ({
    meta: { title: "t", author: "a", lang: "en" },
    page: { width: 220, height: 120, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
    blocks: [],
    ...over,
  });

  it("flows main and sidebar independently, sidebar background on every page", () => {
    const pages = typeset(
      doc({
        regions: {
          header: [p("Name")],
          main: Array.from({ length: 14 }, (_, i) => p(`m${i}`)),
          sidebar: [p("s0"), p("s1")],
          columns: {
            side: "left",
            sidebarWidth: 50,
            gap: 10,
            headerSpan: "full",
            sidebarBackground: "#eeeeee",
          },
        },
      }),
      mono,
    );
    expect(pages).toHaveLength(2);
    const texts = pages.map((pg) =>
      pg.items.flatMap((i) => (i.type === "text" ? [[i.text, i.x]] : [])),
    );
    // Page 1: header across, then main (x = 10 + 50 + 10), then sidebar (x = 10).
    expect(texts[0]?.slice(0, 2)).toEqual([
      ["Name", 10],
      ["m0", 70],
    ]);
    expect(texts[0]?.slice(-2)).toEqual([
      ["s0", 10],
      ["s1", 10],
    ]);
    // The main column continues at the top of page 2.
    expect(texts[1]?.[0]).toEqual(["m9", 70]);
    // Backgrounds come first (painted behind), below the header on page 1.
    expect(pages.map((pg) => pg.items[0])).toMatchObject([
      { type: "rect", x: 0, y: 20, width: 65, color: "#eeeeee" },
      { type: "rect", x: 0, y: 0, width: 65 },
    ]);
  });

  it("narrows the header beside a photo and keeps the body below it", () => {
    const photo = {
      data: photoPng,
      format: "png" as const,
      pixelWidth: 300,
      pixelHeight: 360,
      size: 40,
      shape: "circle" as const,
      position: "header-right" as const,
      alt: "J",
    };
    const pages = typeset(
      doc({ regions: { header: [p("Name")], main: [p("body")], sidebar: [] }, photo }),
      mono,
    );
    const items = pages[0]?.items ?? [];
    expect(items.find((i) => i.type === "image")).toMatchObject({ x: 210 - 40, y: 10 });
    const body = items.find((i) => i.type === "text" && i.text === "body");
    expect(body && body.type === "text" && body.y).toBeGreaterThan(10 + 40);
  });
});

describe("photos", () => {
  it("probes PNG and JPEG headers", () => {
    expect(probeImage(photoPng)).toEqual({ format: "png", width: 300, height: 360 });
    expect(probeImage(photoJpg)).toEqual({ format: "jpeg", width: 300, height: 360 });
    expect(probeImage(new TextEncoder().encode("GIF89a........"))).toBeUndefined();
  });

  const withPhoto = cv("basics: { name: J, email: j@example.com, photo: me.jpg }\n");

  it("reports a missing or unsupported photo at basics.photo", () => {
    expect(layout(withPhoto).diagnostics).toMatchObject([
      { code: "photo-not-found", path: ["basics", "photo"], origin: "content" },
    ]);
    expect(
      layout(withPhoto, { assets: { "me.jpg": new TextEncoder().encode("nope") } }).diagnostics,
    ).toMatchObject([{ code: "photo-format" }]);
  });

  it("can be hidden by the theme without needing the file", () => {
    const l = layout(withPhoto, { theme: { photo: { show: false } } });
    expect(l.diagnostics).toEqual([]);
    expect(l.layout?.photo).toBeUndefined();
  });

  it("is embedded in the PDF", async () => {
    const r = await buildPdf(withPhoto, { fonts, assets: { "me.jpg": photoJpg } });
    expect(Buffer.from(r.pdf as Uint8Array).toString("latin1")).toMatch(/\/Subtype \/Image/);
  });

  it("floats in the DOCX, cover-cropped and masked, with a fixed drawing id", async () => {
    const r = await buildDocx(withPhoto, {
      fonts,
      assets: { "me.jpg": photoJpg },
      embedFonts: false,
    });
    const files = unzipSync(r.docx as Uint8Array);
    const doc = strFromU8(files["word/document.xml"] as Uint8Array);
    expect(doc).toContain('<wp:docPr id="1" name="Photo" descr="J" title="J"/>');
    // 300x360: one sixth of the extra height trimmed top and bottom.
    expect(doc).toContain('<a:srcRect l="0" t="8333" r="0" b="8333"/>');
    expect(doc).toContain('<a:prstGeom prst="ellipse">');
    expect(Object.keys(files)).toContain("word/media/image1.jpg");
  });
});

describe("layout lint", () => {
  it("multi-column: warns for sidebar layouts, pointing at what enabled it", () => {
    expect(lint(CV, { theme: { extends: "sidebar" } })).toMatchObject([
      { code: "lint/multi-column", path: ["extends"], origin: "theme" },
    ]);
    expect(lint(CV, { theme: { layout: { type: "sidebar" } } })).toMatchObject([
      { code: "lint/multi-column", path: ["layout"] },
    ]);
    expect(lint(CV).map((d) => d.code)).toEqual([]);
  });

  it("low-contrast: checks text against the sidebar background", () => {
    const ds = lint(CV, {
      theme: { extends: "sidebar", tokens: { colors: { sidebarBackground: "#555555" } } },
    }).filter((d) => d.code === "lint/low-contrast");
    expect(ds.length).toBeGreaterThan(0);
    expect(ds[0]).toMatchObject({ path: ["tokens", "colors", "sidebarBackground"] });
  });

  it("the built-in sidebar theme meets the contrast ratios it enforces", () => {
    // The rule only flags user-set colors, so check our own design directly.
    const { colors } = resolveTheme({ extends: "sidebar" }).theme;
    const bg = colors.sidebarBackground as string;
    expect(contrast(colors.text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accent, bg)).toBeGreaterThanOrEqual(3);
    const f = loadFixture("sidebar");
    expect(lint(f.content, { ...fixtureOptions(f), fonts }).map((d) => d.code)).toEqual([
      "lint/multi-column",
    ]);
  });
});

describe("built-in themes", () => {
  const paragraphsOf = (blocks: Block[]) =>
    blocks.flatMap((b) => (b.kind === "group" ? b.blocks : [b]));
  const build = (theme?: Theme) => {
    const r = layout(CV, { ...(theme ? { theme } : {}), locale: "en" });
    if (!r.layout) throw new Error(JSON.stringify(r.diagnostics));
    return paragraphsOf(r.layout.blocks);
  };

  for (const name of Object.keys(BUILTIN_THEMES)) {
    it(`${name} passes the theme lint rules even when every value counts as user-set`, () => {
      // Flattened and without `extends`, every value looks hand-written, so
      // rules that only check user-set values (contrast, font size,
      // margins) check the built-in design itself.
      const { extends: _, ...flat } = flattenTheme({ extends: name }).theme;
      const codes = lint(CV, { theme: flat, fonts }).map((d) => d.code);
      const sidebar = resolveTheme({ extends: name }).theme.layout.type === "sidebar";
      expect(codes).toEqual(sidebar ? ["lint/multi-column"] : []);
    });
  }

  it("each theme uses the fonts it should, and the DOCX embeds only the serif for classic", async () => {
    const families = (name: string) =>
      new Set(Object.values(resolveTheme({ extends: name }).theme.fonts).map((f) => f.family));
    for (const name of ["classic", "academic"]) {
      expect(families(name)).toEqual(new Set(["Source Serif 4"]));
    }
    expect(families("executive")).toEqual(new Set(["Source Sans 3", "Source Serif 4"]));
    for (const name of [
      "default",
      "compact",
      "minimal",
      "modern",
      "sidebar",
      "sidebar-right",
      "creative",
    ]) {
      expect(families(name)).toEqual(new Set(["Source Sans 3"]));
    }
    const r = await buildDocx(CV, { fonts, theme: { extends: "classic" } });
    if (!r.docx) throw new Error(JSON.stringify(r.diagnostics));
    const table = strFromU8(unzipSync(r.docx)["word/fontTable.xml"] as Uint8Array);
    expect(table).toContain('w:name="Source Serif 4"');
    expect(table).not.toContain("Source Sans 3");
    expect(table).toContain('<w:family w:val="roman"/>');
  });

  it("header.align centers the name, headline and contact line", () => {
    const ps = build({ header: { align: "center" } });
    for (const role of ["name", "headline", "contact"]) {
      expect(ps.find((p) => p.role === role)?.align).toBe("center");
    }
    expect(ps.find((p) => p.role === "heading")?.align).toBeUndefined();
  });

  it("header.nameColor: accent colors the name", () => {
    const accent = "#7a1f3d";
    const name = (nameColor?: "text" | "accent") =>
      build({
        ...(nameColor ? { header: { nameColor } } : {}),
        tokens: { colors: { accent } },
      }).find((p) => p.role === "name")?.runs[0]?.style.color;
    expect(name("accent")).toBe(accent);
    expect(name()).toBe("#1a1a1a");
  });

  it("headings.case: upper capitalizes the heading text itself", () => {
    const heads = (theme?: Parameters<typeof build>[0]) =>
      build(theme)
        .filter((p) => p.role === "heading")
        .map((p) => p.runs[0]?.text);
    expect(heads()).toEqual(["Summary", "Experience", "Skills", "Languages"]);
    expect(heads({ headings: { case: "upper" } })).toEqual([
      "SUMMARY",
      "EXPERIENCE",
      "SKILLS",
      "LANGUAGES",
    ]);
  });

  it("headings.rule picks an underline (default), a bar before the text, or nothing", () => {
    const heading = (rule?: "underline" | "bar" | "none") =>
      build(rule ? { headings: { rule } } : undefined).find((p) => p.role === "heading");
    expect(heading()).toMatchObject({ ruleBelow: { thickness: 0.6 }, indent: 0 });
    expect(heading()?.bar).toBeUndefined();
    const bar = heading("bar");
    expect(bar).toMatchObject({ bar: { width: 3, gap: 6 }, indent: 9 });
    expect(bar?.ruleBelow).toBeUndefined();
    const none = heading("none");
    expect(none?.ruleBelow).toBeUndefined();
    expect(none?.bar).toBeUndefined();
  });

  describe("typesetting", () => {
    const mono: Measurer = {
      width: (t, s) => [...t].length * s.size * 0.5,
      ascent: (s) => s.size * 0.8,
      descent: (s) => s.size * 0.2,
    };
    const style: TextStyle = {
      family: "X",
      weight: 400,
      italic: false,
      size: 10,
      color: "#000000",
    };
    const para = (t: string, over: Partial<Paragraph> = {}): Paragraph => ({
      kind: "paragraph",
      role: "body",
      runs: [{ text: t, style }],
      indent: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      lineHeight: 1.2,
      ...over,
    });
    const page = (blocks: Block[], photo?: LayoutDocument["photo"]) =>
      typeset(
        {
          meta: { title: "t", author: "a", lang: "en" },
          page: { width: 220, height: 300, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
          blocks,
          regions: { header: blocks, main: [], sidebar: [] },
          ...(photo ? { photo } : {}),
        },
        mono,
      )[0]?.items ?? [];

    it("centers each line in the frame", () => {
      const [item] = page([para("abcd", { align: "center" })]);
      // Frame 10..210, text 4 x 5pt = 20pt wide: starts at 10 + (200 - 20) / 2.
      expect(item).toMatchObject({ type: "text", x: 100 });
    });

    it("keeps a centered header centered on the page beside a photo", () => {
      const photo = {
        data: new Uint8Array(),
        format: "png",
        pixelWidth: 1,
        pixelHeight: 1,
        size: 40,
        shape: "circle",
        position: "header-right",
        alt: "a",
      } as const;
      const text = page([para("abcd", { align: "center" })], photo).find((i) => i.type === "text");
      expect(text).toMatchObject({ x: 100 });
      const left = page([para("abcd")], photo).find((i) => i.type === "text");
      expect(left).toMatchObject({ x: 10 });
    });

    it("draws the bar left of the text, as tall as each line", () => {
      const items = page([
        para("abcd", { indent: 9, bar: { color: "#0f6e6e", width: 3, gap: 6 } }),
      ]);
      expect(items[0]).toMatchObject({
        type: "rect",
        x: 10,
        y: 10,
        width: 3,
        height: 12,
        color: "#0f6e6e",
      });
      expect(items[1]).toMatchObject({ type: "text", x: 19 });
    });
  });
});
