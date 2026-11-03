import type { Diagnostic } from "../diagnostics.ts";
import type { FontSet } from "../fonts.ts";
import type { Content } from "../model/content.ts";
import { LINT_RULE_IDS, type LintRuleId } from "../model/lint.ts";
import type { Theme } from "../model/theme.ts";
import { resolveLocale } from "../resolve/locale.ts";
import { resolveTheme } from "../theme/resolve.ts";
import { RULES, type Rule } from "./rules.ts";

export { contrast } from "./rules.ts";

export interface LintOptions {
  theme?: Theme;
  /** Language to check (text-based rules look at that language's text). */
  locale?: string;
  /** Enables the glyph-coverage rule. */
  fonts?: FontSet;
  /** PDF page count, if known (enables the length rule). */
  pages?: number;
}

export interface RuleInfo {
  id: LintRuleId;
  level: Rule["level"];
  summary: string;
}

/** All rules with their default levels, for docs and `cvac lint --list`. */
export function lintRules(): RuleInfo[] {
  return RULES.map(({ id, level, summary }) => ({ id, level, summary }));
}

/**
 * ATS and readability checks on top of schema validation. Levels come from
 * each rule's default, overridden by `meta.lint` in the CV. Diagnostics use
 * the code `lint/<rule>`.
 */
export function lint(content: Content, opts: LintOptions = {}): Diagnostic[] {
  const config = content.meta?.lint ?? {};
  const ctx = {
    content,
    resolved: resolveLocale(content, opts.locale).content,
    theme: opts.theme,
    resolvedTheme: resolveTheme(opts.theme).theme,
    fonts: opts.fonts,
    pages: opts.pages,
  };
  const out: Diagnostic[] = [];
  for (const rule of RULES) {
    const level = config[rule.id] ?? rule.level;
    if (level === "off") continue;
    for (const f of rule.check(ctx)) out.push({ ...f, code: `lint/${rule.id}`, severity: level });
  }
  return out;
}

// Keep the rule list and the schema's id list in sync (checked at load).
for (const id of LINT_RULE_IDS) {
  if (!RULES.some((r) => r.id === id)) throw new Error(`lint rule '${id}' has no implementation`);
}
