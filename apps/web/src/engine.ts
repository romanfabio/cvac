import {
  buildDocx,
  buildPdf,
  type Diagnostic,
  type FontSet,
  hasErrors,
  lint,
  locateDiagnostics,
  parseContent,
  parseTheme,
  sortDiagnostics,
  type Theme,
} from "@cvac/core";

import { CV_FILE, THEME_FILE } from "./files.ts";

export { CV_FILE, THEME_FILE };

export interface BuildRequest {
  /** Increasing id: the UI ignores results of superseded requests. */
  id: number;
  format: "pdf" | "docx";
  cv: string;
  /** theme.yaml text; empty means the built-in default theme. */
  theme: string;
  locale?: string;
  variant?: string;
  /** Files the CV refers to (the photo), keyed as written in the CV. */
  assets: Record<string, Uint8Array>;
  embedFonts?: boolean;
}

export interface BuildResult {
  id: number;
  format: "pdf" | "docx";
  /** Present only when there are no errors. */
  bytes?: Uint8Array;
  pages?: number;
  diagnostics: Diagnostic[];
  /** What the toolbar offers, read from the CV. */
  locales: string[];
  variants: string[];
  photo?: string;
  ms: number;
}

/**
 * Parse, build and lint, exactly like `cvac build` (same core calls, same
 * fixed document date), so the browser produces the same bytes as the CLI.
 * Pure: runs in the worker, and in Node for tests.
 */
export async function runBuild(req: BuildRequest, fonts: FontSet): Promise<BuildResult> {
  const t0 = performance.now();
  const diagnostics: Diagnostic[] = [];
  const cv = parseContent(req.cv, { file: CV_FILE });
  diagnostics.push(...cv.diagnostics);
  let theme: Theme | undefined;
  if (req.theme.trim()) {
    const t = parseTheme(req.theme, { file: THEME_FILE });
    diagnostics.push(...t.diagnostics);
    theme = t.value;
  }
  const content = cv.value;
  const result: BuildResult = {
    id: req.id,
    format: req.format,
    diagnostics,
    locales:
      content?.meta?.locales ?? (content?.meta?.defaultLocale ? [content.meta.defaultLocale] : []),
    variants: Object.keys(content?.meta?.variants ?? {}),
    ...(content?.basics.photo ? { photo: content.basics.photo } : {}),
    ms: 0,
  };

  if (content && !hasErrors(diagnostics)) {
    const opts = {
      fonts,
      assets: req.assets,
      ...(theme ? { theme } : {}),
      ...(req.locale ? { locale: req.locale } : {}),
      ...(req.variant ? { variant: req.variant } : {}),
    };
    let bytes: Uint8Array | undefined;
    if (req.format === "pdf") {
      const r = await buildPdf(content, opts);
      diagnostics.push(...r.diagnostics);
      bytes = r.pdf;
      if (r.pages) result.pages = r.pages;
      diagnostics.push(...lint(content, { ...opts, ...(r.pages ? { pages: r.pages } : {}) }));
    } else {
      const r = await buildDocx(content, { ...opts, embedFonts: req.embedFonts ?? true });
      diagnostics.push(...r.diagnostics);
      bytes = r.docx;
    }
    if (bytes && !hasErrors(diagnostics)) result.bytes = bytes;
  }

  let located = locateDiagnostics(diagnostics, req.cv, { origin: "content", file: CV_FILE });
  if (req.theme.trim()) {
    located = locateDiagnostics(located, req.theme, { origin: "theme", file: THEME_FILE });
  }
  result.diagnostics = sortDiagnostics(located);
  result.ms = Math.round(performance.now() - t0);
  return result;
}
