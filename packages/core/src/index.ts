export * from "./build.ts";
export * from "./diagnostics.ts";
export * from "./fonts.ts";
export { type DateStyle, formatDate, formatRange } from "./i18n/dates.ts";
export { BUILTIN_LOCALES, type Labels, labelsFor } from "./i18n/labels.ts";
export { type ImageFormat, type ImageInfo, probeImage } from "./images.ts";
export { buildLayout } from "./layout/build.ts";
export type * from "./layout/ir.ts";
export { contrast, type LintOptions, lint, lintRules, type RuleInfo } from "./lint/index.ts";
export * from "./model/common.ts";
export * from "./model/content.ts";
export * from "./model/lint.ts";
export * from "./model/theme.ts";
export * from "./parse/index.ts";
export { type DocxOptions, type DocxResult, renderDocx } from "./render/docx/render.ts";
export {
  DEFAULT_DOCUMENT_DATE,
  type PdfOptions,
  type PdfResult,
  renderPdf,
} from "./render/pdf/render.ts";
export { type DrawItem, type Measurer, type TypesetPage, typeset } from "./render/pdf/typeset.ts";
export { type ResolvedContent, resolveLocale } from "./resolve/locale.ts";
export { resolveVariant, usedTags, type VariantResolution } from "./resolve/variant.ts";
export { contentJsonSchema, themeJsonSchema } from "./schema.ts";
export { STARTER_CV, STARTER_THEME } from "./templates.ts";
export {
  BUILTIN_THEMES,
  DEFAULT_FONT_FAMILY,
  defaultTheme,
  type FontSpec,
  flattenTheme,
  mergeThemes,
  type ResolvedLayout,
  type ResolvedPhoto,
  type ResolvedTheme,
  resolveTheme,
  sidebarTheme,
  toPoints,
} from "./theme/resolve.ts";
