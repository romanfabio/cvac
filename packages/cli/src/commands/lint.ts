import { buildPdf, type Diagnostic, hasErrors, lint, lintRules } from "@cvac/core";
import { loadBundledFonts } from "@cvac/fonts";
import { loadInputs, locate } from "../inputs.ts";
import { dedupe, type Io, printDiagnostics, summarize } from "../report.ts";
import { parseLangs, parseVariants } from "./build.ts";

export interface LintFlags {
  theme?: string;
  lang?: string;
  /** Treat warnings as errors (for CI). */
  strict?: boolean;
  variant?: string;
  list?: boolean;
}

/**
 * Validation plus the ATS linter, for each requested language. Builds the
 * PDF in memory (nothing is written) to know the page count and fonts.
 */
export async function runLint(cv: string | undefined, flags: LintFlags, io: Io): Promise<number> {
  if (flags.list) return listRules(io);

  const inputs = loadInputs(cv, flags.theme);
  let diags: Diagnostic[] = [...inputs.diagnostics];
  if (inputs.content && !hasErrors(diags)) {
    const fonts = loadBundledFonts();
    const { variants, diagnostics: vd } = parseVariants(flags.variant, inputs.content);
    diags.push(...vd);
    for (const variant of variants) {
      for (const lang of parseLangs(flags.lang)) {
        const common = {
          fonts,
          ...(inputs.theme ? { theme: inputs.theme } : {}),
          assets: inputs.assets,
          ...(lang ? { locale: lang } : {}),
          ...(variant ? { variant } : {}),
        };
        const pdf = await buildPdf(inputs.content, common);
        diags.push(...pdf.diagnostics);
        diags.push(
          ...lint(inputs.content, { ...common, ...(pdf.pages ? { pages: pdf.pages } : {}) }),
        );
      }
    }
    diags = dedupe(locate(diags, inputs));
  }

  printDiagnostics(diags, inputs.sources, io);
  const s = summarize(diags);
  const failing =
    hasErrors(diags) || (flags.strict === true && diags.some((d) => d.severity === "warning"));
  if (failing) {
    io.err(
      io.color(
        ["bold", "red"],
        `✘ ${inputs.cvName}: ${s}${flags.strict && !hasErrors(diags) ? " (--strict)" : ""}`,
      ),
    );
    return 1;
  }
  io.out(`${io.color("green", "✔")} ${inputs.cvName}: ${s || "no problems found"}`);
  return 0;
}

function listRules(io: Io): number {
  const rules = lintRules();
  const width = Math.max(...rules.map((r) => r.id.length));
  for (const r of rules) {
    const level = r.level === "info" ? "note" : r.level;
    io.out(`${r.id.padEnd(width)}  ${level.padEnd(7)}  ${r.summary}`);
  }
  io.out("");
  io.out("Change a level in cv.yaml:  meta: { lint: { photo: off, missing-phone: warning } }");
  return 0;
}
