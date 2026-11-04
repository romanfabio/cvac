import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  type ParagraphChild,
  Tab,
  TabStopType,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from "docx";
import type { Diagnostic } from "../../diagnostics.ts";
import type { FontSet } from "../../fonts.ts";
import type {
  BlockRole,
  Paragraph as IrParagraph,
  LayoutDocument,
  PhotoBox,
  Run,
  TextStyle,
} from "../../layout/ir.ts";
import { DEFAULT_DOCUMENT_DATE } from "../pdf/render.ts";
import { describeFonts } from "./fonts.ts";
import { normalizeDocx, type PhotoCrop } from "./normalize.ts";

export interface DocxOptions {
  /** Creation/modification date written into the file (fixed by default). */
  date?: Date;
  /**
   * Font files of the families used. Needed for the font table hints that
   * let Word substitute a similar font when the font is not installed.
   */
  fonts?: FontSet;
  /**
   * Embed the font files so the document looks the same on every machine
   * (default: true). Adds the full font files, about 0.5 MB for the bundled
   * faces. Set to false for a small file; Word then substitutes a similar
   * font, guided by the font table, when the font is not installed.
   */
  embedFonts?: boolean;
}

export interface DocxResult {
  docx: Uint8Array;
  diagnostics: Diagnostic[];
}

const BULLET_REF = "cvac-bullet";

/** Points -> twentieths of a point (twips), Word's main length unit. */
const twips = (pt: number) => Math.round(pt * 20);
/** Points -> half-points, Word's font size unit. */
const halfPoints = (pt: number) => Math.round(pt * 2);
const hex = (c: string) => c.replace(/^#/, "").toUpperCase();

/**
 * Render a layout document to DOCX. Word paginates, so the IR maps to native
 * constructs: built-in heading styles (Title / Heading 1 / Heading 2) for
 * structure, right tab stops for dates, real bullet lists, paragraph borders
 * for rules, and keep-with-next / keep-lines for the PDF's keep rules.
 * No text boxes, tables, headers or footers: ATS parsers read all of it.
 */
export async function renderDocx(
  layout: LayoutDocument,
  opts: DocxOptions = {},
): Promise<DocxResult> {
  const { page } = layout;
  const contentWidth = page.width - page.margins.left - page.margins.right;
  const paragraphs = layout.blocks.flatMap((b) => (b.kind === "group" ? b.blocks : [b]));

  const children: Paragraph[] = [];
  let photoRun: ImageRun | undefined = layout.photo ? photoImage(layout.photo) : undefined;
  for (const b of layout.blocks) {
    if (b.kind === "paragraph") {
      // The photo floats beside the first paragraph (the name).
      children.push(paragraph(b, contentWidth, false, false, photoRun));
      photoRun = undefined;
    } else {
      b.blocks.forEach((p, i) => {
        // keep-together group: chain keep-with-next through the entry.
        const keepNext = b.keepTogether && i < b.blocks.length - 1;
        children.push(paragraph(p, contentWidth, keepNext, b.keepTogether));
      });
    }
  }

  const styleOf = (role: BlockRole) => paragraphs.find((p) => p.role === role)?.runs[0]?.style;
  const body = styleOf("body") ?? paragraphs[0]?.runs[0]?.style;
  const bullet = paragraphs.find((p) => p.bullet);

  const doc = new Document({
    title: layout.meta.title,
    creator: layout.meta.author,
    lastModifiedBy: "cvac",
    revision: 1,
    ...(layout.meta.subject ? { subject: layout.meta.subject } : {}),
    ...(layout.meta.keywords?.length ? { keywords: layout.meta.keywords.join(", ") } : {}),
    styles: {
      default: {
        document: {
          run: {
            ...(body ? runProps(body) : {}),
            language: { value: layout.meta.lang },
          },
          paragraph: { spacing: { before: 0, after: 0 } },
        },
        // Built-in heading styles carry the semantics (outline levels that
        // ATS and screen readers use); their look follows the theme.
        ...headingStyle("title", styleOf("name")),
        ...headingStyle("heading1", styleOf("heading")),
        ...headingStyle("heading2", styleOf("item-title")),
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: bullet?.bullet ?? "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: twips(bullet?.indent ?? 11),
                    hanging: twips(Math.max((bullet?.indent ?? 11) - 3.5, 0)),
                  },
                },
                ...(bullet?.runs[0] ? { run: runProps(bullet.runs[0].style) } : {}),
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(page.width), height: twips(page.height) },
            margin: {
              top: twips(page.margins.top),
              right: twips(page.margins.right),
              bottom: twips(page.margins.bottom),
              left: twips(page.margins.left),
              header: 0,
              footer: 0,
              gutter: 0,
            },
          },
        },
        children,
      },
    ],
  });

  const diagnostics: Diagnostic[] = [];
  const families = [
    ...new Set(
      paragraphs.flatMap((p) => [...p.runs, ...(p.aside ?? [])].map((r) => r.style.family)),
    ),
  ];
  const fonts = opts.fonts ? describeFonts(opts.fonts, families, opts.embedFonts ?? true) : [];
  if (opts.embedFonts && !opts.fonts) {
    diagnostics.push({
      code: "embed-without-fonts",
      severity: "warning",
      message: "embedFonts needs the font files (fonts option); fonts were not embedded",
    });
  }

  // ArrayBuffer, not Buffer: the same code runs in Node and in the browser.
  const packed = await Packer.toArrayBuffer(doc);
  return {
    docx: normalizeDocx(
      new Uint8Array(packed),
      opts.date ?? DEFAULT_DOCUMENT_DATE,
      fonts,
      layout.photo ? photoCrop(layout.photo) : undefined,
    ),
    diagnostics,
  };
}

