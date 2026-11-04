/**
 * Lightweight entry for editors (`@cvac/core/editor`): starter files,
 * JSON Schemas and diagnostic types, without the renderers (pdfkit, docx,
 * fontkit). Lets an editor's main thread stay small while builds run in a
 * worker that imports the full `@cvac/core`.
 */
export type { Diagnostic, Position, Range, Severity } from "./diagnostics.ts";
export { BUILTIN_THEME_NAMES } from "./model/theme.ts";
export { contentJsonSchema, themeJsonSchema } from "./schema.ts";
export { STARTER_CV, STARTER_THEME } from "./templates.ts";
