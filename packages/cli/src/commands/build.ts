import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { buildDocx, buildPdf, type Content, type Diagnostic, hasErrors, lint } from "@cvac/core";
import { loadBundledFonts } from "@cvac/fonts";
import { displayName, type Inputs, loadInputs, locate } from "../inputs.ts";
import { dedupe, formatBytes, type Io, printDiagnostics, summarize } from "../report.ts";

export type Format = "pdf" | "docx";

export interface BuildFlags {
  format?: string;
  lang?: string;
  theme?: string;
  out?: string;
  date?: string;
  embedFonts?: boolean;
  /** Run the ATS linter (default true). Lint errors block the build. */
  lint?: boolean;
  /** Variant name(s) or tag(s), comma-separated, or `all` named variants. */
  variant?: string;
}

export class UsageError extends Error {}

export function parseFormats(value: string | undefined): Format[] {
  if (!value) return ["pdf"];
  const parts =
    value === "all" ? ["pdf", "docx"] : value.split(",").map((s) => s.trim().toLowerCase());
  for (const p of parts) {
    if (p !== "pdf" && p !== "docx")
      throw new UsageError(`Unknown format '${p}'. Use pdf, docx, pdf,docx or all.`);
  }
  return [...new Set(parts)] as Format[];
}

export function parseLangs(value: string | undefined): (string | undefined)[] {
  if (!value) return [undefined];
  return [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Document date: `--date`, else `SOURCE_DATE_EPOCH` (seconds, the
 * reproducible-builds convention), else the library's fixed default.
 */
export function parseDate(flag: string | undefined, env = process.env): Date | undefined {
  if (flag !== undefined) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(flag) ? `${flag}T00:00:00Z` : flag);
    if (Number.isNaN(d.getTime()))
      throw new UsageError(`Invalid --date '${flag}'. Use an ISO date like 2026-01-31.`);
    return d;
  }
  const epoch = env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined && epoch !== "") {
    if (!/^\d+$/.test(epoch))
      throw new UsageError(`Invalid SOURCE_DATE_EPOCH '${epoch}': expected whole seconds.`);
    return new Date(Number(epoch) * 1000);
  }
  return undefined;
}

/**
 * `--variant`: comma-separated names, or `all` for every variant defined in
 * `meta.variants`. Without the flag the full CV is built.
 */
export function parseVariants(
  value: string | undefined,
  content: Content,
): { variants: (string | undefined)[]; diagnostics: Diagnostic[] } {
  if (!value) return { variants: [undefined], diagnostics: [] };
  if (value === "all") {
    const names = Object.keys(content.meta?.variants ?? {});
    if (!names.length) {
      return {
        variants: [],
        diagnostics: [
          {
            code: "no-variants",
            severity: "error",
            message: "--variant all, but the CV defines no variants",
            help: "Add meta.variants to cv.yaml, or pass a tag: --variant backend",
          },
        ],
      };
    }
    return { variants: names, diagnostics: [] };
  }
  return { variants: parseLangs(value), diagnostics: [] };
}

export interface Target {
  format: Format;
  lang: string | undefined;
  variant: string | undefined;
  path: string;
}

/**
 * Output paths. Default: next to the CV, `<name>[.<variant>][.<lang>].<ext>`
 * (each suffix appears whenever its flag is given). `-o` is a file when there
 * is exactly one output, otherwise a directory.
 */
