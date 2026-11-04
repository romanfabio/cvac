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
  layout: ResolvedLayout;
  photo: ResolvedPhoto;
  fonts: Record<"body" | "heading" | "name", FontSpec>;
  colors: { text: string; muted: string; accent: string; sidebarBackground?: string };
  spacing: { section: number; item: number; line: number };
  format: { date: DateStyle };
}

export type ResolvedLayout =
  | { type: "single" }
  | {
      type: "sidebar";
      side: "left" | "right";
      /** Sidebar width in points. */
      width: number;
      gap: number;
      header: "full" | "main";
      sidebar: string[];
    };

export interface ResolvedPhoto {
  show: boolean;
  position: "header-right" | "header-left" | "sidebar";
  size: number;
  shape: "square" | "rounded" | "circle";
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
 * restrained color. Every theme is ultimately layered on top of it.
 */
export const defaultTheme = {
  name: "default",
  page: { size: "A4", margins: "18mm" },
  layout: { type: "single" },
  photo: { size: "28mm", shape: "circle" },
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

/**
 * Built-in sidebar theme: skills, languages and certifications in a tinted
 * left column. Note that some ATS read multi-column PDFs poorly; the DOCX
 * output is always single-column.
 */
export const sidebarTheme = {
  name: "sidebar",
  extends: "default",
  page: { margins: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" } },
  layout: {
    type: "sidebar",
    side: "left",
    width: "31%",
    gap: "9mm",
    header: "main",
    sidebar: ["summary", "skills", "languages", "certifications"],
  },
  photo: { position: "sidebar" },
  tokens: { colors: { sidebarBackground: "#eef2f7" } },
} as const satisfies Theme;

export const BUILTIN_THEMES: Readonly<Record<string, Theme>> = {
  default: defaultTheme,
  sidebar: sidebarTheme,
};

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

/**
 * Layer `over` onto `base`: objects merge key by key, everything else
 * (scalars, arrays) is replaced. `extends` is taken from `over`.
 */
export function mergeThemes(base: Theme, over: Theme): Theme {
  return mergeDeep(base, over) as Theme;
}

function mergeDeep(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = mergeDeep(a[k], v);
    return out;
  }
  return b;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Flatten a theme's `extends` chain over built-in themes into one theme.
 * File-based bases (`extends: ./base.yaml`) are resolved by the caller (the
 * CLI reads files; core does not), leaving a built-in name or nothing.
 */
export function flattenTheme(theme: Theme | undefined): {
  theme: Theme;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const chain: Theme[] = [];
  const seen = new Set<string>();
  let current: Theme | undefined = theme;
  while (current) {
    chain.unshift(current);
    const name = current.extends;
    if (name === undefined) break;
    if (seen.has(name)) {
      diagnostics.push({
        code: "theme-cycle",
        severity: "error",
        message: `Theme '${name}' extends itself`,
        path: ["extends"],
        origin: "theme",
      });
      break;
    }
    seen.add(name);
    const base = BUILTIN_THEMES[name];
    if (!base) {
      diagnostics.push({
        code: "unknown-theme",
        severity: "error",
        message: `Unknown base theme '${name}'. Available: ${Object.keys(BUILTIN_THEMES).join(", ")}, or a file like ./base.yaml`,
        path: ["extends"],
        origin: "theme",
      });
      break;
    }
    current = base === defaultTheme ? undefined : base;
  }
  // The default theme is always the bottom layer.
  const merged = chain.reduce<Theme>((acc, t) => mergeThemes(acc, t), defaultTheme);
  return { theme: merged, diagnostics };
}

function weightOf(w: "regular" | "bold" | number | undefined, fallback: number): number {
  if (w === undefined) return fallback;
  if (w === "regular") return 400;
  if (w === "bold") return 700;
  return w;
}

type FontRefInput =
  | {
      family?: string | undefined;
      size?: Length | undefined;
      weight?: "regular" | "bold" | number | undefined;
      italic?: boolean | undefined;
    }
  | undefined;

function font(f: FontRefInput): FontSpec {
  return {
    family: f?.family ?? DEFAULT_FONT_FAMILY,
    size: toPoints(f?.size ?? 10),
    weight: weightOf(f?.weight, 400),
    italic: f?.italic ?? false,
  };
}

/** Resolve a theme (and its base chain) into concrete values. */
export function resolveTheme(theme?: Theme): { theme: ResolvedTheme; diagnostics: Diagnostic[] } {
  const flat = flattenTheme(theme);
  const t = flat.theme;
  const d = defaultTheme;
  const size = t.page?.size ?? d.page.size;
  const [width, height] = PAGE_SIZES[size];
  const m = t.page?.margins ?? d.page.margins;
  const margins =
    typeof m === "object"
      ? {
          top: toPoints(m.top),
          right: toPoints(m.right),
          bottom: toPoints(m.bottom),
          left: toPoints(m.left),
        }
      : { top: toPoints(m), right: toPoints(m), bottom: toPoints(m), left: toPoints(m) };
  const contentWidth = width - margins.left - margins.right;

  const l = t.layout;
  const w = l?.width ?? "32%";
  const sidebarWidth =
    typeof w === "string" && w.endsWith("%")
      ? round((contentWidth * Number(w.slice(0, -1))) / 100)
      : toPoints(w as Length);
  const layout: ResolvedLayout =
    l?.type === "sidebar"
      ? {
          type: "sidebar",
          side: l.side ?? "left",
          width: sidebarWidth,
          gap: toPoints(l.gap ?? "8mm"),
          header: l.header ?? "full",
          sidebar: [...(l.sidebar ?? [])],
        }
      : { type: "single" };

  const p = t.photo;
  const photo: ResolvedPhoto = {
    show: p?.show ?? true,
    position: p?.position ?? (layout.type === "sidebar" ? "sidebar" : "header-right"),
    size: toPoints(p?.size ?? "28mm"),
    shape: p?.shape ?? "circle",
  };
  if (photo.position === "sidebar" && layout.type !== "sidebar") photo.position = "header-right";

  const colors: ResolvedTheme["colors"] = {
    text: t.tokens?.colors?.text ?? d.tokens.colors.text,
    muted: t.tokens?.colors?.muted ?? d.tokens.colors.muted,
    accent: t.tokens?.colors?.accent ?? d.tokens.colors.accent,
  };
  const bg = t.tokens?.colors?.sidebarBackground;
  if (bg && layout.type === "sidebar") colors.sidebarBackground = bg;

  return {
    diagnostics: flat.diagnostics,
    theme: {
      name: theme?.name ?? theme?.extends ?? "default",
      page: { width, height, margins },
      layout,
      photo,
      fonts: {
        body: font(t.tokens?.fonts?.body),
        heading: font(t.tokens?.fonts?.heading),
        name: font(t.tokens?.fonts?.name),
      },
      colors,
      spacing: {
        section: toPoints(t.tokens?.spacing?.section ?? d.tokens.spacing.section),
        item: toPoints(t.tokens?.spacing?.item ?? d.tokens.spacing.item),
        line: t.tokens?.spacing?.line ?? d.tokens.spacing.line,
      },
      format: { date: t.format?.date ?? d.format.date },
    },
  };
}