const HEADING_STYLE: Partial<Record<BlockRole, string>> = {
  name: "Title",
  heading: "Heading1",
  "item-title": "Heading2",
};

function paragraph(
  p: IrParagraph,
  contentWidth: number,
  keepNext: boolean,
  keepLines = false,
  lead?: ParagraphChild,
): Paragraph {
  const kids: ParagraphChild[] = [...(lead ? [lead] : []), ...p.runs.map(run)];
  if (p.aside?.length) {
    kids.push(new TextRun({ children: [new Tab()], ...runProps((p.aside[0] as Run).style) }));
    kids.push(...p.aside.map(run));
  }
  const maxSize = Math.max(...[...p.runs, ...(p.aside ?? [])].map((r) => r.style.size), 0);
  const style = HEADING_STYLE[p.role];

  return new Paragraph({
    ...(style ? { style } : {}),
    children: kids,
    spacing: {
      before: twips(p.spaceBefore),
      after: twips(p.spaceAfter),
      // Exactly the PDF line box (largest size on the line x line height).
      // "At least" would let Word use the font's natural line gap, which for
      // most fonts is taller and breaks page parity with the PDF.
      line: twips(maxSize * p.lineHeight),
      lineRule: LineRuleType.EXACT,
    },
    ...(p.bullet
      ? { numbering: { reference: BULLET_REF, level: 0 } }
      : p.indent
        ? { indent: { left: twips(p.indent) } }
        : {}),
    ...(p.aside?.length
      ? { tabStops: [{ type: TabStopType.RIGHT, position: twips(contentWidth) }] }
      : {}),
    ...(p.keepWithNext || keepNext ? { keepNext: true } : {}),
    ...(keepLines ? { keepLines: true } : {}),
    ...(p.align === "center" ? { alignment: AlignmentType.CENTER } : {}),
    ...(p.ruleBelow || p.bar
      ? {
          border: {
            ...(p.ruleBelow
              ? {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: Math.max(2, Math.round(p.ruleBelow.thickness * 8)),
                    color: hex(p.ruleBelow.color),
                    space: Math.round(p.ruleBelow.gap),
                  },
                }
              : {}),
            // The bar is a left paragraph border: Word draws it `space`
            // points before the text, which starts at the indent.
            ...(p.bar
              ? {
                  left: {
                    style: BorderStyle.SINGLE,
                    size: Math.min(96, Math.round(p.bar.width * 8)),
                    color: hex(p.bar.color),
                    space: Math.round(p.bar.gap),
                  },
                }
              : {}),
          },
        }
      : {}),
  });
}

/** Points to EMU (English Metric Units: 12700 per point). */
const emu = (pt: number) => Math.round(pt * 12700);

/**
 * The photo as a floating image at the top corner of the margin box, with
 * text wrapping around it. Its drawing id is fixed: the docx library would
 * otherwise draw one from a process-wide counter (not reproducible).
 */
function photoImage(photo: PhotoBox): ImageRun {
  const px = Math.round((photo.size * 96) / 72);
  const left = photo.position === "header-left";
  return new ImageRun({
    type: photo.format === "png" ? "png" : "jpg",
    data: photo.data,
    transformation: { width: px, height: px },
    floating: {
      horizontalPosition: {
        relative: HorizontalPositionRelativeFrom.MARGIN,
        align: left ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT,
      },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
      wrap: {
        type: TextWrappingType.SQUARE,
        side: left ? TextWrappingSide.RIGHT : TextWrappingSide.LEFT,
      },
      margins: { left: left ? 0 : emu(12), right: left ? emu(12) : 0, top: 0, bottom: 0 },
    },
    altText: { id: "1", name: "Photo", description: photo.alt, title: photo.alt },
  });
}

/** Cover crop (in 1/1000 of a percent per side) and mask shape for the normalizer. */
function photoCrop(photo: PhotoBox): PhotoCrop {
  const aspect = photo.pixelWidth / photo.pixelHeight;
  const side = (visible: number) => Math.round(((1 - visible) / 2) * 100_000);
  const lr = aspect > 1 ? side(1 / aspect) : 0;
  const tb = aspect < 1 ? side(aspect) : 0;
  return {
    left: lr,
    right: lr,
    top: tb,
    bottom: tb,
    geometry:
      photo.shape === "circle" ? "ellipse" : photo.shape === "rounded" ? "roundRect" : "rect",
  };
}

function run(r: Run): ParagraphChild {
  const text = new TextRun({ text: r.text, ...runProps(r.style) });
  return r.link ? new ExternalHyperlink({ link: r.link, children: [text] }) : text;
}

function runProps(s: TextStyle) {
  return {
    font: s.family,
    size: halfPoints(s.size),
    bold: s.weight >= 600,
    italics: s.italic,
    color: hex(s.color),
  };
}

function headingStyle(key: "title" | "heading1" | "heading2", s: TextStyle | undefined) {
  if (!s) return {};
  return {
    [key]: {
      run: { ...runProps(s), underline: undefined },
      paragraph: { spacing: { before: 0, after: 0 }, keepNext: true },
    },
  };
}
