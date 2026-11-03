import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from "fflate";
import { applyFonts, type DocxFont } from "./fonts.ts";

/**
 * Make a DOCX produced by the `docx` library byte-reproducible:
 *
 * 1. `docProps/core.xml` created/modified timestamps -> the fixed document date.
 * 2. Random relationship ids (nanoid, e.g. hyperlinks) -> sequential ids in
 *    order of appearance. Ids are only references inside the package, so
 *    renaming them consistently in every part is safe.
 * 3. Font table entries (PANOSE/family hints, optional embedded faces).
 * 4. Re-zip with a fixed entry mtime and compression level, keeping the
 *    library's (deterministic) entry order; added font parts go last.
 *
 * The zip format stores local date/time fields and fflate fills them with
 * local-time getters, so the mtime is built with the *local* `Date`
 * constructor from the UTC fields: the bytes are then the same in every
 * time zone.
 */
export function normalizeDocx(bytes: Uint8Array, date: Date, fonts: DocxFont[] = []): Uint8Array {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const text = new Map<string, string>();
  for (const name of names) {
    if (/\.(xml|rels)$/.test(name)) text.set(name, strFromU8(files[name] as Uint8Array));
  }

  // 1. Timestamps.
  const iso = `${date.toISOString().slice(0, 19)}Z`;
  const core = text.get("docProps/core.xml");
  if (core !== undefined) {
    text.set(
      "docProps/core.xml",
      core.replace(
        /(<dcterms:(created|modified)\b[^>]*>)[^<]*(<\/dcterms:\2>)/g,
        (_m, open: string, _tag: string, close: string) => `${open}${iso}${close}`,
      ),
    );
  }

  // 2. Relationship ids: anything not already `rId<number>` is a random id.
  const rename = new Map<string, string>();
  for (const name of names) {
    if (!name.endsWith(".rels")) continue;
    for (const m of (text.get(name) ?? "").matchAll(/\bId="([^"]+)"/g)) {
      const id = m[1] as string;
      if (!/^rId\d+$/.test(id) && !rename.has(id)) rename.set(id, `rIdCvac${rename.size + 1}`);
    }
  }
  if (rename.size) {
    const pattern = new RegExp(`"(${[...rename.keys()].map(escapeRe).join("|")})"`, "g");
    for (const [name, value] of text) {
      text.set(
        name,
        value.replace(pattern, (_m, id: string) => `"${rename.get(id)}"`),
      );
    }
  }

  // 3. Fonts.
  const added = new Map<string, Uint8Array>();
  applyFonts(text, added, fonts);

  // 4. Re-zip deterministically.
  const mtime = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
  const out: Zippable = {};
  for (const name of names) {
    const t = text.get(name);
    out[name] = [t !== undefined ? strToU8(t) : (files[name] as Uint8Array), { mtime, level: 6 }];
  }
  for (const [name, data] of added) out[name] = [data, { mtime, level: 6 }];
  return zipSync(out);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
