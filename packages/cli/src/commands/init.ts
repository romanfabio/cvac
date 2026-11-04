import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentJsonSchema, STARTER_CV, STARTER_THEME, themeJsonSchema } from "@cvac/core";
import { displayName } from "../inputs.ts";
import type { Io } from "../report.ts";

export const SCHEMA_DIR = ".cvac/schemas";
export { STARTER_CV, STARTER_THEME };

export interface InitFlags {
  force?: boolean;
}

/** Write the JSON Schemas used by editors for validation and autocomplete. */
export function writeSchemas(dir: string): string[] {
  const out = join(dir, SCHEMA_DIR);
  mkdirSync(out, { recursive: true });
  const files: [string, unknown][] = [
    ["cv.schema.json", contentJsonSchema()],
    ["theme.schema.json", themeJsonSchema()],
  ];
  return files.map(([name, schema]) => {
    const p = join(out, name);
    writeFileSync(p, `${JSON.stringify(schema, null, 2)}\n`);
    return p;
  });
}

export function runInit(dirArg: string | undefined, flags: InitFlags, io: Io): number {
  const dir = resolve(dirArg ?? ".");
  const cv = join(dir, "cv.yaml");
  const theme = join(dir, "theme.yaml");
  const existing = [cv, theme].filter((p) => existsSync(p));
  if (existing.length && !flags.force) {
    io.err(
      io.color(
        ["bold", "red"],
        `✘ ${existing.map((p) => displayName(p)).join(", ")} already exist${existing.length === 1 ? "s" : ""}.`,
      ) + " Use --force to overwrite.",
    );
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(cv, STARTER_CV);
  writeFileSync(theme, STARTER_THEME);
  const schemas = writeSchemas(dir);
  for (const p of [cv, theme, ...schemas])
    io.out(`${io.color("green", "✔")} created ${displayName(p)}`);
  io.out("");
  io.out(
    `Next: edit ${displayName(cv)}, then run  cvac build --format all${dirArg ? ` ${displayName(cv)}` : ""}`,
  );
  return 0;
}

export function runSchema(dirArg: string | undefined, io: Io): number {
  for (const p of writeSchemas(resolve(dirArg ?? ".")))
    io.out(`${io.color("green", "✔")} wrote ${displayName(p)}`);
  return 0;
}
