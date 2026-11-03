import type { EndDate, PartialDate } from "../model/common.ts";
import type { Labels } from "./labels.ts";

/**
 * Date display styles:
 * - `MMM YYYY`  -> "Mar 2021"
 * - `MMMM YYYY` -> "March 2021"
 * - `MM/YYYY`   -> "03/2021"
 * - `YYYY`      -> "2021"
 * Dates with lower precision than the style just print what they have.
 */
export type DateStyle = "MMM YYYY" | "MMMM YYYY" | "MM/YYYY" | "YYYY";

export function formatDate(date: PartialDate, style: DateStyle, labels: Labels): string {
  const [year, month] = date.split("-");
  const m = month ? Number(month) : undefined;
  if (!m || style === "YYYY") return year ?? date;
  switch (style) {
    case "MMM YYYY":
      return `${labels.monthsShort[m - 1]} ${year}`;
    case "MMMM YYYY":
      return `${labels.monthsLong[m - 1]} ${year}`;
    case "MM/YYYY":
      return `${month}/${year}`;
  }
}

/** "Mar 2021 – Present", "2016 – Feb 2021", or a single date. */
export function formatRange(
  start: PartialDate | undefined,
  end: EndDate | undefined,
  style: DateStyle,
  labels: Labels,
): string | undefined {
  const s = start ? formatDate(start, style, labels) : undefined;
  const e = end === "present" ? labels.present : end ? formatDate(end, style, labels) : undefined;
  if (s && e) return s === e ? s : `${s} – ${e}`;
  return s ?? e;
}
