import { type Diagnostic, hasErrors } from "./diagnostics.ts";
import type { FontSet } from "./fonts.ts";
import { type ImageInfo, probeImage } from "./images.ts";
import { buildLayout } from "./layout/build.ts";
import type { LayoutDocument } from "./layout/ir.ts";
import type { Content } from "./model/content.ts";
import type { Theme } from "./model/theme.ts";
import { renderDocx } from "./render/docx/render.ts";
import { renderHtml } from "./render/html/render.ts";
import { renderPdf } from "./render/pdf/render.ts";
import { renderMarkdown, renderText } from "./render/text/render.ts";
import { resolveLocale } from "./resolve/locale.ts";
import { mapDiagnostics, resolveVariant } from "./resolve/variant.ts";
import { resolveTheme } from "./theme/resolve.ts";

export interface LayoutOptions {
  /** Named variant from `meta.variants`, or a tag to filter by. */
  variant?: string;
  /** Output language. Defaults to `meta.defaultLocale`, then `en`. */
  locale?: string;
  /** User theme layered over the built-in default theme. */
  theme?: Theme;
  /**
   * Files the CV refers to (the photo), keyed by the path as written in
   * the CV. Core reads no files; the CLI or the web editor provides them.
   */
  assets?: Readonly<Record<string, Uint8Array>>;
  /** One column in CV order, ignoring the theme's sidebar (used for DOCX). */
  linear?: boolean;
}

export interface LayoutResult {
  layout?: LayoutDocument;
  diagnostics: Diagnostic[];
}

/** Content + theme -> renderer-independent layout document. */
export function layout(content: Content, opts: LayoutOptions = {}): LayoutResult {
  const v = resolveVariant(content, opts.variant);
  if (hasErrors(v.diagnostics)) return { diagnostics: v.diagnostics };
  const loc = resolveLocale(v.content, opts.locale);
  const th = resolveTheme(opts.theme);
  const diagnostics = [...th.diagnostics, ...mapDiagnostics(loc.diagnostics, v)];
  const photo = th.theme.photo.show
    ? loadPhoto(content.basics.photo, opts.assets, diagnostics)
    : undefined;
  if (hasErrors(diagnostics)) return { diagnostics };
  return {
    layout: buildLayout(loc.content, th.theme, loc.locale, {
      ...(opts.linear ? { linear: true } : {}),
      ...(photo ? { photo } : {}),
    }),
    diagnostics,
  };
}

function loadPhoto(
  path: string | undefined,
  assets: LayoutOptions["assets"],
  diagnostics: Diagnostic[],
): { data: Uint8Array; info: ImageInfo } | undefined {
  if (!path) return undefined;
  const at = { path: ["basics", "photo"], origin: "content" as const };
  const data = assets?.[path];
  if (!data) {
    diagnostics.push({
      code: "photo-not-found",
      severity: "error",
      message: `Cannot find the photo '${path}'`,
      help: "Paths are relative to the CV file. Remove basics.photo, or set photo: { show: false } in the theme",
      ...at,
    });
    return undefined;
  }
  const info = probeImage(data);
  if (!info) {
    diagnostics.push({
      code: "photo-format",
      severity: "error",
      message: `'${path}' is not a PNG or JPEG image`,
      help: "Convert the photo to JPEG or PNG",
      ...at,
    });
    return undefined;
  }
  return { data, info };
}

export interface BuildPdfOptions extends LayoutOptions {
  fonts: FontSet;
  date?: Date;
}

export interface BuildPdfResult {
  pdf?: Uint8Array;
  pages?: number;
  diagnostics: Diagnostic[];
}

/** Parsed content -> PDF bytes. */
export async function buildPdf(content: Content, opts: BuildPdfOptions): Promise<BuildPdfResult> {
  const l = layout(content, opts);
  if (!l.layout) return { diagnostics: l.diagnostics };
  const r = await renderPdf(l.layout, {
    fonts: opts.fonts,
    ...(opts.date ? { date: opts.date } : {}),
  });
  const out: BuildPdfResult = { pages: r.pages, diagnostics: [...l.diagnostics, ...r.diagnostics] };
  if (r.pdf) out.pdf = r.pdf;
  return out;
}

export interface BuildDocxOptions extends LayoutOptions {
  date?: Date;
  /** Font files: embedded by default, and used for font-table hints. */
  fonts?: FontSet;
  embedFonts?: boolean;
}

export interface BuildDocxResult {
  docx?: Uint8Array;
  diagnostics: Diagnostic[];
}

export interface BuildTextResult {
  /** The document, `\n` line endings, ending in one newline. */
  text?: string;
  diagnostics: Diagnostic[];
}

/**
 * Parsed content -> Markdown. Like the DOCX, one column in CV order; the
 * theme still sets heading case and date format. The photo is left out.
 */
export function buildMarkdown(content: Content, opts: LayoutOptions = {}): BuildTextResult {
  const l = layout(content, { ...opts, linear: true });
  if (!l.layout) return { diagnostics: l.diagnostics };
  return { text: renderMarkdown(l.layout), diagnostics: l.diagnostics };
}

export interface BuildHtmlOptions extends LayoutOptions {
  fonts: FontSet;
}

/**
 * Parsed content -> one self-contained HTML page. It follows the theme,
 * columns and photo included, with the fonts embedded as subsets of the
 * characters used; the text reads in the PDF's order.
 */
export function buildHtml(content: Content, opts: BuildHtmlOptions): BuildTextResult {
  const l = layout(content, opts);
  if (!l.layout) return { diagnostics: l.diagnostics };
  const r = renderHtml(l.layout, { fonts: opts.fonts });
  const diagnostics = [...l.diagnostics, ...r.diagnostics];
  return hasErrors(r.diagnostics) ? { diagnostics } : { text: r.html, diagnostics };
}

/** Parsed content -> plain text, one column in CV order (see `buildMarkdown`). */
export function buildText(content: Content, opts: LayoutOptions = {}): BuildTextResult {
  const l = layout(content, { ...opts, linear: true });
  if (!l.layout) return { diagnostics: l.diagnostics };
  return { text: renderText(l.layout), diagnostics: l.diagnostics };
}

/**
 * Parsed content -> DOCX bytes. Always one column in CV order, whatever the
 * theme's layout: Word has no reliable sidebar, and ATS read DOCX linearly.
 */
export async function buildDocx(
  content: Content,
  opts: BuildDocxOptions = {},
): Promise<BuildDocxResult> {
  const l = layout(content, { ...opts, linear: true });
  if (!l.layout) return { diagnostics: l.diagnostics };
  const r = await renderDocx(l.layout, {
    ...(opts.date ? { date: opts.date } : {}),
    ...(opts.fonts ? { fonts: opts.fonts } : {}),
    ...(opts.embedFonts !== undefined ? { embedFonts: opts.embedFonts } : {}),
  });
  return { docx: r.docx, diagnostics: [...l.diagnostics, ...r.diagnostics] };
}
