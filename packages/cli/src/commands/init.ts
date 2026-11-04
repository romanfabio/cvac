import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentJsonSchema, themeJsonSchema } from "@cvac/core";
import { displayName } from "../inputs.ts";
import type { Io } from "../report.ts";

export const SCHEMA_DIR = ".cvac/schemas";

export const STARTER_CV = `# yaml-language-server: $schema=./${SCHEMA_DIR}/cv.schema.json
# Your CV as code. Build it with:  cvac build --format all
# Text can be one string, or one per language: { en: ..., it: ... }

version: 1
meta:
  defaultLocale: en
  locales: [en, it]
  # Tailored versions of the same CV: cvac build --variant backend
  # Tag sections, items or bullets (tags: [backend]); untagged ones are always kept.
  # variants:
  #   backend:
  #     tags: [backend]
  #     title: Backend Engineer

basics:
  name: Your Name
  title:
    en: Software Engineer
    it: Ingegnere del Software
  email: you@example.com
  phone: "+39 000 000 0000"
  location: { city: Milano, country: { en: Italy, it: Italia } }
  summary:
    en: One or two sentences about what you do and what you are looking for.
    it: Una o due frasi su cosa fai e cosa stai cercando.
  profiles:
    - network: GitHub
      url: https://github.com/your-handle

sections:
  - type: experience
    items:
      - company: Example Corp
        role: { en: Senior Developer, it: Sviluppatore Senior }
        location: Milano
        start: 2022-03
        end: present
        # Quote bullets that contain ": " (YAML would read them as a key).
        highlights:
          - "Impact first: what changed thanks to you, with numbers"
          - Another achievement
          # A bullet only some variants show:
          # - { text: Scaled the API to 10k requests/s, tags: [backend] }

  - type: education
    items:
      - institution: Your University
        degree: { en: MSc Computer Science, it: Laurea Magistrale in Informatica }
        start: 2016
        end: 2018

  - type: skills
    items:
      - name: { en: Languages, it: Linguaggi }
        keywords: [TypeScript, Python]

  - type: languages
    items:
      - { language: { en: Italian, it: Italiano }, fluency: { en: Native, it: Madrelingua } }
      - { language: { en: English, it: Inglese }, fluency: C1 }
`;

export const STARTER_THEME = `# yaml-language-server: $schema=./${SCHEMA_DIR}/theme.schema.json
# Layered over a base theme: set only what you want to change.
# Built-in bases: default (one column) and sidebar. A file works too: ./base.yaml
version: 1
extends: default

page:
  size: A4        # or Letter
  margins: 18mm

tokens:
  colors:
    accent: "#1f4e79"
  # fonts:
  #   body: { family: Source Sans 3, size: 10pt }
  # spacing:
  #   section: 12pt

# A sidebar layout (the DOCX always stays one column, for ATS):
# layout:
#   type: sidebar
#   side: left
#   width: 32%
#   sidebar: [summary, skills, languages]

# The photo (when the CV has basics.photo):
# photo: { position: header-right, size: 28mm, shape: circle }
`;

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
