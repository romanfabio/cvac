import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Structurally identical to `FontFace` in `@cvac/core` (no dependency needed). */
export interface BundledFontFace {
  family: string;
  weight: number;
  italic: boolean;
  data: Uint8Array;
}

/** Bundled faces: family, weight, italic, file (relative to `files/`). */
export const BUNDLED_FACES = [
  ["Source Sans 3", 400, false, "source-sans-3/SourceSans3_400Regular.ttf"],
  ["Source Sans 3", 400, true, "source-sans-3/SourceSans3_400Regular_Italic.ttf"],
  ["Source Sans 3", 600, false, "source-sans-3/SourceSans3_600SemiBold.ttf"],
  ["Source Sans 3", 600, true, "source-sans-3/SourceSans3_600SemiBold_Italic.ttf"],
] as const;

let cache: BundledFontFace[] | undefined;

/** Load all bundled fonts from disk (Node only). */
export function loadBundledFonts(): BundledFontFace[] {
  cache ??= BUNDLED_FACES.map(([family, weight, italic, file]) => ({
    family,
    weight,
    italic,
    data: new Uint8Array(readFileSync(fileURLToPath(new URL(`../files/${file}`, import.meta.url)))),
  }));
  return cache;
}
