/**
 * Built-in localized strings. Kept as static tables (no `Intl`) so output
 * never depends on the ICU data of the host platform: determinism first.
 */

export interface Labels {
  sections: Record<
    "summary" | "experience" | "education" | "skills" | "languages" | "projects" | "certifications",
    string
  >;
  present: string;
  /** Abbreviated month names, January first. */
  monthsShort: readonly string[];
  monthsLong: readonly string[];
  cv: string;
}

const en: Labels = {
  sections: {
    summary: "Summary",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
    projects: "Projects",
    certifications: "Certifications",
  },
  present: "Present",
  monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  monthsLong: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  cv: "CV",
};

const it: Labels = {
  sections: {
    summary: "Profilo",
    experience: "Esperienza",
    education: "Istruzione",
    skills: "Competenze",
    languages: "Lingue",
    projects: "Progetti",
    certifications: "Certificazioni",
  },
  present: "Presente",
  monthsShort: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  monthsLong: [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ],
  cv: "CV",
};

const TABLES: Record<string, Labels> = { en, it };

export const BUILTIN_LOCALES = Object.keys(TABLES);

/** Labels for a locale: exact, then base language (`en-GB` -> `en`), then English. */
export function labelsFor(locale: string): Labels {
  return TABLES[locale] ?? TABLES[locale.split("-")[0] ?? ""] ?? en;
}
