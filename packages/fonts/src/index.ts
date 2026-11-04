import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BUNDLED_FACES, type BundledFontFace } from "./faces.ts";

export { BUNDLED_FACES, type BundledFontFace } from "./faces.ts";

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
