import type { Diagnostic } from "../diagnostics.ts";
import { isLocalized, type Localized } from "../model/common.ts";
import type { Content } from "../model/content.ts";

/** `T` with every localized value replaced by the chosen string. */
export type Resolved<T> = T extends Localized
  ? string
  : T extends readonly (infer U)[]
    ? Resolved<U>[]
    : T extends object
      ? { [K in keyof T]: Resolved<T[K]> }
      : T;

export type ResolvedContent = Resolved<Content>;

export interface LocaleResolution {
  content: ResolvedContent;
  locale: string;
  diagnostics: Diagnostic[];
}

/**
 * Pick one language for every localized value.
 * Fallback order: requested locale, its base language, `meta.defaultLocale`,
 * then the first language written. Missing translations produce warnings.
 * All text is NFC-normalized so equivalent input yields identical output.
 */
export function resolveLocale(content: Content, requested?: string): LocaleResolution {
  const locale = requested ?? content.meta?.defaultLocale ?? content.meta?.locales?.[0] ?? "en";
  const base = locale.split("-")[0];
  const fallback = content.meta?.defaultLocale;
  const diagnostics: Diagnostic[] = [];

  // A language the CV does not claim to be written in: one warning instead
  // of one per field.
  const declared = content.meta?.locales;
  const undeclared =
    requested !== undefined &&
    declared !== undefined &&
    !declared.includes(locale) &&
    !(base !== undefined && declared.includes(base));
  if (undeclared) {
    diagnostics.push({
      code: "undeclared-locale",
      severity: "warning",
      message: `'${locale}' is not one of this CV's languages (${declared.join(", ")}); texts fall back to ${fallback ? `'${fallback}'` : "the first language written"}`,
      path: ["meta", "locales"],
      origin: "content",
    });
  }

  const pick = (v: Localized, path: (string | number)[]): string => {
    const m = v.$l10n;
    const hit = m[locale] ?? (base !== undefined ? m[base] : undefined);
    if (hit !== undefined) return hit;
    if (!undeclared)
      diagnostics.push({
        code: "missing-translation",
        severity: "warning",
        message: `No '${locale}' text, using ${fallback && m[fallback] !== undefined ? `'${fallback}'` : "the first available language"}`,
        path,
        origin: "content",
      });
    return (fallback !== undefined ? m[fallback] : undefined) ?? Object.values(m)[0] ?? "";
  };

  const walk = (node: unknown, path: (string | number)[]): unknown => {
    if (typeof node === "string") return node.normalize("NFC");
    if (isLocalized(node)) return pick(node, path).normalize("NFC");
    if (Array.isArray(node)) return node.map((v, i) => walk(v, [...path, i]));
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, [...path, k]);
      return out;
    }
    return node;
  };

  return { content: walk(content, []) as ResolvedContent, locale, diagnostics };
}
