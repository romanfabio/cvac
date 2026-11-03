import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type Content,
  type Diagnostic,
  locateDiagnostics,
  parseContent,
  parseTheme,
  type Theme,
} from "@cvac/core";

export const DEFAULT_CV = "cv.yaml";
export const DEFAULT_THEME = "theme.yaml";

export interface Inputs {
  cvPath: string;
  themePath?: string;
  content?: Content;
  theme?: Theme;
  /** Display name -> source text, for diagnostic excerpts. */
  sources: Map<string, string>;
  diagnostics: Diagnostic[];
  /** Display names (relative to cwd) used in diagnostics. */
  cvName: string;
  themeName?: string;
}

/** Path as shown to the user: relative to the working directory. */
export function displayName(path: string, cwd = process.cwd()): string {
  return relative(cwd, path).replace(/\\/g, "/") || path;
}

/**
 * Read and parse the CV and its theme. The theme is `--theme` if given,
 * else `theme.yaml` next to the CV if it exists, else the default theme.
 */
export function loadInputs(
  cvArg: string | undefined,
  themeArg: string | undefined,
  cwd = process.cwd(),
): Inputs {
  const cvPath = resolve(cwd, cvArg ?? DEFAULT_CV);
  const cvName = displayName(cvPath, cwd);
  const sources = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  const inputs: Inputs = { cvPath, cvName, sources, diagnostics };

  const cvSource = readSource(cvPath, cvName, "content", diagnostics);
  if (cvSource !== undefined) {
    sources.set(cvName, cvSource);
    const r = parseContent(cvSource, { file: cvName });
    diagnostics.push(...r.diagnostics);
    if (r.value) inputs.content = r.value;
  }

  const sibling = join(dirname(cvPath), DEFAULT_THEME);
  const themePath =
    themeArg !== undefined ? resolve(cwd, themeArg) : existsSync(sibling) ? sibling : undefined;
  if (themePath) {
    const themeName = displayName(themePath, cwd);
    inputs.themePath = themePath;
    inputs.themeName = themeName;
    const themeSource = readSource(themePath, themeName, "theme", diagnostics);
    if (themeSource !== undefined) {
      sources.set(themeName, themeSource);
      const r = parseTheme(themeSource, { file: themeName });
      diagnostics.push(...r.diagnostics);
      if (r.value) inputs.theme = r.value;
    }
  }
  return inputs;
}

function readSource(
  path: string,
  name: string,
  origin: "content" | "theme",
  diagnostics: Diagnostic[],
): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const notFound = (e as NodeJS.ErrnoException).code === "ENOENT";
    diagnostics.push({
      code: notFound ? "file-not-found" : "file-unreadable",
      severity: "error",
      message: notFound
        ? `Cannot find ${name}${origin === "content" ? ". Run `cvac init` to create a starter CV." : ""}`
        : `Cannot read ${name}: ${(e as Error).message}`,
      origin,
    });
    return undefined;
  }
}

/** Attach file/line info to diagnostics produced after parsing. */
export function locate(diags: Diagnostic[], inputs: Inputs): Diagnostic[] {
  let out = diags;
  const cv = inputs.sources.get(inputs.cvName);
  if (cv !== undefined)
    out = locateDiagnostics(out, cv, { origin: "content", file: inputs.cvName });
  const themeSrc = inputs.themeName ? inputs.sources.get(inputs.themeName) : undefined;
  if (themeSrc !== undefined && inputs.themeName) {
    out = locateDiagnostics(out, themeSrc, { origin: "theme", file: inputs.themeName });
  }
  return out;
}
