import type { Diagnostic } from "../../diagnostics.ts";
import { type FontFace, type FontSet, selectFace } from "../../fonts.ts";
import type {
  Block,
  LayoutDocument,
  Paragraph,
  PhotoBox,
  Run,
  TextStyle,
} from "../../layout/ir.ts";
import { describeFonts } from "../docx/fonts.ts";
import { subsetFont } from "./subset.ts";

/**
 * HTML renderer: one self-contained page (styles, fonts and photo inside,
 * no scripts, nothing fetched). It follows the theme like the PDF does,
 * columns included, with the text in the same reading order: header, main
 * column, sidebar. Sizes are in points, so the page matches the PDF's;
 * narrow screens get one column, and printing uses the theme's page size
 * and margins. Fonts are embedded as subsets of the characters used.
 */

export interface HtmlOptions {
  fonts: FontSet;
}

export interface HtmlResult {
  html: string;
  diagnostics: Diagnostic[];
}

/** Width below which the page becomes one column, in CSS pixels. */
const NARROW_PX = 720;
const PHOTO_GAP = 12;

export function renderHtml(doc: LayoutDocument, opts: HtmlOptions): HtmlResult {
  const r = new HtmlRenderer(doc, opts.fonts);
  return { html: r.render(), diagnostics: r.diagnostics };
}

class HtmlRenderer {
  readonly diagnostics: Diagnostic[] = [];
  /** CSS rule bodies -> class names, numbered in order of first use. */
  private readonly classes = new Map<string, string>();
  /** Faces in order of first use, with the characters drawn in each. */
  private readonly faces = new Map<FontFace, Set<number>>();
  private readonly doc: LayoutDocument;
  private readonly fonts: FontSet;
  private readonly generics = new Map<string, string>();

  constructor(doc: LayoutDocument, fonts: FontSet) {
    this.doc = doc;
    this.fonts = fonts;
  }

  render(): string {
    const doc = this.doc;
    const regions = doc.regions ?? { header: [], main: doc.blocks, sidebar: [] };
    const cols = regions.columns;
    const photo = doc.photo;
    // Body first: it decides which classes, faces and characters exist.
    const header = this.header(regions.header, photo);
    const main = `<div class="main">\n${this.blocks(regions.main)}</div>\n`;
    const side = cols
      ? `<aside class="sidebar">\n${
          photo?.position === "sidebar" ? `${this.photo(photo)}\n` : ""
        }${this.blocks(regions.sidebar)}</aside>\n`
      : "";
    const m = doc.meta;
    const head = [
      "<!doctype html>",
      `<html lang="${attr(m.lang)}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${text(m.title)}</title>`,
      `<meta name="author" content="${attr(m.author)}">`,
      ...(m.subject ? [`<meta name="description" content="${attr(m.subject)}">`] : []),
      ...(m.keywords?.length
        ? [`<meta name="keywords" content="${attr(m.keywords.join(", "))}">`]
        : []),
      '<meta name="generator" content="cvac">',
      `<style>\n${this.css()}</style>`,
      "</head>",
      "<body>",
      `<div class="page${cols ? ` cols ${cols.side} head-${cols.headerSpan}` : ""}">`,
    ];
    return `${head.join("\n")}\n${header}${main}${side}</div>\n</body>\n</html>\n`;
  }

  // --- structure ---------------------------------------------------------------

  private header(blocks: Block[], photo: PhotoBox | undefined): string {
    const beside = photo && photo.position !== "sidebar" ? photo : undefined;
    const centered = blocks.some((b) => b.kind === "paragraph" && b.align === "center");
    let pad = "";
    if (beside) {
      const w = beside.size + PHOTO_GAP;
      // Like the PDF: a centered header keeps the photo's width free on both sides.
      const sides = centered
        ? `padding-left:${pt(w)};padding-right:${pt(w)}`
        : beside.position === "header-right"
          ? `padding-right:${pt(w)}`
          : `padding-left:${pt(w)}`;
      pad = this.cls(`${sides};min-height:${pt(beside.size)}`);
    }
    const img = beside
      ? this.photo(beside, beside.position === "header-right" ? "right" : "left")
      : "";
    return `<header${pad ? ` class="${pad}"` : ""}>\n${img ? `${img}\n` : ""}${this.blocks(blocks)}</header>\n`;
  }

