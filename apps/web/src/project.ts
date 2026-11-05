/**
 * A project as a .zip: cv.yaml, theme.yaml, the photo at the path the CV
 * gives, and the editor schemas, laid out like `cvac init` so the unzipped
 * folder builds with `cvac build`. Pure (fflate only), so it runs in the
 * browser and in Node tests.
 */
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from "fflate";

export const PROJECT_FILE = "cv-project.zip";
const CV = "cv.yaml";
const THEME = "theme.yaml";
const SCHEMA_DIR = ".cvac/schemas";
const IMAGE = /\.(jpe?g|png)$/i;
/** Refuse archives that unpack to more than this (zip bombs, wrong file). */
export const MAX_PROJECT_BYTES = 50_000_000;

export interface Project {
  cv: string;
  theme: string;
  /** Images by path relative to cv.yaml, as `basics.photo` refers to them. */
  photos: Record<string, Uint8Array>;
}

export interface ExportInput {
  cv: string;
  theme: string;
  /** The photo the CV uses, keyed by the path written in `basics.photo`. */
  photo?: { path: string; data: Uint8Array };
  /** JSON Schemas for `.cvac/schemas/` (editor completion after unzipping). */
  schemas?: { cv: unknown; theme: unknown };
}

export interface ExportResult {
  zip: Uint8Array;
  /** Why the photo was left out, if it was. */
  skipped?: string;
}

/**
 * A relative path that stays inside the project folder, with forward
 * slashes, or undefined (absolute, `..`, drive letters, empty).
 */
export function safePath(path: string): string | undefined {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return undefined;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "" || s === ".")) return undefined;
  return parts.join("/");
}

/**
 * Zip the project. Byte-identical for equal inputs: entries in a fixed order
 * with a fixed date (built with the local-time constructor, because fflate
 * writes zip times with local-time getters).
 */
export function exportProject(input: ExportInput): ExportResult {
  const mtime = new Date(2000, 0, 1);
  const opts = { mtime, level: 6 } as const;
  const files: Zippable = {
    [CV]: [strToU8(input.cv), opts],
    [THEME]: [strToU8(input.theme), opts],
  };
  let skipped: string | undefined;
  if (input.photo) {
    const path = safePath(input.photo.path);
    if (!path) skipped = `the photo path '${input.photo.path}' points outside the project folder`;
    else if (path === CV || path === THEME) skipped = `the photo path '${path}' is a project file`;
    else files[path] = [input.photo.data, { mtime, level: 0 }]; // JPEG/PNG are already compressed
  }
  if (input.schemas) {
    for (const [name, schema] of [
      ["cv.schema.json", input.schemas.cv],
      ["theme.schema.json", input.schemas.theme],
    ] as const) {
      // Same text as `cvac schema` writes.
      files[`${SCHEMA_DIR}/${name}`] = [strToU8(`${JSON.stringify(schema, null, 2)}\n`), opts];
    }
  }
  return { zip: zipSync(files), ...(skipped ? { skipped } : {}) };
}

/**
 * Read a project zip. cv.yaml may be at the root or inside one folder (a
 * zipped project folder); theme.yaml and images are taken from beside it.
 * Throws an Error with a message for the user when the zip is unusable.
 */
export function importProject(zip: Uint8Array): Project {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_PROJECT_BYTES) throw new Error("too-large");
        return f.name.endsWith(CV) || f.name.endsWith(THEME) || IMAGE.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "too-large") {
      throw new Error(`The zip unpacks to more than ${MAX_PROJECT_BYTES / 1_000_000} MB`);
    }
    throw new Error("The file is not a valid zip archive");
  }

  // The shallowest cv.yaml decides the project folder.
  const cvPath = Object.keys(entries)
    .filter((n) => n === CV || n.endsWith(`/${CV}`))
    .filter((n) => !n.startsWith("__MACOSX/"))
    .sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1))[0];
  if (!cvPath) throw new Error("The zip has no cv.yaml");
  const dir = cvPath.slice(0, -CV.length);

  const photos: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith(dir) || !IMAGE.test(name) || name.startsWith("__MACOSX/")) continue;
    const rel = safePath(name.slice(dir.length));
    if (rel) photos[rel] = data;
  }
  const theme = entries[`${dir}${THEME}`];
  return {
    cv: strFromU8(entries[cvPath] as Uint8Array),
    theme: theme ? strFromU8(theme) : "",
    photos,
  };
}
