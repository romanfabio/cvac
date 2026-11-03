import PDFDocument from "pdfkit";
import type { Diagnostic } from "../../diagnostics.ts";
import { type FontFace, type FontSet, faceKey, selectFace } from "../../fonts.ts";
import type { LayoutDocument, TextStyle } from "../../layout/ir.ts";
import { type Measurer, type TypesetPage, typeset } from "./typeset.ts";

export interface PdfOptions {
  fonts: FontSet;
  /**
   * Creation/modification date written into the file. Fixed by default so
   * the same input always yields the same bytes. The CLI maps
   * `SOURCE_DATE_EPOCH` here (reproducible-builds convention).
   */
  date?: Date;
}

export const DEFAULT_DOCUMENT_DATE = new Date(Date.UTC(2000, 0, 1));

export interface PdfResult {
  /** Present unless a font could not be resolved. */
  pdf?: Uint8Array;
  pages: number;
  diagnostics: Diagnostic[];
}

/** Render a layout document to PDF bytes. Deterministic for equal inputs. */
export async function renderPdf(layout: LayoutDocument, opts: PdfOptions): Promise<PdfResult> {
  const diagnostics: Diagnostic[] = [];
  const date = opts.date ?? DEFAULT_DOCUMENT_DATE;

  const doc = new PDFDocument({
    size: [layout.page.width, layout.page.height],
    margin: 0,
    autoFirstPage: false,
    // No default font: avoids loading the built-in Helvetica (non-embedded,
    // limited charset, and needs fs access).
    font: null as unknown as string,
    lang: layout.meta.lang,
    displayTitle: true,
    info: {
      Title: layout.meta.title,
      Author: layout.meta.author,
      ...(layout.meta.subject ? { Subject: layout.meta.subject } : {}),
      ...(layout.meta.keywords?.length ? { Keywords: layout.meta.keywords.join(", ") } : {}),
      Creator: "cvac",
      Producer: "cvac",
      CreationDate: date,
      ModDate: date,
    },
  });

  const chunks: Uint8Array[] = [];
  const done = new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  // Register only the faces actually used, in a stable order.
  const used = new Map<string, FontFace>();
  const faceFor = (s: TextStyle): FontFace | undefined => {
    const f = selectFace(opts.fonts, s);
    if (f && !used.has(faceKey(f))) {
      used.set(faceKey(f), f);
      doc.registerFont(faceKey(f), f.data as unknown as Buffer);
    }
    return f;
  };
  const missing = new Set<string>();
  const use = (s: TextStyle): boolean => {
    const f = faceFor(s);
    if (!f) {
      if (!missing.has(s.family)) {
        missing.add(s.family);
        const available = [...new Set(opts.fonts.map((x) => x.family))].join(", ") || "none";
        diagnostics.push({
          code: "unknown-font",
          severity: "error",
          origin: "theme",
          message: `Font family '${s.family}' is not available. Available: ${available}`,
        });
      }
      return false;
    }
    doc.font(faceKey(f)).fontSize(s.size);
    return true;
  };

  const widths = new Map<string, number>();
  const measurer: Measurer = {
    width(text, s) {
      const key = `${s.family}|${s.weight}|${s.italic}|${s.size}|${text}`;
      let w = widths.get(key);
      if (w === undefined) {
        w = use(s) ? doc.widthOfString(text) : text.length * s.size * 0.5;
        widths.set(key, w);
      }
      return w;
    },
    ascent: (s) => (use(s) ? (fontMetrics(doc).ascender / 1000) * s.size : s.size * 0.8),
    descent: (s) =>
      use(s) ? (Math.abs(fontMetrics(doc).descender) / 1000) * s.size : s.size * 0.2,
  };

  const pages = typeset(layout, measurer);
  if (diagnostics.some((d) => d.severity === "error")) {
    doc.end();
    await done;
    return { pages: pages.length, diagnostics };
  }

  draw(doc, pages, layout, use);
  doc.end();
  await done;
  return { pdf: concat(chunks), pages: pages.length, diagnostics };
}

function draw(
  doc: PDFKit.PDFDocument,
  pages: TypesetPage[],
  layout: LayoutDocument,
  use: (s: TextStyle) => boolean,
) {
  for (const page of pages) {
    doc.addPage({ size: [layout.page.width, layout.page.height], margin: 0 });
    for (const item of page.items) {
      if (item.type === "rule") {
        doc
          .save()
          .moveTo(item.x1, item.y)
          .lineTo(item.x2, item.y)
          .lineWidth(item.thickness)
          .strokeColor(item.color)
          .stroke()
          .restore();
        continue;
      }
      use(item.style);
      doc.fillColor(item.style.color).text(item.text, item.x, item.y, {
        lineBreak: false,
        baseline: "alphabetic",
        ...(item.link ? { link: item.link } : {}),
      });
    }
  }
}

function fontMetrics(doc: PDFKit.PDFDocument): { ascender: number; descender: number } {
  return (doc as unknown as { _font: { ascender: number; descender: number } })._font;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
