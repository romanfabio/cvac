import type { Diagnostic, Severity } from "../diagnostics.ts";
import { type FontSet, selectFace } from "../fonts.ts";
import { labelsFor } from "../i18n/labels.ts";
import type { Content } from "../model/content.ts";
import type { LintRuleId } from "../model/lint.ts";
import type { Theme } from "../model/theme.ts";
import type { ResolvedContent } from "../resolve/locale.ts";
import type { ResolvedTheme } from "../theme/resolve.ts";
import { missingGlyphs } from "./glyphs.ts";

export interface LintContext {
  /** As parsed (paths match the YAML). */
  content: Content;
  /** Same structure with one language picked. */
  resolved: ResolvedContent;
  /** The language picked (labels and suggestions follow it). */
  locale: string;
  /** The user's theme as written (to know what was set explicitly). */
  theme: Theme | undefined;
  resolvedTheme: ResolvedTheme;
  fonts: FontSet | undefined;
  /** PDF page count, when the caller built one. */
  pages: number | undefined;
  /** Files the CV refers to (the photo), when the caller has them. */
  assets: Readonly<Record<string, Uint8Array>> | undefined;
}

export type Finding = Omit<Diagnostic, "severity" | "code">;

export interface Rule {
  id: LintRuleId;
  level: Severity;
  /** One line: why this matters (shown by `cvac lint --list`). */
  summary: string;
  check(ctx: LintContext): Finding[];
}

type Path = (string | number)[];

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

/**
 * Headings ATS parsers recognize, per section type, in every built-in
 * language (en, it, de, es, fr, nl, pt). Matching is case-insensitive and
 * ignores punctuation, so "Work Experience:" is fine.
 */
const STANDARD_HEADINGS: Record<string, string[]> = {
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "relevant experience",
    "employment",
    "employment history",
    "work history",
    "career history",
    "esperienza",
    "esperienze",
    "esperienza professionale",
    "esperienze professionali",
    "esperienza lavorativa",
    "esperienze lavorative",
    "berufserfahrung",
    "berufliche erfahrung",
    "berufspraxis",
    "beruflicher werdegang",
    "experiencia",
    "experiencia profesional",
    "experiencia laboral",
    "expérience",
    "expériences",
    "expérience professionnelle",
    "expériences professionnelles",
    "parcours professionnel",
    "werkervaring",
    "ervaring",
    "professionele ervaring",
    "experiência",
    "experiência profissional",
  ],
  education: [
    "education",
    "education and training",
    "academic background",
    "academic history",
    "istruzione",
    "formazione",
    "istruzione e formazione",
    "titoli di studio",
    "ausbildung",
    "bildung",
    "bildungsweg",
    "studium",
    "ausbildung und studium",
    "formación",
    "formación académica",
    "educación",
    "estudios",
    "formation",
    "formations",
    "études",
    "diplômes",
    "formation et diplômes",
    "opleiding",
    "opleidingen",
    "onderwijs",
    "formação",
    "formação académica",
    "formação acadêmica",
    "educação",
  ],
  skills: [
    "skills",
    "technical skills",
    "key skills",
    "core skills",
    "competencies",
    "core competencies",
    "skills and competencies",
    "competenze",
    "competenze tecniche",
    "abilità",
    "capacità e competenze",
    "kenntnisse",
    "fähigkeiten",
    "kompetenzen",
    "fachkenntnisse",
    "it-kenntnisse",
    "competencias",
    "habilidades",
    "aptitudes",
    "conocimientos",
    "compétences",
    "compétences techniques",
    "savoir-faire",
    "vaardigheden",
    "competenties",
    "kennis",
    "competências",
    "competências técnicas",
  ],
  languages: [
    "languages",
    "language skills",
    "lingue",
    "lingue straniere",
    "competenze linguistiche",
    "sprachen",
    "sprachkenntnisse",
    "idiomas",
    "langues",
    "compétences linguistiques",
    "talen",
    "talenkennis",
    "línguas",
  ],
  projects: [
    "projects",
    "key projects",
    "personal projects",
    "side projects",
    "progetti",
    "progetti personali",
    "projekte",
    "proyectos",
    "projets",
    "projecten",
    "projetos",
    "projectos",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses and certifications",
    "licences and certifications",
    "certificazioni",
    "certificati",
    "certificazioni e licenze",
    "zertifizierungen",
    "zertifikate",
    "certificaciones",
    "certificados",
    "certifications",
    "certificats",
    "certificaten",
    "certificeringen",
    "certificações",
  ],
};

