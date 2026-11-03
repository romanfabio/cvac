import type { Diagnostic } from "../diagnostics.ts";
import type { DateStyle } from "../i18n/dates.ts";
import type { Length, Theme } from "../model/theme.ts";

/** Fully concrete theme: every value present, every length in points. */
export interface ResolvedTheme {
  name: string;
  page: {
    width: number;
    height: number;
    margins: { top: number; right: number; bottom: number; left: number };
  };
  fonts: Record<"body" | "heading" | "name", FontSpec>;
  colors: { text: string; muted: string; accent: string };
  spacing: { section: number; item: number; line: number };
  format: { date: DateStyle };
}

export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
}

export const DEFAULT_FONT_FAMILY = "Source Sans 3";

/**
 * The built-in, ATS-safe default theme: single column, one bundled font,
 * restrained color. Every user theme is layered on top of it.
 */
export const defaultTheme = {
  name: "default",
  page: { size: "A4", margins: "18mm" },
  tokens: {
    fonts: {
      body: { family: DEFAULT_FONT_FAMILY, size: "10pt", weight: "regular" },
      heading: { family: DEFAULT_FONT_FAMILY, size: "11.5pt", weight: "bold" },
      name: { family: DEFAULT_FONT_FAMILY, size: "22pt", weight: "bold" },
    },
    colors: { text: "#1a1a1a", muted: "#555555", accent: "#1f4e79" },
    spacing: { section: "12pt", item: "7pt", line: 1.25 },
  },
  format: { date: "MMM YYYY" },
} as const satisfies Theme;

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] } as const;
const UNIT_PT = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 } as const;

/** Length to points, rounded to 1/100 pt so float noise never reaches output. */
export function toPoints(len: Length): number {
  if (typeof len === "number") return round(len);
  const m = /^(\d+(?:\.\d+)?)(pt|mm|cm|in)$/.exec(len);
  if (!m) throw new Error(`Invalid length: ${len}`);
  return round(Number(m[1]) * UNIT_PT[m[2] as keyof typeof UNIT_PT]);
}

const round = (n: number) => Math.round(n * 100) / 100;

function weightOf(w: "regular" | "bold" | number | undefined, fallback: number): number {
  if (w === undefined) return fallback;
  if (w === "regular") return 400;
  if (w === "bold") return 700;
  return w;
}

type FontRefInput = {
  family?: string | undefined;
  size?: Length | undefined;
  weight?: "regular" | "bold" | number | undefined;
  italic?: boolean | undefined;
};

function font(user: FontRefInput | undefined, base: FontRefInput): FontSpec {
  return {
    family: user?.family ?? base.family ?? DEFAULT_FONT_FAMILY,
    size: toPoints(user?.size ?? base.size ?? 10),
    weight: weightOf(user?.weight, weightOf(base.weight, 400)),
    italic: user?.italic ?? base.italic ?? false,
  };
}

/** Layer a user theme over the default theme. */
export function resolveTheme(theme?: Theme): { theme: ResolvedTheme; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (theme?.extends && theme.extends !== "default") {
    diagnostics.push({
      code: "unknown-theme",
      severity: "error",
      message: `Unknown base theme '${theme.extends}'. Available: default`,
      path: ["extends"],
    });
  }
  const d = defaultTheme;
  const t = theme?.tokens;
  const size = theme?.page?.size ?? d.page.size;
  const [width, height] = PAGE_SIZES[size];
  const m = theme?.page?.margins ?? d.page.margins;
  const margins =
    typeof m === "object"
      ? {
          top: toPoints(m.top),
          right: toPoints(m.right),
          bottom: toPoints(m.bottom),
          left: toPoints(m.left),
        }
      : { top: toPoints(m), right: toPoints(m), bottom: toPoints(m), left: toPoints(m) };

  return {
    diagnostics,
    theme: {
      name: theme?.name ?? d.name,
      page: { width, height, margins },
      fonts: {
        body: font(t?.fonts?.body, d.tokens.fonts.body),
        heading: font(t?.fonts?.heading, d.tokens.fonts.heading),
        name: font(t?.fonts?.name, d.tokens.fonts.name),
      },
      colors: {
        text: t?.colors?.text ?? d.tokens.colors.text,
        muted: t?.colors?.muted ?? d.tokens.colors.muted,
        accent: t?.colors?.accent ?? d.tokens.colors.accent,
      },
      spacing: {
        section: toPoints(t?.spacing?.section ?? d.tokens.spacing.section),
        item: toPoints(t?.spacing?.item ?? d.tokens.spacing.item),
        line: t?.spacing?.line ?? d.tokens.spacing.line,
      },
      format: { date: theme?.format?.date ?? d.format.date },
    },
  };
}
