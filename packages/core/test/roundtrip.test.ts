import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../fonts/src/index.ts";
import { buildDocx, buildPdf, layout } from "../src/index.ts";
import { fixtureOptions, loadFixture } from "./fixtures.ts";

/**
 * ATS guarantee: every piece of text in the layout is recoverable from the
 * generated files, in semantic reading order. This is what a parser sees.
 */

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");
/** [fixture[:variant][+theme], locale] */
const CASES: [string, string][] = [
  ["basic", "en"],
  ["basic", "it"],
  ["long", "en"],
  ["variants:backend", "en"],
  ["variants:lead", "it"],
  ["sidebar", "en"],
  ["long+compact", "en"],
  ["basic+classic", "it"],
  ["sidebar+classic", "en"],
  ["long+modern", "en"],
  ["sidebar+sidebar-right", "en"],
];
const fonts = loadBundledFonts();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Text runs in reading order (runs, then the right-aligned aside). The PDF
 * reads header, main, sidebar; the DOCX is linear, in CV order.
 */
function expectedRuns(name: string, locale: string, linear = false): string[] {
  const f = loadFixture(name);
  const l = layout(f.content, {
    locale,
    ...fixtureOptions(f),
    ...(linear ? { linear } : {}),
  }).layout;
  if (!l) throw new Error("layout failed");
  return l.blocks
    .flatMap((b) => (b.kind === "group" ? b.blocks : [b]))
    .flatMap((p) => [...p.runs, ...(p.aside ?? [])].map((r) => norm(r.text)))
    .filter(Boolean);
}

async function pdfText(pdf: Uint8Array): Promise<string> {
  const task = getDocument({ data: pdf.slice(), useSystemFonts: false });
  const doc = await task.promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += `${c.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("")}\n`;
  }
  await task.destroy();
  return norm(text);
}

function docxText(docx: Uint8Array): string {
  const xml = strFromU8(unzipSync(docx)["word/document.xml"] as Uint8Array);
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)]
      .map((t) => (t[0] === "<w:tab/>" ? " " : (t[1] ?? "")))
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
  return norm(paras.join("\n"));
}

/** Each expected run must appear, in order, without being split or merged. */
function expectInOrder(text: string, runs: string[], label: string) {
  let pos = 0;
  for (const run of runs) {
    const at = text.indexOf(run, pos);
    expect(
      at,
      `${label}: "${run}" missing or out of order (searching from ${pos})`,
    ).toBeGreaterThanOrEqual(0);
    pos = at + run.length;
  }
}

describe("text round-trip", () => {
  for (const [name, locale] of CASES) {
    it(`${name}.${locale}: all text survives in the PDF and the DOCX`, async () => {
      const runs = expectedRuns(name, locale);
      expect(runs.length).toBeGreaterThan(10);
      const f = loadFixture(name);
      const opts = { fonts, locale, ...fixtureOptions(f) };

      const pdf = await buildPdf(f.content, opts);
      expectInOrder(await pdfText(pdf.pdf as Uint8Array), runs, `${name}.${locale}.pdf`);

      const docx = await buildDocx(f.content, opts);
      const linearRuns = expectedRuns(name, locale, true);
      expectInOrder(docxText(docx.docx as Uint8Array), linearRuns, `${name}.${locale}.docx`);
    });
  }
});