  private photo(p: PhotoBox, side?: "left" | "right"): string {
    const radius = p.shape === "circle" ? "50%" : p.shape === "rounded" ? pt(p.size * 0.12) : "0";
    const where = side
      ? `position:absolute;top:0;${side}:0`
      : `display:block;margin:0 auto ${pt(PHOTO_GAP)}`;
    const c = this.cls(
      `${where};width:${pt(p.size)};height:${pt(p.size)};object-fit:cover;border-radius:${radius}`,
    );
    const mime = p.format === "png" ? "image/png" : "image/jpeg";
    return `<img class="${c}" src="data:${mime};base64,${base64(p.data)}" alt="${attr(p.alt)}">`;
  }

  /** Blocks of one region; each heading opens a <section>. */
  private blocks(blocks: Block[]): string {
    let out = "";
    let open = false;
    let list: string[] = [];
    const flush = () => {
      if (list.length) out += `<ul>\n${list.join("")}</ul>\n`;
      list = [];
    };
    for (const b of blocks) {
      if (b.kind === "group") {
        flush();
        out += `<div class="entry">\n${this.group(b.blocks)}</div>\n`;
        continue;
      }
      if (b.role === "bullet") {
        list.push(this.paragraph(b));
        continue;
      }
      flush();
      if (b.role === "heading") {
        if (open) out += "</section>\n";
        out += "<section>\n";
        open = true;
      }
      out += this.paragraph(b);
    }
    flush();
    if (open) out += "</section>\n";
    return out;
  }

  /** One CV entry: its bullets become a list. */
  private group(blocks: Paragraph[]): string {
    let out = "";
    let list: string[] = [];
    const flush = () => {
      if (list.length) out += `<ul class="${this.listClass(blocks)}">\n${list.join("")}</ul>\n`;
      list = [];
    };
    for (const p of blocks) {
      if (p.role === "bullet") list.push(this.paragraph(p));
      else {
        flush();
        out += this.paragraph(p);
      }
    }
    flush();
    return out;
  }

  private listClass(blocks: Paragraph[]): string {
    const b = blocks.find((p) => p.role === "bullet");
    return this.cls(`margin:0;padding-left:${pt(b?.indent ?? 0)}`);
  }

