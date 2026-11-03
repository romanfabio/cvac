import { buildPdf, hasErrors } from "@cvac/core";
import { loadBundledFonts } from "@cvac/fonts";
import { loadInputs, locate } from "../inputs.ts";
import { dedupe, type Io, printDiagnostics, summarize } from "../report.ts";
import { parseLangs } from "./build.ts";

export interface ValidateFlags {
  theme?: string;
  lang?: string;
}

/**
 * Check the CV and theme without writing anything: schema, opinionated
 * rules, translations for each requested language, and theme fonts.
 */
export async function runValidate(
  cv: string | undefined,
  flags: ValidateFlags,
  io: Io,
): Promise<number> {
  const inputs = loadInputs(cv, flags.theme);
  let diags = [...inputs.diagnostics];

  if (inputs.content && !hasErrors(diags)) {
    const fonts = loadBundledFonts();
    for (const lang of parseLangs(flags.lang)) {
      const r = await buildPdf(inputs.content, {
        fonts,
        ...(inputs.theme ? { theme: inputs.theme } : {}),
        ...(lang ? { locale: lang } : {}),
      });
      diags.push(...r.diagnostics);
    }
    diags = dedupe(locate(diags, inputs));
  }

  printDiagnostics(diags, inputs.sources, io);
  const s = summarize(diags);
  const names = [inputs.cvName, inputs.themeName].filter(Boolean).join(" + ");
  if (hasErrors(diags)) {
    io.err(io.color(["bold", "red"], `✘ ${names}: ${s}`));
    return 1;
  }
  io.out(`${io.color("green", "✔")} ${names} ${s ? `valid with ${s}` : "valid"}`);
  return 0;
}
