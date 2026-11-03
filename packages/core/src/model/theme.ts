import { z } from "zod";

/**
 * Theme schema (v1 subset). Page setup and design tokens only; the declarative
 * layout tree and per-section style rules arrive with the layout engine (M2/M7).
 */

/** Length in points (number) or with a unit: `12pt`, `2cm`, `20mm`, `1in`. */
const LENGTH_RE = /^\d+(\.\d+)?(pt|mm|cm|in)$/;
export const Length = z.union([
  z.number().nonnegative(),
  z.string().regex(LENGTH_RE, "Expected a length like 12pt, 2cm, 20mm or 1in"),
]);
export type Length = z.infer<typeof Length>;

export const Color = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Expected a hex color like #1a1a1a");

export const Margins = z.union([
  Length,
  z.strictObject({ top: Length, right: Length, bottom: Length, left: Length }),
]);

export const Page = z.strictObject({
  size: z.enum(["A4", "Letter"]).default("A4"),
  margins: Margins.default("18mm"),
});

export const FontRef = z.strictObject({
  family: z.string().min(1).describe("A bundled font family, e.g. Inter"),
  size: Length.optional(),
  weight: z.union([z.literal("regular"), z.literal("bold"), z.number().int()]).optional(),
});

export const Tokens = z.strictObject({
  fonts: z
    .strictObject({
      body: FontRef.optional(),
      heading: FontRef.optional(),
    })
    .optional(),
  colors: z
    .strictObject({
      text: Color.optional(),
      muted: Color.optional(),
      accent: Color.optional(),
    })
    .optional(),
  spacing: z
    .strictObject({
      section: Length.optional(),
      item: Length.optional(),
      line: z.number().positive().optional().describe("Line height multiplier"),
    })
    .optional(),
});

export const Theme = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1).optional(),
  name: z.string().optional(),
  extends: z.string().optional().describe("Theme to inherit from, e.g. 'default'"),
  page: Page.optional(),
  tokens: Tokens.optional(),
});
export type Theme = z.output<typeof Theme>;
export type ThemeInput = z.input<typeof Theme>;