const normHeading = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const nonstandardHeading: Rule = {
  id: "nonstandard-heading",
  level: "warning",
  summary:
    "ATS parsers find sections by their heading; creative titles can make a section invisible.",
  check({ resolved, locale }) {
    const out: Finding[] = [];
    const labels = labelsFor(locale);
    resolved.sections.forEach((s, i) => {
      if (s.type === "custom" || s.title === undefined) return;
      const known = (STANDARD_HEADINGS[s.type] ?? []).map(normHeading);
      if (known.includes(normHeading(s.title))) return;
      // Suggest the default heading in the language being checked.
      const suggestion = labels.sections[s.type as keyof typeof labels.sections] ?? s.type;
      out.push({
        message: `Heading '${s.title}' is not a standard ${s.type} heading`,
        help: `Use a heading parsers recognize, e.g. '${suggestion}', or remove 'title' to get the default`,
        path: ["sections", i, "title"],
        origin: "content",
      });
    });
    return out;
  },
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const missingDates: Rule = {
  id: "missing-dates",
  level: "warning",
  summary: "ATS compute years of experience from dates; entries without dates may count as zero.",
  check({ content }) {
    const out: Finding[] = [];
    content.sections.forEach((s, i) => {
      if (s.type === "experience") {
        s.items.forEach((it, j) => {
          if (!it.start) {
            out.push({
              message: "Experience entry has no start date",
              help: "Add 'start' (e.g. 2021-03), and 'end' or 'end: present'",
              path: ["sections", i, "items", j],
              origin: "content",
            });
          }
        });
      }
      if (s.type === "education") {
        s.items.forEach((it, j) => {
          if (!it.start && !it.end) {
            out.push({
              message: "Education entry has no dates",
              help: "Add at least 'end' (the graduation date)",
              path: ["sections", i, "items", j],
              origin: "content",
            });
          }
        });
      }
    });
    return out;
  },
};

const dateOrder: Rule = {
  id: "date-order",
  level: "error",
  summary:
    "An end date before the start date is a typo that parsers and readers will both trip on.",
  check({ content }) {
    const out: Finding[] = [];
    content.sections.forEach((s, i) => {
      s.items.forEach((it, j) => {
        const start = "start" in it ? it.start : undefined;
        const end = "end" in it ? it.end : undefined;
        if (!start || !end || end === "present") return;
        // Compare at the common precision: 2021 vs 2021-03 is fine.
        const n = Math.min(start.length, end.length);
        if (end.slice(0, n) < start.slice(0, n)) {
          out.push({
            message: `End date ${end} is before start date ${start}`,
            help: "Swap the dates or fix the typo",
            path: ["sections", i, "items", j, "end"],
            origin: "content",
          });
        }
      });
    });
    return out;
  },
};

// ---------------------------------------------------------------------------
// Contact and key fields
// ---------------------------------------------------------------------------

const missingEmail: Rule = {
  id: "missing-email",
  level: "warning",
  summary: "Email is the field every ATS extracts first, and recruiters use it to reply.",
  check: ({ content }) =>
    content.basics.email
      ? []
      : [
          {
            message: "No email address",
            help: "Add basics.email",
            path: ["basics"],
            origin: "content",
          },
        ],
};

const missingPhone: Rule = {
  id: "missing-phone",
  level: "info",
  summary: "Most ATS have a phone field; recruiters often call first.",
  check: ({ content }) =>
    content.basics.phone
      ? []
      : [
          {
            message: "No phone number",
            help: "Add basics.phone (quoted, with country code)",
            path: ["basics"],
            origin: "content",
          },
        ],
};

const missingHeadline: Rule = {
  id: "missing-headline",
  level: "info",
  summary: "A headline with your target job title helps ATS keyword matching.",
  check: ({ content }) =>
    content.basics.title
      ? []
      : [
          {
            message: "No headline",
            help: "Add basics.title, e.g. 'Senior Backend Engineer'",
            path: ["basics"],
            origin: "content",
          },
        ],
};

const noSkills: Rule = {
  id: "no-skills",
  level: "info",
  summary: "ATS rank candidates by keyword matches; a skills section is where those keywords live.",
  check: ({ content }) =>
    content.sections.some((s) => s.type === "skills" && s.items.length > 0)
      ? []
      : [
          {
            message: "No skills section",
            help: "Add a 'type: skills' section with the technologies and tools you use",
            path: ["sections"],
            origin: "content",
          },
        ],
};

const emptySection: Rule = {
  id: "empty-section",
  level: "warning",
  summary: "Sections without items are left out of the output, which is easy to miss.",
  check: ({ content }) =>
    content.sections.flatMap((s, i) =>
      s.items.length
        ? []
        : [
            {
              message: `The ${s.type} section has no items and will not appear`,
              help: "Add items or remove the section",
              path: ["sections", i],
              origin: "content",
            } satisfies Finding,
          ],
    ),
};

const photo: Rule = {
  id: "photo",
  level: "warning",
  summary:
    "Many ATS drop images, and in some countries (US, UK) photos are discouraged to avoid bias.",
  check: ({ content }) =>
    content.basics.photo
      ? [
          {
            message: "CV includes a photo",
            help: "Keep it only where photos are expected (e.g. parts of Europe); otherwise remove basics.photo or set meta.lint.photo: off",
            path: ["basics", "photo"],
            origin: "content",
          },
        ]
      : [],
};

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** Rendered text fields, with their paths (skips ids, tags, dates, meta). */
function* texts(node: unknown, path: Path): Generator<[string, Path]> {
  if (typeof node === "string") {
    yield [node, path];
    return;
  }
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) yield* texts(v, [...path, i]);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (["type", "id", "tags", "start", "end", "date", "photo", "$schema", "version"].includes(k))
        continue;
      if (path.length === 0 && k === "meta") continue;
      yield* texts(v, [...path, k]);
    }
  }
}