export function planTargets(
  cvPath: string,
  formats: Format[],
  langs: (string | undefined)[],
  out?: string,
  variants: (string | undefined)[] = [undefined],
): Target[] {
  const stem = basename(cvPath, extname(cvPath));
  const combos = variants.flatMap((variant) =>
    langs.flatMap((lang) => formats.map((format) => ({ variant, lang, format }))),
  );
  const name = (c: (typeof combos)[number]) =>
    [stem, c.variant, c.lang, c.format].filter(Boolean).join(".");
  if (out !== undefined) {
    const abs = resolve(out);
    const isDir = /[\/]$/.test(out) || isDirectory(abs) || combos.length > 1;
    if (!isDir) return [{ ...(combos[0] as (typeof combos)[number]), path: abs }];
    return combos.map((c) => ({ ...c, path: join(abs, name(c)) }));
  }
  const dir = dirname(cvPath);
  return combos.map((c) => ({ ...c, path: join(dir, name(c)) }));
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface BuildOutcome {
  ok: boolean;
  diagnostics: Diagnostic[];
  written: { path: string; bytes: number; pages?: number }[];
  inputs: Inputs;
}

/**
 * Load inputs, build every target in memory, lint, then write. Nothing is
 * written when any build or lint check reports an error.
 */
export async function build(cv: string | undefined, flags: BuildFlags): Promise<BuildOutcome> {
  const formats = parseFormats(flags.format);
  const langs = parseLangs(flags.lang);
  const date = parseDate(flags.date);
  const inputs = loadInputs(cv, flags.theme);
  const outcome: BuildOutcome = {
    ok: false,
    diagnostics: [...inputs.diagnostics],
    written: [],
    inputs,
  };
  if (!inputs.content || hasErrors(inputs.diagnostics)) return outcome;
  const { variants, diagnostics: variantDiags } = parseVariants(flags.variant, inputs.content);
  outcome.diagnostics.push(...variantDiags);
  if (hasErrors(variantDiags)) return outcome;

  const fonts = loadBundledFonts();
  const targets = planTargets(inputs.cvPath, formats, langs, flags.out, variants);
  const common = {
    ...(inputs.theme ? { theme: inputs.theme } : {}),
    assets: inputs.assets,
    ...(date ? { date } : {}),
    fonts,
  };

  let failed = false;
  const built: { target: Target; bytes: Uint8Array; pages?: number }[] = [];
  const pagesOf = new Map<string, number>();
  const comboKey = (variant: string | undefined, lang: string | undefined) =>
    `${variant ?? ""}|${lang ?? ""}`;
  for (const t of targets) {
    const opts = {
      ...common,
      ...(t.lang ? { locale: t.lang } : {}),
      ...(t.variant ? { variant: t.variant } : {}),
    };
    const r =
      t.format === "pdf"
        ? await buildPdf(inputs.content, opts)
        : await buildDocx(inputs.content, { ...opts, embedFonts: flags.embedFonts ?? true });
    outcome.diagnostics.push(...r.diagnostics);
    const bytes = "pdf" in r ? r.pdf : "docx" in r ? r.docx : undefined;
    if (!bytes || hasErrors(r.diagnostics)) {
      failed = true;
      continue;
    }
    const pages = "pages" in r ? r.pages : undefined;
    if (pages) pagesOf.set(comboKey(t.variant, t.lang), pages);
    built.push({ target: t, bytes, ...(pages ? { pages } : {}) });
  }

  if (flags.lint !== false) {
    for (const variant of variants) {
      for (const lang of langs) {
        const pages = pagesOf.get(comboKey(variant, lang));
        outcome.diagnostics.push(
          ...lint(inputs.content, {
            fonts,
            ...(inputs.theme ? { theme: inputs.theme } : {}),
            ...(lang ? { locale: lang } : {}),
            ...(variant ? { variant } : {}),
            ...(pages ? { pages } : {}),
          }),
        );
      }
    }
  }
  if (hasErrors(outcome.diagnostics)) failed = true;

  if (!failed) {
    for (const { target, bytes, pages } of built) {
      mkdirSync(dirname(target.path), { recursive: true });
      writeFileSync(target.path, bytes);
      outcome.written.push({ path: target.path, bytes: bytes.length, ...(pages ? { pages } : {}) });
    }
  }

  outcome.diagnostics = dedupe(locate(outcome.diagnostics, inputs));
  outcome.ok = !failed;
  return outcome;
}

export function report(outcome: BuildOutcome, io: Io): void {
  printDiagnostics(outcome.diagnostics, outcome.inputs.sources, io);
  for (const w of outcome.written) {
    const pages = w.pages ? `${w.pages} page${w.pages === 1 ? "" : "s"}, ` : "";
    io.out(`${io.color("green", "✔")} ${displayName(w.path)} (${pages}${formatBytes(w.bytes)})`);
  }
  const s = summarize(outcome.diagnostics);
  if (!outcome.ok) io.err(io.color(["bold", "red"], `✘ build failed${s ? `: ${s}` : ""}`));
  else if (s) io.err(io.color("yellow", `built with ${s}`));
}

export async function runBuild(cv: string | undefined, flags: BuildFlags, io: Io): Promise<number> {
  const outcome = await build(cv, flags);
  report(outcome, io);
  return outcome.ok ? 0 : 1;
}
