import { type Diagnostic, hasErrors } from "./diagnostics.ts";
import type { FontSet } from "./fonts.ts";
import { buildLayout } from "./layout/build.ts";
import type { LayoutDocument } from "./layout/ir.ts";
import type { Content } from "./model/content.ts";
import type { Theme } from "./model/theme.ts";
import { renderPdf } from "./render/pdf/render.ts";
import { resolveLocale } from "./resolve/locale.ts";
import { resolveTheme } from "./theme/resolve.ts";

export interface LayoutOptions {
  /** Output language. Defaults to `meta.defaultLocale`, then `en`. */
  locale?: string;
  /** User theme layered over the built-in default theme. */
  theme?: Theme;
}

export interface LayoutResult {
  layout?: LayoutDocument;
  diagnostics: Diagnostic[];
}

/** Content + theme -> renderer-independent layout document. */
export function layout(content: Content, opts: LayoutOptions = {}): LayoutResult {
  const loc = resolveLocale(content, opts.locale);
  const th = resolveTheme(opts.theme);
  const diagnostics = [...th.diagnostics, ...loc.diagnostics];
  if (hasErrors(diagnostics)) return { diagnostics };
  return { layout: buildLayout(loc.content, th.theme, loc.locale), diagnostics };
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