const PICTOGRAPH = /\p{Extended_Pictographic}/u;

const emoji: Rule = {
  id: "emoji",
  level: "warning",
  summary: "Emoji and pictographs are often stripped or garbled by ATS parsers.",
  check({ resolved }) {
    const out: Finding[] = [];
    for (const [text, path] of texts(resolved, [])) {
      const found = [...new Set([...text].filter((ch) => PICTOGRAPH.test(ch)))];
      if (found.length) {
        out.push({
          message: `Text contains ${found.join(" ")}`,
          help: "Use words instead (e.g. 'Email:' rather than an envelope icon)",
          path,
          origin: "content",
        });
      }
    }
    return out;
  },
};

const missingGlyphsRule: Rule = {
  id: "missing-glyphs",
  level: "error",
  summary: "Characters the font cannot draw come out as empty boxes, and may not be extractable.",
  check({ resolved, resolvedTheme, fonts }) {
    if (!fonts) return [];
    const families = [...new Set(Object.values(resolvedTheme.fonts).map((f) => f.family))];
    const faces = families.flatMap((family) => {
      const f = selectFace(fonts, { family, weight: 400, italic: false });
      return f ? [f] : [];
    });
    const out: Finding[] = [];
    for (const [text, path] of texts(resolved, [])) {
      const missing = [...new Set(faces.flatMap((f) => missingGlyphs(f, text)))].filter(
        (ch) => !PICTOGRAPH.test(ch),
      );
      if (missing.length) {
        out.push({
          message: `The font ${families.join("/")} has no glyph for ${missing.map(describeChar).join(", ")}`,
          help: "Replace these characters, or choose a theme font that supports them",
          path,
          origin: "content",
        });
      }
    }
    return out;
  },
};