  private paragraph(p: Paragraph): string {
    const tag =
      p.role === "bullet"
        ? "li"
        : p.headingLevel === 1
          ? "h1"
          : p.headingLevel === 2
            ? "h2"
            : p.headingLevel === 3
              ? "h3"
              : "p";
    const size = Math.max(...[...p.runs, ...(p.aside ?? [])].map((r) => r.style.size), 0);
    const css = [
      "margin:0",
      `font-size:${pt(size)}`,
      `line-height:${round(p.lineHeight)}`,
      ...(p.spaceBefore ? [`padding-top:${pt(p.spaceBefore)}`] : []),
      ...(p.spaceAfter ? [`margin-bottom:${pt(p.spaceAfter)}`] : []),
      ...(p.align === "center" ? ["text-align:center"] : []),
      ...(p.keepWithNext ? ["break-after:avoid"] : []),
    ];
    if (p.bar) {
      const outside = p.indent - p.bar.width - p.bar.gap;
      if (outside) css.push(`margin-left:${pt(outside)}`);
    } else if (p.indent && p.role !== "bullet") {
      css.push(`margin-left:${pt(p.indent)}`);
    }
    if (p.ruleBelow) {
      css.push(
        `padding-bottom:${pt(p.ruleBelow.gap)}`,
        `border-bottom:${pt(p.ruleBelow.thickness)} solid ${p.ruleBelow.color}`,
      );
    }
    let inner = this.runs(
      p.runs,
      p.role !== "name" && p.role !== "heading" && p.role !== "item-title",
    );
    if (p.bar) {
      // The bar is as tall as the text lines, not the space above them.
      const bar = this.cls(
        `display:block;border-left:${pt(p.bar.width)} solid ${p.bar.color};padding-left:${pt(p.bar.gap)}`,
      );
      inner = `<span class="${bar}">${inner}</span>`;
    }
    if (!p.aside?.length) return `<${tag} class="${this.cls(css.join(";"))}">${inner}</${tag}>\n`;
    // A title with right-aligned dates: one row that wraps on narrow screens.
    const row = this.cls(
      `${css.join(";")};display:flex;flex-wrap:wrap;justify-content:space-between;column-gap:8pt`,
    );
    const titleTag = tag === "p" ? "span" : tag;
    return `<div class="${row}"><${titleTag} class="${this.cls("margin:0;font-size:inherit")}">${inner}</${titleTag}> <span>${this.runs(p.aside, true)}</span></div>\n`;
  }

  private runs(runs: Run[], strong: boolean): string {
    return runs
      .map((r) => {
        // Like the DOCX: a no-break space keeps " · " with the item before.
        const t = r.separator ? r.text.replace(/^ /, " ") : r.text;
        const c = this.cls(this.textCss(r.style, t));
        const tag = strong && r.style.weight >= 600 ? "strong" : r.style.italic ? "em" : "span";
        const body = `<${tag} class="${c}">${text(t)}</${tag}>`;
        const href = r.link && safeHref(r.link);
        return href ? `<a href="${attr(href)}">${body}</a>` : body;
      })
      .join("");
  }

  private textCss(s: TextStyle, t: string): string {
    const face = selectFace(this.fonts, s);
    if (!face) {
      this.diagnostics.push({
        code: "font-missing",
        severity: "error",
        message: `No font for '${s.family}'`,
        help: "Use a bundled font family in the theme",
      });
      return `font-size:${pt(s.size)};color:${s.color}`;
    }
    const chars = this.faces.get(face) ?? new Set<number>();
    for (const ch of t) chars.add(ch.codePointAt(0) as number);
    this.faces.set(face, chars);
    return [
      `font-family:${this.familyStack(face)}`,
      `font-weight:${face.weight}`,
      `font-style:${face.italic ? "italic" : "normal"}`,
      `font-size:${pt(s.size)}`,
      `color:${s.color}`,
    ].join(";");
  }

  /** The embedded subset first, then the installed family, then a generic one. */
  private familyStack(face: FontFace): string {
    let generic = this.generics.get(face.family);
    if (!generic) {
      const kind = describeFonts(this.fonts, [face.family], false)[0]?.familyClass ?? "auto";
      generic = { swiss: "sans-serif", roman: "serif", modern: "monospace", auto: "sans-serif" }[
        kind
      ];
      this.generics.set(face.family, generic);
    }
    return `"${embeddedName(face.family)}","${face.family}",${generic}`;
  }

  private cls(css: string): string {
    let name = this.classes.get(css);
    if (!name) {
      name = `c${this.classes.size + 1}`;
      this.classes.set(css, name);
    }
    return name;
  }

  // --- styles ---------------------------------------------------------------------

