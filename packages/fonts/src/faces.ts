/** Structurally identical to `FontFace` in `@cvac/core` (no dependency needed). */
export interface BundledFontFace {
  family: string;
  weight: number;
  italic: boolean;
  data: Uint8Array;
}

/**
 * Bundled faces: family, weight, italic, file (relative to `files/`).
 * Browser-safe (no fs): web apps fetch `files/<file>` themselves.
 */
export const BUNDLED_FACES = [
  ["Source Sans 3", 400, false, "source-sans-3/SourceSans3_400Regular.ttf"],
  ["Source Sans 3", 400, true, "source-sans-3/SourceSans3_400Regular_Italic.ttf"],
  ["Source Sans 3", 600, false, "source-sans-3/SourceSans3_600SemiBold.ttf"],
  ["Source Sans 3", 600, true, "source-sans-3/SourceSans3_600SemiBold_Italic.ttf"],
  ["Source Serif 4", 400, false, "source-serif-4/SourceSerif4_400Regular.ttf"],
  ["Source Serif 4", 400, true, "source-serif-4/SourceSerif4_400Regular_Italic.ttf"],
  ["Source Serif 4", 600, false, "source-serif-4/SourceSerif4_600SemiBold.ttf"],
  ["Source Serif 4", 600, true, "source-serif-4/SourceSerif4_600SemiBold_Italic.ttf"],
] as const;

/** The bundled font families. */
export const BUNDLED_FAMILIES = [...new Set(BUNDLED_FACES.map(([family]) => family))];
