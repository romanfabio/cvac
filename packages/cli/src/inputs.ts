import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type Content,
  type Diagnostic,
  locateDiagnostics,
  mergeThemes,
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
  /** Files the CV refers to (the photo), keyed as written in the CV. */
  assets: Record<string, Uint8Array>;
  /** Every file the build depends on (for watch mode). */
  files: string[];
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
  const inputs: Inputs = { cvPath, cvName, sources, diagnostics, assets: {}, files: [cvPath] };

  const cvSource = readSource(cvPath, cvName, "content", diagnostics);
  if (cvSource !== undefined) {
    sources.set(cvName, cvSource);
    const r = parseContent(cvSource, { file: cvName });
    diagnostics.push(...r.diagnostics);
    if (r.value) inputs.content = r.value;
    // The photo, relative to the CV. When missing, core reports a located
    // photo-not-found error.
    const photo = r.value?.basics.photo;
    if (photo) {
      const photoPath = resolve(dirname(cvPath), photo);
      inputs.files.push(photoPath);
      try {
        inputs.assets[photo] = new Uint8Array(readFileSync(photoPath));
      } catch {
        // reported by core
      }
    }
  }

  const sibling = join(dirname(cvPath), DEFAULT_THEME);
  const themePath =
    themeArg !== undefined ? resolve(cwd, themeArg) : existsSync(sibling) ? sibling : undefined;
  if (themePath) {
    const themeName = displayName(themePath, cwd);
    inputs.themePath = themePath;
    inputs.themeName = themeName;
    const theme = loadThemeChain(themePath, cwd, inputs);
    if (theme) inputs.theme = theme;
  }
  return inputs;
}

/** `extends` values that point at a file rather than a built-in theme. */
const isFileRef = (ref: string) => /^\.{1,2}[\\/]|\.ya?ml$/i.test(ref);

/**
 * Read a theme and the theme files it extends (relative to each file),
 * merging them into one theme whose `extends` is a built-in name or unset.
 */
function loadThemeChain(path: string, cwd: string, inputs: Inputs): Theme | undefined {
  const chain: Theme[] = [];
  const seen = new Set<string>();
  let current: string | undefined = path;
  while (current) {
    const name = displayName(current, cwd);
    if (seen.has(current)) {
      inputs.diagnostics.push({
        code: "theme-cycle",
        severity: "error",
        message: `Theme ${name} is extended twice in the same chain`,
        origin: "theme",
      });
      return undefined;
    }
    seen.add(current);
    inputs.files.push(current);
    const source = readSource(current, name, "theme", inputs.diagnostics);
    if (source === undefined) return undefined;
    inputs.sources.set(name, source);
    const r = parseTheme(source, { file: name });
    inputs.diagnostics.push(...r.diagnostics);
    if (!r.value) return undefined;
    chain.unshift(r.value);
    const ext = r.value.extends;
    current = ext && isFileRef(ext) ? resolve(dirname(current), ext) : undefined;
  }
  // Base first, then each override on top. Overrides' `extends` name files;
  // the result keeps the base's (a built-in name, or none) for core.
  const [base, ...overrides] = chain as [Theme, ...Theme[]];
  const { extends: _fileRef, ...merged } = overrides.reduce(mergeThemes, base);
  return base.extends !== undefined ? { ...merged, extends: base.extends } : merged;
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
