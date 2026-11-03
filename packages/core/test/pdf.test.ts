import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import { buildPdf, parseContent } from "../src/index.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");
const GOLDEN_FILE = join(FIXTURES, "golden-pdf.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** fixture name -> locales to build */
const CASES: Record<string, string[]> = { basic: ["en", "it"], long: ["en"] };

const fonts = loadBundledFonts();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function build(name: string, locale: string, date?: Date) {
  const parsed = parseContent(readFileSync(join(FIXTURES, name, "cv.yaml"), "utf8"));
  if (!parsed.value) throw new Error(JSON.stringify(parsed.diagnostics));
  const r = await buildPdf(parsed.value, { fonts, locale, ...(date ? { date } : {}) });
  if (!r.pdf) throw new Error(JSON.stringify(r.diagnostics));
  return { ...r, pdf: r.pdf };
}

async function extractText(pdf: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: pdf.slice(), useSystemFonts: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(
      content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[ \t]+/g, " "),
    );
  }
  await task.destroy();
  return pages;
}

describe("PDF determinism (golden hashes)", () => {
  const golden: Record<string, string> = UPDATE
    ? {}
    : JSON.parse(readFileSync(GOLDEN_FILE, "utf8"));

  for (const [name, locales] of Object.entries(CASES)) {
    for (const locale of locales) {
      const key = `${name}.${locale}.pdf`;
      it(`${key} is byte-identical across builds and matches the golden hash`, async () => {
        const a = await build(name, locale);
        const b = await build(name, locale);
        expect(sha256(a.pdf)).toBe(sha256(b.pdf));
        if (UPDATE) {
          golden[key] = sha256(a.pdf);
          writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, Object.keys(golden).sort(), 2)}\n`);
        } else {
          expect(
            sha256(a.pdf),
            `golden mismatch for ${key}; run UPDATE_GOLDEN=1 npm test if intended`,
          ).toBe(golden[key]);
        }
      });
    }
  }

  it("the document date is the only date in the file and is configurable", async () => {
    const a = await build("basic", "en");
    const b = await build("basic", "en", new Date(Date.UTC(2024, 5, 1)));
    expect(sha256(a.pdf)).not.toBe(sha256(b.pdf));
    expect(Buffer.from(a.pdf).toString("latin1")).toContain("D:20000101000000Z");
  });
});

describe("PDF content (ATS readability)", () => {
  it("extracts all text in semantic reading order", async () => {
    const { pdf, pages } = await build("basic", "en");
    expect(pages).toBe(1);
    const text = (await extractText(pdf)).join("\n");
    const expected = [
      "Jane Doe",
      "Senior Software Engineer",
      "jane.doe@example.com · +39 333 000 0000 · Milano, Italy · github.com/janedoe",
      "Summary",
      "Experience",
      "Senior Developer",
      "Mar 2021 – Present",
      "Acme Corp",
      "• Designed an event-driven billing platform processing 2M events/day",
      "Education",
      "MSc Computer Engineering",
      "Skills",
      "Languages: TypeScript, C#, Go",
      "Languages",
      "Italian (Native) · English (C1)",
      "Volunteering",
      "CoderDojo Milano",
    ];
    let pos = 0;
    for (const s of expected) {
      const at = text.indexOf(s, pos);
      expect(at, `"${s}" missing or out of order`).toBeGreaterThanOrEqual(0);
      pos = at + s.length;
    }
  });

  it("localizes headings and dates", async () => {
    const text = (await extractText((await build("basic", "it")).pdf)).join("\n");
    for (const s of ["Esperienza", "mar 2021 – Presente", "Sviluppatrice Senior", "Volontariato"]) {
      expect(text).toContain(s);
    }
  });

  it("embeds only the bundled fonts (no base-14 fallbacks)", async () => {
    const raw = Buffer.from((await build("basic", "en")).pdf).toString("latin1");
    expect(raw).not.toMatch(/Helvetica|Times|Courier/);
    expect(raw).toMatch(/\/FontFile2/);
    expect(raw).toMatch(/SourceSans3/);
  });

  it("writes document metadata", async () => {
    const { pdf } = await build("basic", "en");
    const task = getDocument({ data: pdf.slice() });
    const doc = await task.promise;
    const { info } = (await doc.getMetadata()) as { info: Record<string, unknown> };
    expect(info).toMatchObject({
      Title: "Jane Doe – Senior Software Engineer",
      Author: "Jane Doe",
      Producer: "cvac",
      Keywords: "TypeScript, C#, Go, Azure, Kubernetes",
      Language: "en",
    });
    await task.destroy();
  });

  it("paginates long CVs without losing content or corrupting hyphenated words", async () => {
    const { pdf, pages } = await build("long", "en");
    expect(pages).toBe(3);
    const text = (await extractText(pdf)).join("\n");
    expect(text.match(/Delivered initiative/g)).toHaveLength(40);
    expect(text).toContain("it-is-long");
    expect(text).not.toContain("￾");
  });

  it("reports unknown fonts instead of silently substituting", async () => {
    const parsed = parseContent("basics: { name: J, email: j@example.com }\n");
    const r = await buildPdf(parsed.value!, {
      fonts,
      theme: { tokens: { fonts: { body: { family: "Comic Sans" } } } },
    });
    expect(r.pdf).toBeUndefined();
    expect(r.diagnostics).toMatchObject([{ code: "unknown-font" }]);
  });
});
