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

// Month abbreviations follow each language's usual written form, with a
// period where the language uses one ("janv.", "Okt."); short names are
// written out ("mai", "Juni").

const de: Labels = {
  sections: {
    summary: "Profil",
    experience: "Berufserfahrung",
    education: "Ausbildung",
    skills: "Kenntnisse",
    languages: "Sprachen",
    projects: "Projekte",
    certifications: "Zertifizierungen",
  },
  present: "heute",
  monthsShort: [
    "Jan.",
    "Feb.",
    "März",
    "Apr.",
    "Mai",
    "Juni",
    "Juli",
    "Aug.",
    "Sept.",
    "Okt.",
    "Nov.",
    "Dez.",
  ],
  monthsLong: [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ],
  cv: "Lebenslauf",
};

const es: Labels = {
  sections: {
    summary: "Perfil",
    experience: "Experiencia",
    education: "Formación",
    skills: "Competencias",
    languages: "Idiomas",
    projects: "Proyectos",
    certifications: "Certificaciones",
  },
  present: "Actualidad",
  monthsShort: [
    "ene.",
    "feb.",
    "mar.",
    "abr.",
    "may.",
    "jun.",
    "jul.",
    "ago.",
    "sept.",
    "oct.",
    "nov.",
    "dic.",
  ],
  monthsLong: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  cv: "CV",
};

const fr: Labels = {
  sections: {
    summary: "Profil",
    experience: "Expérience professionnelle",
    education: "Formation",
    skills: "Compétences",
    languages: "Langues",
    projects: "Projets",
    certifications: "Certifications",
  },
  present: "Aujourd'hui",
  monthsShort: [
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
  ],
  monthsLong: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
  cv: "CV",
};

const nl: Labels = {
  sections: {
    summary: "Profiel",
    experience: "Werkervaring",
    education: "Opleiding",
    skills: "Vaardigheden",
    languages: "Talen",
    projects: "Projecten",
    certifications: "Certificaten",
  },
  present: "heden",
  monthsShort: [
    "jan.",
    "feb.",
    "mrt.",
    "apr.",
    "mei",
    "jun.",
    "jul.",
    "aug.",
    "sep.",
    "okt.",
    "nov.",
    "dec.",
  ],
  monthsLong: [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
  ],
  cv: "cv",
};

const pt: Labels = {
  sections: {
    summary: "Perfil",
    experience: "Experiência profissional",
    education: "Formação",
    skills: "Competências",
    languages: "Idiomas",
    projects: "Projetos",
    certifications: "Certificações",
  },
  present: "Atual",
  monthsShort: [
    "jan.",
    "fev.",
    "mar.",
    "abr.",
    "mai.",
    "jun.",
    "jul.",
    "ago.",
    "set.",
    "out.",
    "nov.",
    "dez.",
  ],
  monthsLong: [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ],
  cv: "CV",
};

const TABLES: Record<string, Labels> = { en, it, de, es, fr, nl, pt };

export const BUILTIN_LOCALES = Object.keys(TABLES);

/** Labels for a locale: exact, then base language (`en-GB` -> `en`), then English. */
export function labelsFor(locale: string): Labels {
  return TABLES[locale] ?? TABLES[locale.split("-")[0] ?? ""] ?? en;
}
