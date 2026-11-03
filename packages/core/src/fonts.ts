/**
 * Fonts are passed in as bytes: core never touches the file system or system
 * fonts, so the same inputs always embed the same glyphs (determinism) and
 * the library runs unchanged in Node and in the browser.
 */
export interface FontFace {
  family: string;
  /** 100-900 */
  weight: number;
  italic: boolean;
  /** TrueType/OpenType font file contents. */
  data: Uint8Array;
}

export type FontSet = readonly FontFace[];

/** Stable face key, used as the registered font name. */
export function faceKey(f: Pick<FontFace, "family" | "weight" | "italic">): string {
  return `${f.family.replace(/\s+/g, "")}-${f.weight}${f.italic ? "-italic" : ""}`;
}

/**
 * Pick the closest face: same family (case-insensitive), then matching
 * italic, then nearest weight (ties go to the heavier face for bold-ish
 * requests, lighter otherwise, roughly like CSS font matching).
 */
export function selectFace(
  fonts: FontSet,
  want: { family: string; weight: number; italic: boolean },
): FontFace | undefined {
  const family = want.family.toLowerCase();
  const candidates = fonts.filter((f) => f.family.toLowerCase() === family);
  let best: FontFace | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of candidates) {
    const diff = f.weight - want.weight;
    const tieBreak = want.weight >= 500 ? (diff >= 0 ? 0 : 0.5) : diff <= 0 ? 0 : 0.5;
    const score = (f.italic === want.italic ? 0 : 10_000) + Math.abs(diff) + tieBreak;
    if (score < bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}
