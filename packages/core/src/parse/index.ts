import type { Diagnostic } from "../diagnostics.ts";
import { isLocalized } from "../model/common.ts";
import { type Content, Content as ContentSchema, SECTION_TYPES } from "../model/content.ts";
import { type Theme, Theme as ThemeSchema } from "../model/theme.ts";
import { type ParseOptions, type ParseResult, parseYamlWith, type SourceDoc } from "./yaml.ts";

export type { ParseOptions, ParseResult } from "./yaml.ts";

/** Parse and validate a CV content file (`cv.yaml`). */
export function parseContent(source: string, opts: ParseOptions = {}): ParseResult<Content> {
  const { result, src } = parseYamlWith(ContentSchema, source, opts);
  improveDiscriminatorMessages(result.diagnostics);
  if (!result.value) return result;

  const semantic = checkContent(result.value, src);
  result.diagnostics.push(...semantic);
  if (semantic.some((d) => d.severity === "error")) {
    return { diagnostics: result.diagnostics };
  }
  return result;
}

/** Parse and validate a theme file (`theme.yaml`). */
export function parseTheme(source: string, opts: ParseOptions = {}): ParseResult<Theme> {
  return parseYamlWith(ThemeSchema, source, opts).result;
}

function improveDiscriminatorMessages(diagnostics: Diagnostic[]): void {
  for (const d of diagnostics) {
    if (d.code === "invalid-discriminator" && d.path?.[0] === "sections") {
      d.code = "unknown-section-type";
      d.message = `${d.message}. Valid section types: ${SECTION_TYPES.join(", ")}`;
    }
  }
}

/** Rules that the schema alone cannot express (the "minimum opinions"). */
function checkContent(content: Content, src: SourceDoc): Diagnostic[] {
  const out: Diagnostic[] = [];
  const b = content.basics;

  if (!b.email && !b.phone && !b.url && !(b.profiles && b.profiles.length > 0)) {
    out.push(
      src.diag(
        {
          code: "missing-contact",
          severity: "error",
          message: "basics needs at least one way to contact you: email, phone, url or profiles",
          path: ["basics"],
        },
        { key: true },
      ),
    );
  }

  const seen = new Map<string, number>();
  content.sections.forEach((s, i) => {
    const id = s.id ?? s.type;
    const prev = seen.get(id);
    if (prev !== undefined) {
      out.push(
        src.diag({
          code: "duplicate-section-id",
          severity: "error",
          message: `Section id '${id}' is already used by sections[${prev}]. Give one of them a distinct 'id'.`,
          path: s.id ? ["sections", i, "id"] : ["sections", i, "type"],
        }),
      );
    } else {
      seen.set(id, i);
    }
  });

  const declared = content.meta?.locales;
  if (declared) {
    const defaultLocale = content.meta?.defaultLocale;
    if (defaultLocale && !declared.includes(defaultLocale)) {
      out.push(
        src.diag({
          code: "unknown-locale",
          severity: "error",
          message: `defaultLocale '${defaultLocale}' is not listed in meta.locales (${declared.join(", ")})`,
          path: ["meta", "defaultLocale"],
        }),
      );
    }
    walkLocalized(content, [], (locale, path) => {
      if (!declared.includes(locale)) {
        out.push(
          src.diag(
            {
              code: "unknown-locale",
              severity: "warning",
              message: `Locale '${locale}' is not listed in meta.locales (${declared.join(", ")})`,
              path,
            },
            { key: true },
          ),
        );
      }
    });
  }

  return out;
}

/** Visit the locale keys of every localized value in parsed content. */
function walkLocalized(
  node: unknown,
  path: (string | number)[],
  visit: (locale: string, path: (string | number)[]) => void,
): void {
  if (isLocalized(node)) {
    for (const k of Object.keys(node.$l10n)) visit(k, [...path, k]);
    return;
  }
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) walkLocalized(v, [...path, i], visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) walkLocalized(v, [...path, k], visit);
}
