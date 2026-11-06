import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { create as openFont } from "fontkit";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import { buildHtml, layout, parseContent, selectFace } from "../src/index.ts";
import { subsetFont } from "../src/render/html/subset.ts";
import { FIXTURES, fixtureOptions, loadFixture } from "./fixtures.ts";

/**
 * HTML pages. Goldens live in fixtures/golden-text/ as readable files, with
 * each embedded font and photo replaced by its SHA-256 (the bytes are still
 * compared exactly). UPDATE_GOLDEN=1 rewrites them.
 */

const GOLDEN_DIR = join(FIXTURES, "golden-text");
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const fonts = loadBundledFonts();
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** [fixture[:variant][+theme], locale] */
const CASES: [string, string][] = [
  ["basic", "en"],
  ["basic+classic", "it"],
  ["sidebar", "en"],
  ["sidebar+sidebar-right", "en"],
  ["sidebar+creative", "en"],
  ["long+modern", "en"],
  ["multilingual", "de"],
];

function build(name: string, locale: string): string {
  const f = loadFixture(name);
  const r = buildHtml(f.content, { fonts, locale, ...fixtureOptions(f) });
  if (r.text === undefined) throw new Error(JSON.stringify(r.diagnostics));
  return r.text;
}

/** Embedded files (`data:` URIs) of a page, decoded. */
function embedded(html: string): { mime: string; data: Uint8Array }[] {
  return [...html.matchAll(/data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)/g)].map((m) => ({
    mime: m[1] as string,
    data: new Uint8Array(Buffer.from(m[2] as string, "base64")),
  }));
}

const readable = (html: string) =>
  html.replace(
    /data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)/g,
    (_, mime: string, b64: string) => `data:${mime};sha256=${sha256(Buffer.from(b64, "base64"))}`,
  );

describe("golden HTML", () => {
  for (const [name, locale] of CASES) {
    it(`${name}.${locale}`, () => {
      const file = `${name.replace(":", "@").replace("+", "~")}.${locale}.html`;
      const path = join(GOLDEN_DIR, file);
      const actual = readable(build(name, locale));
      if (UPDATE || !existsSync(path)) {
        if (!UPDATE) throw new Error(`No golden file ${file}; run UPDATE_GOLDEN=1 npm test`);
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(path, actual);
        return;
      }
      expect(actual, `${file} changed; if intended, run UPDATE_GOLDEN=1 npm test`).toBe(
        readFileSync(path, "utf8"),
      );
    });
  }

  it("is deterministic", () => {
    expect(build("sidebar+creative", "en")).toBe(build("sidebar+creative", "en"));
  });
});

/** Visible text of a page: tags dropped, entities decoded, head left out. */
function pageText(html: string): string {
  return (html.split("<body>")[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("HTML text", () => {
  for (const [name, locale] of CASES) {
    it(`${name}.${locale}: every run is in the page, in the PDF's reading order`, () => {
      const f = loadFixture(name);
      const l = layout(f.content, { locale, ...fixtureOptions(f) }).layout;
      if (!l) throw new Error("layout failed");
      const runs = l.blocks
        .flatMap((b) => (b.kind === "group" ? b.blocks : [b]))
        .flatMap((p) => [...p.runs, ...(p.aside ?? [])])
        .map((r) => norm(r.text))
        .filter(Boolean);
      const text = norm(pageText(build(name, locale)));
      let pos = 0;
      for (const run of runs) {
        const at = text.indexOf(run, pos);
        expect(at, `"${run}" missing or out of order`).toBeGreaterThanOrEqual(0);
        pos = at + run.length;
      }
    });
  }

  it("is self-contained: no scripts and nothing fetched", () => {
    for (const [name, locale] of CASES) {
      const html = build(name, locale);
      expect(html).not.toMatch(/<script|<link|<iframe|@import/i);
      expect(html).not.toMatch(/(?:src="|url\()(?!data:)/);
    }
  });

  it("embeds the photo's original bytes", () => {
    const f = loadFixture("sidebar");
    const photo = Object.values(f.assets)[0] as Uint8Array;
    const images = embedded(build("sidebar", "en")).filter((e) => e.mime.startsWith("image/"));
    expect(images.map((i) => sha256(i.data))).toEqual([sha256(photo)]);
  });

  it("escapes text and links only web, mail and phone addresses", () => {
    const parsed = parseContent(`version: 1
basics:
  name: "A <b>&</b> \\"B\\""
  email: a@example.com
sections:
  - type: projects
    items:
      - { name: Bad, url: "javascript:alert(1)" }
      - { name: Good, url: "https://example.com/?a=1&b=2" }
`);
    if (!parsed.value) throw new Error(JSON.stringify(parsed.diagnostics));
    const html = buildHtml(parsed.value, { fonts }).text as string;
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; "B"</span></h1>');
    expect(html).toContain(
      '<meta name="author" content="A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;">',
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">');
  });
});

interface FontkitFont {
  familyName: string;
  copyright: string;
  characterSet: number[];
  glyphForCodePoint(cp: number): { id: number; advanceWidth: number };
  name: { records: { license?: { en?: string } } };
}

describe("embedded fonts", () => {
  it("are subsets with every character used, at the original widths", () => {
    const html = build("multilingual", "de");
    const faces = [
      ...html.matchAll(
        /font-weight:(\d+);font-style:(\w+);src:url\(data:font\/ttf;base64,([^)]+)\)/g,
      ),
    ];
    expect(faces.length).toBeGreaterThanOrEqual(2);
    const text = pageText(html).replace(/\s+/g, "");
    const covered = new Set<number>();
    for (const [, weight, style, b64] of faces) {
      const data = new Uint8Array(Buffer.from(b64 as string, "base64"));
      expect(data.length).toBeLessThan(40_000);
      const sub = openFont(data as never) as FontkitFont;
      const face = selectFace(fonts, {
        family: "Source Sans 3",
        weight: Number(weight),
        italic: style === "italic",
      });
      const orig = openFont(face?.data as never) as FontkitFont;
      // The OFL's Reserved Font Name: a subset carries another family name.
      expect(sub.familyName).not.toMatch(/Source/);
      expect(sub.copyright).toBe(orig.copyright);
      // (0xFFFF ends the cmap, by the format's convention.)
      for (const cp of sub.characterSet.filter((c) => c !== 0xffff)) {
        covered.add(cp);
        expect(sub.glyphForCodePoint(cp).id).toBeGreaterThan(0);
        expect(sub.glyphForCodePoint(cp).advanceWidth).toBe(
          orig.glyphForCodePoint(cp).advanceWidth,
        );
      }
    }
    // Every visible character is in some embedded face.
    for (const ch of text) expect(covered.has(ch.codePointAt(0) as number), ch).toBe(true);
    expect(text).toContain("Lissabon");
  });

  it("are valid sfnt files with correct checksums", () => {
    const face = fonts[0] as (typeof fonts)[number];
    const { data, missing } = subsetFont(
      face.data,
      [..."Ärger · Café 😀"].map((c) => c.codePointAt(0) as number),
      "cvac Test",
    );
    expect(missing).toEqual([0x1f600]);
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
    const f = openFont(data as never) as FontkitFont;
    for (const ch of "Ärger · Café") {
      expect(f.glyphForCodePoint(ch.codePointAt(0) as number).id, ch).toBeGreaterThan(0);
    }
    expect(subsetFont(face.data, [65, 66], "x").data).toEqual(
      subsetFont(face.data, [66, 65, 65], "x").data,
    );
  });
});
