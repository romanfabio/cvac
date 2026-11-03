import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { buildDocx, buildPdf, type Diagnostic, hasErrors } from "@cvac/core";
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

export interface Target {
  format: Format;
  lang: string | undefined;
  path: string;
}

/**
 * Output paths. Default: next to the CV, `<name>[.<lang>].<ext>` (the
 * language suffix appears whenever --lang is given). `-o` is a file when
 * there is exactly one output, otherwise a directory.
 */
export function planTargets(
  cvPath: string,
  formats: Format[],
  langs: (string | undefined)[],
  out?: string,
): Target[] {
  const stem = basename(cvPath, extname(cvPath));
  const combos = langs.flatMap((lang) => formats.map((format) => ({ lang, format })));
  const name = (lang: string | undefined, format: Format) =>
    `${stem}${lang ? `.${lang}` : ""}.${format}`;
  if (out !== undefined) {
    const abs = resolve(out);
    const isDir = /[\\/]$/.test(out) || isDirectory(abs) || combos.length > 1;
    if (!isDir) {
      const only = combos[0] as { lang: string | undefined; format: Format };
      return [{ ...only, path: abs }];
    }
    return combos.map(({ lang, format }) => ({
      lang,
      format,
      path: join(abs, name(lang, format)),
    }));
  }
  const dir = dirname(cvPath);
  return combos.map(({ lang, format }) => ({ lang, format, path: join(dir, name(lang, format)) }));
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

/** Load inputs, build every target, write files. Pure of process state except fs. */
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

  const fonts = loadBundledFonts();
  const targets = planTargets(inputs.cvPath, formats, langs, flags.out);
  const common = {
    ...(inputs.theme ? { theme: inputs.theme } : {}),
    ...(date ? { date } : {}),
    fonts,
  };

  let failed = false;
  for (const t of targets) {
    const opts = { ...common, ...(t.lang ? { locale: t.lang } : {}) };
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
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileSync(t.path, bytes);
    outcome.written.push({
      path: t.path,
      bytes: bytes.length,
      ...("pages" in r && r.pages ? { pages: r.pages } : {}),
    });
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
