import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Content, parseContent, parseTheme, type Theme } from "../src/index.ts";

export const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");

export interface Fixture {
  content: Content;
  /** fixtures/<name>/theme.yaml, when present. */
  theme?: Theme;
  /** The photo, keyed as written in the CV. */
  assets: Record<string, Uint8Array>;
  variant?: string;
}

/**
 * Load `fixture[:variant][+theme]` with its theme and photo. `+theme` swaps
 * the fixture's own theme for a built-in one (`{ extends: theme }`).
 */
export function loadFixture(name: string): Fixture {
  const [spec, builtin] = name.split("+") as [string, string | undefined];
  const [dir, variant] = spec.split(":") as [string, string | undefined];
  const root = join(FIXTURES, dir);
  const parsed = parseContent(readFileSync(join(root, "cv.yaml"), "utf8"));
  if (!parsed.value) throw new Error(JSON.stringify(parsed.diagnostics));
  const out: Fixture = { content: parsed.value, assets: {} };
  const themeFile = join(root, "theme.yaml");
  if (builtin) {
    out.theme = { extends: builtin };
  } else if (existsSync(themeFile)) {
    const t = parseTheme(readFileSync(themeFile, "utf8"));
    if (!t.value) throw new Error(JSON.stringify(t.diagnostics));
    out.theme = t.value;
  }
  const photo = parsed.value.basics.photo;
  if (photo) out.assets[photo] = new Uint8Array(readFileSync(join(root, photo)));
  if (variant) out.variant = variant;
  return out;
}

/** Build options for a fixture (spread into buildPdf/buildDocx/layout). */
export function fixtureOptions(f: Fixture) {
  return {
    assets: f.assets,
    ...(f.theme ? { theme: f.theme } : {}),
    ...(f.variant ? { variant: f.variant } : {}),
  };
}