  private css(): string {
    const { width, margins } = this.doc.page;
    const cols = this.doc.regions?.columns;
    const m = margins;
    const lines: string[] = [];
    for (const [face, chars] of this.faces) {
      chars.add(0x20);
      const name = `${embeddedName(face.family)} ${face.weight}${face.italic ? " Italic" : ""}`;
      const sub = subsetFont(face.data, chars, name);
      lines.push(
        `@font-face{font-family:"${embeddedName(face.family)}";font-weight:${face.weight};font-style:${
          face.italic ? "italic" : "normal"
        };src:url(data:font/ttf;base64,${base64(sub.data)}) format("truetype")}`,
      );
    }
    lines.push(
      ":root{color-scheme:light}",
      "*{box-sizing:border-box}",
      "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
      "body{margin:0;background:#eceff1}",
      `.page{position:relative;max-width:${pt(width)};margin:24px auto;padding:${pt(m.top)} ${pt(m.right)} ${pt(m.bottom)} ${pt(m.left)};background:#fff;box-shadow:0 1px 4px rgb(0 0 0/.2);overflow-wrap:break-word}`,
      "header{position:relative}",
      "a{color:inherit;text-decoration:none}",
      "a:hover{text-decoration:underline}",
      "ul{margin:0;list-style:disc}",
      ".entry{break-inside:avoid}",
    );
    if (cols) {
      const sideW = pt(cols.sidebarWidth);
      const gap = pt(cols.gap);
      const left = cols.side === "left";
      const areas =
        cols.headerSpan === "full"
          ? left
            ? `"header header" "side main"`
            : `"header header" "main side"`
          : left
            ? `"side header" "side main"`
            : `"header side" "main side"`;
      lines.push(
        `.cols{display:grid;grid-template-columns:${left ? `${sideW} 1fr` : `1fr ${sideW}`};grid-template-rows:auto 1fr;grid-template-areas:${areas};column-gap:${gap}}`,
        ".cols>header{grid-area:header}",
        ".cols>.main{grid-area:main}",
        ".cols>.sidebar{grid-area:side}",
      );
      if (cols.sidebarBackground) {
        // Tinted to the page edge and halfway into the gap, like the PDF.
        const half = pt(cols.gap / 2);
        const outer = left ? "left" : "right";
        const inner = left ? "right" : "left";
        const top =
          cols.headerSpan === "main" ? `margin-top:-${pt(m.top)};padding-top:${pt(m.top)};` : "";
        lines.push(
          `.cols>.sidebar{background:${cols.sidebarBackground};${top}margin-bottom:-${pt(m.bottom)};padding-bottom:${pt(m.bottom)};margin-${outer}:-${pt(m[outer])};padding-${outer}:${pt(m[outer])};margin-${inner}:-${half};padding-${inner}:${half};-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
        );
      }
    }
    lines.push(
      `@media (max-width:${NARROW_PX}px){.page{margin:0;padding:20px 16px;box-shadow:none}.cols{display:block}.cols>.sidebar{margin:16px -16px -20px;padding:4px 16px 20px}header{padding-left:0!important;padding-right:0!important}header img{position:static!important;display:block;margin:0 0 12px}}`,
      `@page{size:${pt(this.doc.page.width)} ${pt(this.doc.page.height)};margin:${pt(m.top)} ${pt(m.right)} ${pt(m.bottom)} ${pt(m.left)}}`,
      "@media print{body{background:none}.page{max-width:none;margin:0;padding:0;box-shadow:none}.cols>.sidebar{margin-top:0;margin-bottom:0;padding-top:0;padding-bottom:0}}",
    );
    for (const [css, name] of this.classes) lines.push(`.${name}{${css}}`);
    return `${lines.join("\n")}\n`;
  }
}

/** The family name of an embedded subset (a subset is a modified font: see subset.ts). */
const embeddedName = (family: string) => `cvac ${family.replace(/^Source /, "")}`;

const round = (n: number) => String(Math.round(n * 100) / 100);
const pt = (n: number) => (n === 0 ? "0" : `${round(n)}pt`);

const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => text(s).replace(/"/g, "&quot;");

/** Only web, mail and phone links; anything else stays plain text. */
function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:|tel:)/i.test(url) ? url : undefined;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
