import { z } from "zod";

/**
 * Theme schema. Every field is optional: a theme is a set of overrides
 * layered over its base (`extends`, ultimately the built-in default theme),
 * so defaults live in the resolver, not here.
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

/** A share of the content width, e.g. `32%`. */
export const Percent = z.string().regex(/^\d+(\.\d+)?%$/, "Expected a percentage like 32%");

export const Page = z.strictObject({
  size: z.enum(["A4", "Letter"]).optional().describe("Default A4"),
  margins: Margins.optional().describe("Default 18mm"),
});

export const FontRef = z.strictObject({
  family: z.string().min(1).optional().describe("A bundled font family, e.g. Source Sans 3"),
  size: Length.optional(),
  weight: z
    .union([z.literal("regular"), z.literal("bold"), z.number().int().min(100).max(900)])
    .optional(),
  italic: z.boolean().optional(),
});

export const Tokens = z.strictObject({
  fonts: z
    .strictObject({
      body: FontRef.optional(),
      heading: FontRef.optional().describe("Section headings"),
      name: FontRef.optional().describe("Your name at the top"),
    })
    .optional(),
  colors: z
    .strictObject({
      text: Color.optional(),
      muted: Color.optional(),
      accent: Color.optional(),
      sidebarBackground: Color.optional().describe("Fill behind the sidebar (sidebar layouts)"),
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

export const Format = z.strictObject({
  date: z.enum(["MMM YYYY", "MMMM YYYY", "MM/YYYY", "YYYY"]).optional(),
});

/**
 * Page regions. `single`: one column. `sidebar`: a header, then a main
 * column and a sidebar; the theme says which section ids go in the sidebar,
 * everything else goes in the main column, each in CV order. Section ids
 * default to the section type; the summary is `summary`.
 */
export const Layout = z.strictObject({
  type: z.enum(["single", "sidebar"]).optional().describe("Default single"),
  side: z.enum(["left", "right"]).optional().describe("Sidebar side (default left)"),
  width: z.union([Percent, Length]).optional().describe("Sidebar width (default 32%)"),
  gap: Length.optional().describe("Space between the columns (default 8mm)"),
  header: z
    .enum(["full", "main"])
    .optional()
    .describe("Header across the page (full, default) or only above the main column"),
  sidebar: z.array(z.string().min(1)).optional().describe("Section ids placed in the sidebar"),
});

export const Photo = z.strictObject({
  show: z.boolean().optional().describe("Default true when the CV has basics.photo"),
  position: z
    .enum(["header-right", "header-left", "sidebar"])
    .optional()
    .describe("Default header-right (sidebar layouts: sidebar)"),
  size: Length.optional().describe("Width and height (default 28mm)"),
  shape: z.enum(["square", "rounded", "circle"]).optional().describe("Default circle"),
});

export const Theme = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1).optional(),
  name: z.string().optional(),
  extends: z
    .string()
    .optional()
    .describe("Theme to build on: a built-in (default, sidebar) or a file like ./base.yaml"),
  page: Page.optional(),
  layout: Layout.optional(),
  photo: Photo.optional(),
  tokens: Tokens.optional(),
  format: Format.optional(),
});
export type Theme = z.output<typeof Theme>;
export type ThemeInput = z.input<typeof Theme>;
