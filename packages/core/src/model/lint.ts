import { z } from "zod";

/** Every lint rule id. Kept in the model so `meta.lint` autocompletes. */
export const LINT_RULE_IDS = [
  "nonstandard-heading",
  "missing-dates",
  "date-order",
  "missing-email",
  "missing-phone",
  "missing-headline",
  "no-skills",
  "empty-section",
  "photo",
  "emoji",
  "missing-glyphs",
  "small-font",
  "low-contrast",
  "narrow-margins",
  "too-long",
  "multi-column",
] as const;
export type LintRuleId = (typeof LINT_RULE_IDS)[number];

export const LintLevel = z.enum(["off", "info", "warning", "error"]);
export type LintLevel = z.infer<typeof LintLevel>;

/** `meta.lint` in cv.yaml: per-rule level overrides, e.g. `{ photo: off }`. */
export const LintConfig = z
  // An object with one optional key per rule (rather than a record) so the
  // JSON Schema lists the rule names and editors can autocomplete them.
  .strictObject(
    Object.fromEntries(LINT_RULE_IDS.map((id) => [id, LintLevel.optional()])) as Record<
      LintRuleId,
      z.ZodOptional<typeof LintLevel>
    >,
  )
  .describe(
    "ATS linter rule levels: off, info, warning or error. Run `cvac lint --list` for the rules.",
  );
export type LintConfig = z.infer<typeof LintConfig>;
