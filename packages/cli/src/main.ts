import { readFileSync } from "node:fs";
import { Command, CommanderError, Option } from "commander";
import { runBuild, UsageError } from "./commands/build.ts";
import { runInit, runSchema } from "./commands/init.ts";
import { runLint } from "./commands/lint.ts";
import { runValidate } from "./commands/validate.ts";
import { runVariants } from "./commands/variants.ts";
import { startWatch } from "./commands/watch.ts";
import { type Io, processIo } from "./report.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

/** Build the command tree. Actions report their exit code through `setCode`. */
export function createProgram(
  io: Io = processIo,
  setCode: (code: number) => void = () => {},
): Command {
  const program = new Command("cvac")
    .description("CV as Code: build deterministic, ATS-friendly PDF and DOCX CVs from YAML.")
    .version(pkg.version)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    });

  const buildOptions = (cmd: Command) =>
    cmd
      .argument("[cv]", "CV file", "cv.yaml")
      .option("-f, --format <formats>", "pdf, docx, md, txt, a comma-separated list, or all", "pdf")
      .option("-l, --lang <locales>", "language(s), e.g. it or en,it (default: meta.defaultLocale)")
      .option("-t, --theme <file>", "theme file (default: theme.yaml next to the CV, if any)")
      .option("-o, --out <path>", "output file, or directory when building several outputs")
      .option(
        "--date <iso>",
        "document date written into the files (default: SOURCE_DATE_EPOCH or 2000-01-01)",
      )
      .addOption(new Option("--no-embed-fonts", "DOCX: do not embed fonts (smaller file)"))
      .option(
        "-v, --variant <names>",
        "variant(s) or tag(s), e.g. backend or backend,lead; 'all' builds every named variant",
      )
      .addOption(new Option("--no-lint", "skip the ATS linter"));

  buildOptions(program.command("build"))
    .description("build the CV")
    .option("-w, --watch", "rebuild when the CV or theme changes")
    .action(async (cv: string, flags) => {
      if (flags.watch) return void (await watchForever(cv, flags, io));
      setCode(await runBuild(cv, flags, io));
    });

  buildOptions(program.command("watch"))
    .description("build, then rebuild on every change (same as build --watch)")
    .action(async (cv: string, flags) => void (await watchForever(cv, flags, io)));

  program
    .command("validate")
    .description("check the CV and theme without writing files")
    .argument("[cv]", "CV file", "cv.yaml")
    .option("-t, --theme <file>", "theme file (default: theme.yaml next to the CV, if any)")
    .option("-l, --lang <locales>", "also check translations for these languages")
    .option("-v, --variant <names>", "check these variants (or 'all')")
    .action(async (cv: string, flags) => {
      setCode(await runValidate(cv, flags, io));
    });

  program
    .command("lint")
    .description("validate and run the ATS linter without writing files")
    .argument("[cv]", "CV file", "cv.yaml")
    .option("-t, --theme <file>", "theme file (default: theme.yaml next to the CV, if any)")
    .option("-l, --lang <locales>", "language(s) to check, e.g. en,it")
    .option("-v, --variant <names>", "lint these variants (or 'all')")
    .option("--strict", "fail on warnings too (useful in CI)")
    .option("--list", "list the rules and their default levels")
    .action(async (cv: string, flags) => {
      setCode(await runLint(cv, flags, io));
    });

  program
    .command("variants")
    .description("list named variants and the tags in use")
    .argument("[cv]", "CV file", "cv.yaml")
    .action((cv: string) => {
      setCode(runVariants(cv, io));
    });

  program
    .command("init")
    .description("create a starter cv.yaml, theme.yaml and editor schemas")
    .argument("[dir]", "target directory", ".")
    .option("--force", "overwrite existing files")
    .action((dir: string, flags) => {
      setCode(runInit(dir === "." ? undefined : dir, flags, io));
    });

  program
    .command("schema")
    .description(`write JSON Schemas for editor autocomplete into <dir>/.cvac/schemas`)
    .argument("[dir]", "target directory", ".")
    .action((dir: string) => {
      setCode(runSchema(dir, io));
    });

  return program;
}

async function watchForever(cv: string, flags: Record<string, unknown>, io: Io): Promise<void> {
  const handle = await startWatch(cv, flags, io);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      handle.close();
      resolve();
    });
  });
}

export async function main(argv: string[], io: Io = processIo): Promise<number> {
  let code = 0;
  try {
    await createProgram(io, (c) => {
      code = c;
    }).parseAsync(argv, { from: "user" });
    return code;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? 0 : 2;
    if (e instanceof UsageError) {
      io.err(io.color(["bold", "red"], `✘ ${e.message}`));
      return 2;
    }
    throw e;
  }
}
