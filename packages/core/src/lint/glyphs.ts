/// <reference path="../render/docx/fontkit.d.ts" />
import { create as openFont } from "fontkit";
import type { FontFace } from "../fonts.ts";

interface GlyphFont {
  hasGlyphForCodePoint(cp: number): boolean;
}

const cache = new WeakMap<Uint8Array, GlyphFont>();

/** Characters of `text` the face cannot draw (whitespace and controls ignored). */
export function missingGlyphs(face: FontFace, text: string): string[] {
  let font = cache.get(face.data);
  if (!font) {
    font = openFont(face.data) as GlyphFont;
    cache.set(face.data, font);
  }
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20 || /\s/.test(ch) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if (!font.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return [...missing];
}