function describeChar(ch: string): string {
  return `'${ch}' (U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")})`;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const MIN_BODY_PT = 9;

const smallFont: Rule = {
  id: "small-font",
  level: "warning",
  summary: "Text below 9pt is hard to read on paper and for OCR-based parsers.",
  check({ theme, resolvedTheme }) {
    const out: Finding[] = [];
    for (const role of ["body", "heading"] as const) {
      const size = resolvedTheme.fonts[role].size;
      if (size < MIN_BODY_PT && theme?.tokens?.fonts?.[role]?.size !== undefined) {
        out.push({
          message: `${cap(role)} text is ${size}pt`,
          help: `Use at least ${MIN_BODY_PT}pt (10-11pt is typical)`,
          path: ["tokens", "fonts", role, "size"],
          origin: "theme",
        });
      }
    }
    return out;
  },
};

const lowContrast: Rule = {
  id: "low-contrast",
  level: "warning",
  summary: "Light text on white is hard to read, prints poorly and can confuse OCR.",
  check({ theme, resolvedTheme }) {
    const out: Finding[] = [];
    const min = { text: 4.5, muted: 4.5, accent: 3 } as const;
    const userSet = (key: string) =>
      (theme?.tokens?.colors as Record<string, string | undefined> | undefined)?.[key] !==
      undefined;
    const bg = resolvedTheme.colors.sidebarBackground;
    for (const role of ["text", "muted", "accent"] as const) {
      const color = resolvedTheme.colors[role];
      const onWhite = contrast(color, "#ffffff");
      if (userSet(role) && onWhite < min[role]) {
        out.push({
          message: `Color ${color} has a contrast of ${onWhite.toFixed(1)}:1 on white`,
          help: `Use a darker color (at least ${min[role]}:1)`,
          path: ["tokens", "colors", role],
          origin: "theme",
        });
        continue;
      }
      // Sidebar text sits on the sidebar background.
      const onBg = bg ? contrast(color, bg) : Number.POSITIVE_INFINITY;
      if (bg && onBg < min[role] && (userSet(role) || userSet("sidebarBackground"))) {
        out.push({
          message: `Color ${color} has a contrast of ${onBg.toFixed(1)}:1 on the sidebar background ${bg}`,
          help: `Use a lighter sidebar background or a darker ${role} color (at least ${min[role]}:1)`,
          path: ["tokens", "colors", userSet("sidebarBackground") ? "sidebarBackground" : role],
          origin: "theme",
        });
      }
    }
    return out;
  },
};

const multiColumn: Rule = {
  id: "multi-column",
  level: "warning",
  summary: "Some ATS read multi-column PDFs line by line across columns, mixing sections.",
  check: ({ theme, resolvedTheme }) =>
    resolvedTheme.layout.type === "sidebar"
      ? [
          {
            message: "The PDF uses a sidebar layout",
            help: "Upload the DOCX to ATS portals (always one column), or use a single-column theme for ATS submissions",
            // Point at what turned the sidebar on: the layout, or the base theme.
            ...(theme?.layout ? { path: ["layout"] } : theme?.extends ? { path: ["extends"] } : {}),
            origin: "theme",
          },
        ]
      : [],
};

const MIN_MARGIN_PT = 34; // 12mm

const narrowMargins: Rule = {
  id: "narrow-margins",
  level: "info",
  summary: "Very narrow margins risk clipping when printed and look crowded.",
  check({ theme, resolvedTheme }) {
    if (theme?.page?.margins === undefined) return [];
    const m = resolvedTheme.page.margins;
    const smallest = Math.min(m.top, m.right, m.bottom, m.left);
    return smallest < MIN_MARGIN_PT
      ? [
          {
            message: `Margins as small as ${(smallest / (72 / 25.4)).toFixed(0)}mm`,
            help: "Use at least 12mm (15-20mm is typical)",
            path: ["page", "margins"],
            origin: "theme",
          },
        ]
      : [];
  },
};

const tooLong: Rule = {
  id: "too-long",
  level: "info",
  summary: "Recruiters skim; one or two pages is the norm outside academia.",
  check: ({ pages }) =>
    pages !== undefined && pages > 2
      ? [
          {
            message: `The PDF has ${pages} pages`,
            help: "Aim for 1-2 pages: trim older or less relevant entries",
          },
        ]
      : [],
};

/** Above this the photo, embedded as is in both formats, dominates the file size. */
const LARGE_PHOTO_BYTES = 1_000_000;

const largePhoto: Rule = {
  id: "large-photo",
  level: "warning",
  summary:
    "The photo is embedded as is: a large one makes both files large, and job portals often cap uploads at 2-5 MB.",
  check: ({ content, assets }) => {
    const path = content.basics.photo;
    const data = path ? assets?.[path] : undefined;
    if (!data || data.length <= LARGE_PHOTO_BYTES) return [];
    return [
      {
        message: `The photo is ${(data.length / 1_000_000).toFixed(1)} MB, and the PDF and DOCX each grow by that much`,
        help: "Resize it to about 600 x 600 pixels and save it as JPEG; that is usually under 200 KB",
        path: ["basics", "photo"],
        origin: "content",
      },
    ];
  },
};

export const RULES: readonly Rule[] = [
  nonstandardHeading,
  missingDates,
  dateOrder,
  missingEmail,
  missingPhone,
  missingHeadline,
  noSkills,
  emptySection,
  photo,
  largePhoto,
  emoji,
  missingGlyphsRule,
  smallFont,
  lowContrast,
  narrowMargins,
  tooLong,
  multiColumn,
];

// ---------------------------------------------------------------------------

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** WCAG 2 contrast ratio between two #rgb/#rrggbb colors. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
