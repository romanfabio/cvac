import { z } from "zod";

/** BCP 47-ish locale code, e.g. `en`, `it`, `en-GB`. */
export const LocaleCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Expected a locale code like 'en' or 'en-GB'");

/**
 * Text that is either a plain string (same in every language) or a map of
 * locale -> string, e.g. `{ en: "Software Engineer", it: "Ingegnere del Software" }`.
 */
export const LocalizedText = z.union([
  z.string(),
  z.record(LocaleCode, z.string()).refine((m) => Object.keys(m).length > 0, {
    message: "Localized text needs at least one language",
  }),
]);
export type LocalizedText = z.infer<typeof LocalizedText>;

/**
 * Partial ISO date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
 * A bare year is accepted as a YAML number too (`start: 2021`).
 */
const DATE_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
export const PartialDate = z
  .union([z.string(), z.number().int()])
  .transform((v) => String(v))
  .pipe(z.string().regex(DATE_RE, "Expected a date like 2021, 2021-03 or 2021-03-15"));
export type PartialDate = z.output<typeof PartialDate>;

/** End date: a partial date or `present` for ongoing entries. */
export const EndDate = z.union([z.literal("present"), PartialDate]);
export type EndDate = z.output<typeof EndDate>;

/** Tags used to select CV variants (`cvac build --variant backend`). */
export const Tags = z.array(z.string().min(1)).describe("Variant tags, e.g. [backend, lead]");

export const Url = z.url();
