import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BUNDLED_FACES, loadBundledFonts } from "../../fonts/src/index.ts";
import { buildDocx, parseContent } from "../src/index.ts";
import { obfuscate } from "../src/render/docx/fonts.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");
const GOLDEN_FILE = join(FIXTURES, "golden-docx.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const fonts = loadBundledFonts();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function build(name: string, opts: { locale?: string; embed?: boolean; date?: Date } = {}) {
  const parsed = parseContent(readFileSync(join(FIXTURES, name, "cv.yaml"), "utf8"));
  if (!parsed.value) throw new Error(JSON.stringify(parsed.diagnostics));
  const r = await buildDocx(parsed.value, {
    fonts,
    locale: opts.locale ?? "en",
    ...(opts.embed !== undefined ? { embedFonts: opts.embed } : {}),
    ...(opts.date ? { date: opts.date } : {}),
  });
  if (!r.docx) throw new Error(JSON.stringify(r.diagnostics));
  return r.docx;
}

function parts(docx: Uint8Array) {
  const files = unzipSync(docx);
  const xml = (name: string) => strFromU8(files[name] as Uint8Array);
  return { files, xml };
}

/** Paragraphs of document.xml as [style, text] with tabs as "\t". */
function paragraphs(documentXml: string): [string, string][] {
  return [...documentXml.matchAll(/<w:p>([\s\S]*?)<\/w:p>|<w:p [\s\S]*?<\/w:p>/g)].map((m) => {
    const p = m[0];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? "Normal";
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
      .map((t) => (t[0] === "<w:tab/>" ? "\t" : decode(t[1] ?? "")))
      .join("");
    return [style, text];
  });
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("DOCX determinism (golden hashes)", () => {
  const golden: Record<string, string> = UPDATE
    ? {}
    : JSON.parse(readFileSync(GOLDEN_FILE, "utf8"));
  const cases: [string, string, Parameters<typeof build>[1]][] = [
    ["basic.en.docx", "basic", { locale: "en" }],
    ["basic.it.docx", "basic", { locale: "it" }],
    ["long.en.docx", "long", { locale: "en" }],
    ["basic.en.no-embed.docx", "basic", { locale: "en", embed: false }],
  ];

  for (const [key, fixture, opts] of cases) {
    it(`${key} is byte-identical across builds and matches the golden hash`, async () => {
      const a = await build(fixture, opts);
      const b = await build(fixture, opts);
      expect(sha256(a)).toBe(sha256(b));
      if (UPDATE) {
        golden[key] = sha256(a);
        writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, Object.keys(golden).sort(), 2)}\n`);
      } else {
        expect(
          sha256(a),
          `golden mismatch for ${key}; run UPDATE_GOLDEN=1 npm test if intended`,
        ).toBe(golden[key]);
      }
    });
  }

  it("pins package timestamps and replaces random relationship ids", async () => {
    const { files, xml } = parts(await build("basic"));
    expect(xml("docProps/core.xml")).toContain(">2000-01-01T00:00:00Z</dcterms:created>");
    expect(xml("docProps/core.xml")).toContain(">2000-01-01T00:00:00Z</dcterms:modified>");
    for (const name of Object.keys(files).filter((n) => n.endsWith(".rels"))) {
      for (const m of xml(name).matchAll(/\bId="([^"]+)"/g)) {
        expect(m[1]).toMatch(/^rId(Cvac|Font)?\d+$/);
      }
    }
  });

  it("uses the configured document date", async () => {
    const { xml } = parts(await build("basic", { date: new Date(Date.UTC(2024, 5, 1, 12, 30)) }));
    expect(xml("docProps/core.xml")).toContain(">2024-06-01T12:30:00Z</dcterms:created>");
  });
});

describe("DOCX structure (ATS readability)", () => {
  it("emits native heading styles, right-tabbed dates and real lists in reading order", async () => {
    const { xml } = parts(await build("basic"));
    const doc = xml("word/document.xml");
    const ps = paragraphs(doc);
    expect(ps.slice(0, 6)).toEqual([
      ["Title", "Jane Doe"],
      ["Normal", "Senior Software Engineer"],
      ["Normal", "jane.doe@example.com · +39 333 000 0000 · Milano, Italy · github.com/janedoe"],
      ["Heading1", "Summary"],
      ["Normal", "Backend engineer with 10 years of experience building distributed systems."],
      ["Heading1", "Experience"],
    ]);
    expect(ps).toContainEqual(["Heading2", "Senior Developer\tMar 2021 – Present"]);
    expect(ps.filter(([s]) => s === "Heading1").map(([, t]) => t)).toEqual([
      "Summary",
      "Experience",
      "Education",
      "Skills",
      "Languages",
      "Volunteering",
    ]);
    // Bullets are Word list items, not "•" characters in the text.
    expect(doc.match(/<w:numPr>/g)).toHaveLength(3);
    expect(ps.some(([, t]) => t.includes("•"))).toBe(false);
    expect(xml("word/numbering.xml")).toContain('w:lvlText w:val="•"');
    // Right tab stop at the content width: (595.28pt - 2 x 18mm) x 20 = 9865 twips.
    expect(doc).toContain('<w:tab w:val="right" w:pos="9865"/>');
  });

  it("keeps everything in the body: no text boxes, tables, headers or footers", async () => {
    const { files, xml } = parts(await build("basic"));
    expect(Object.keys(files).filter((n) => /header|footer/.test(n))).toEqual([]);
    expect(xml("word/document.xml")).not.toMatch(/<w:tbl>|<w:txbxContent>|<v:textbox|<wps:txbx/);
  });

  it("links contact details as external hyperlinks", async () => {
    const { xml } = parts(await build("basic"));
    const rels = xml("word/_rels/document.xml.rels");
    expect(rels).toContain('Target="mailto:jane.doe@example.com" TargetMode="External"');
    expect(rels).toContain('Target="https://github.com/janedoe" TargetMode="External"');
  });

  it("writes metadata and the document language", async () => {
    const { xml } = parts(await build("basic", { locale: "it" }));
    expect(xml("docProps/core.xml")).toMatch(
      /<dc:title>Jane Doe – Ingegnere del Software Senior<\/dc:title>/,
    );
    expect(xml("docProps/core.xml")).toContain("<dc:creator>Jane Doe</dc:creator>");
    expect(xml("word/styles.xml")).toContain('<w:lang w:val="it"/>');
  });

  it("keeps entries together like the PDF (keep-next chains, keep-lines)", async () => {
    const doc = parts(await build("basic")).xml("word/document.xml");
    const entryTitle =
      doc.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*?Senior Developer[\s\S]*?<\/w:p>/)?.[0] ?? "";
    expect(entryTitle).toContain("<w:keepNext/>");
    expect(entryTitle).toContain("<w:keepLines/>");
  });
});

describe("DOCX fonts", () => {
  it("describes the font so Word substitutes a sans-serif when it is not installed", async () => {
    const table = parts(await build("basic", { embed: false })).xml("word/fontTable.xml");
    expect(table).toContain('<w:font w:name="Source Sans 3">');
    expect(table).toContain('<w:family w:val="swiss"/>');
    expect(table).toMatch(/<w:panose1 w:val="020B[0-9A-F]{16}"\/>/);
    expect(table).not.toContain("w:embedRegular");
  });

  it("embeds all faces by default, obfuscated with deterministic keys", async () => {
    const { files, xml } = parts(await build("basic"));
    const table = xml("word/fontTable.xml");
    // The substitution hints stay, for apps that ignore embedded fonts.
    expect(table).toContain('<w:family w:val="swiss"/>');
    const embeds = [
      ...table.matchAll(/<w:(embed\w+) r:id="(\w+)" w:fontKey="\{([0-9A-F-]+)\}"\/>/g),
    ];
    expect(embeds.map((e) => e[1])).toEqual([
      "embedRegular",
      "embedBold",
      "embedItalic",
      "embedBoldItalic",
    ]);
    expect(xml("word/settings.xml")).toContain("<w:embedTrueTypeFonts/>");

    const rels = xml("word/_rels/fontTable.xml.rels");
    const original = new Set(fonts.map((f) => sha256(f.data)));
    for (const [, , id, key] of embeds) {
      const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
      const odttf = files[`word/${target}`] as Uint8Array;
      // De-obfuscating (XOR is its own inverse) must give back a bundled face byte-for-byte.
      expect(original.has(sha256(obfuscate(odttf, key as string)))).toBe(true);
    }
    expect(embeds).toHaveLength(BUNDLED_FACES.length);
  });

  it("warns when embedding is requested without font files", async () => {
    const parsed = parseContent("basics: { name: J, email: j@example.com }\n");
    const r = await buildDocx(parsed.value!, { embedFonts: true });
    expect(r.docx).toBeDefined();
    expect(r.diagnostics).toMatchObject([{ code: "embed-without-fonts", severity: "warning" }]);
  });
});
