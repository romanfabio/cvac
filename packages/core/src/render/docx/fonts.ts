/// <reference path="./fontkit.d.ts" />
import { create as openFont } from "fontkit";
import { type FontFace, type FontSet, selectFace } from "../../fonts.ts";

/**
 * Font table entries for DOCX. Word does not embed fonts by default, so on a
 * machine without the font it substitutes one, guided by the font table's
 * PANOSE and family class. Without them it may pick a serif for a sans font.
 * Optionally the faces are embedded (obfuscated per ECMA-376) so the document
 * looks the same everywhere, at the cost of file size.
 */
export interface DocxFont {
  family: string;
  /** 10 PANOSE bytes as 20 hex chars. */
  panose: string;
  /** `swiss` (sans), `roman` (serif), `modern` (monospace) or `auto`. */
  familyClass: "swiss" | "roman" | "modern" | "auto";
  monospace: boolean;
  embed?: Partial<Record<FaceSlot, FontFace>>;
}

export type FaceSlot = "regular" | "bold" | "italic" | "boldItalic";

const SLOTS: Record<FaceSlot, { weight: number; italic: boolean; element: string }> = {
  regular: { weight: 400, italic: false, element: "w:embedRegular" },
  bold: { weight: 700, italic: false, element: "w:embedBold" },
  italic: { weight: 400, italic: true, element: "w:embedItalic" },
  boldItalic: { weight: 700, italic: true, element: "w:embedBoldItalic" },
};

/** Describe each used family from its font file (and pick faces to embed). */
export function describeFonts(fonts: FontSet, families: string[], embed: boolean): DocxFont[] {
  const out: DocxFont[] = [];
  for (const family of families) {
    const regular = selectFace(fonts, { family, weight: 400, italic: false });
    if (!regular) continue;
    const os2 = (openFont(regular.data as never) as unknown as FontkitFont)["OS/2"];
    const panose = os2?.panose ?? [];
    const entry: DocxFont = {
      family,
      panose:
        panose.length === 10
          ? panose
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
              .toUpperCase()
          : "",
      familyClass: classify(panose),
      monospace: panose[0] === 2 && panose[3] === 9,
    };
    if (embed) {
      const faces: Partial<Record<FaceSlot, FontFace>> = {};
      const seen = new Set<FontFace>();
      for (const [slot, want] of Object.entries(SLOTS) as [FaceSlot, (typeof SLOTS)[FaceSlot]][]) {
        const f = selectFace(fonts, { family, weight: want.weight, italic: want.italic });
        // A "bold" slot filled with the regular face would just duplicate bytes.
        if (!f || f.italic !== want.italic || want.weight >= 600 !== f.weight >= 600 || seen.has(f))
          continue;
        seen.add(f);
        faces[slot] = f;
      }
      entry.embed = faces;
    }
    out.push(entry);
  }
  return out;
}

interface FontkitFont {
  "OS/2"?: { panose?: number[] };
}

/** PANOSE family kind 2 = Latin text; serif style 11-13 = sans. */
function classify(p: number[]): DocxFont["familyClass"] {
  if (p[0] !== 2) return "auto";
  if (p[3] === 9) return "modern";
  return p[1] !== undefined && p[1] >= 11 && p[1] <= 13 ? "swiss" : "roman";
}

const FONT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

/**
 * Write font table entries (and embedded, obfuscated faces) into the
 * unpacked package. Keys are derived from the family and slot, so the
 * output is deterministic.
 */
export function applyFonts(
  text: Map<string, string>,
  binary: Map<string, Uint8Array>,
  fonts: DocxFont[],
): void {
  if (!fonts.length) return;
  const rels: string[] = [];
  let n = 0;
  const entries = fonts.map((f) => {
    const embeds: string[] = [];
    for (const [slot, face] of Object.entries(f.embed ?? {}) as [FaceSlot, FontFace][]) {
      n++;
      const id = `rIdFont${n}`;
      const key = guid(`${f.family}|${slot}`);
      binary.set(`word/fonts/font${n}.odttf`, obfuscate(face.data, key));
      rels.push(`<Relationship Id="${id}" Type="${FONT_REL}" Target="fonts/font${n}.odttf"/>`);
      embeds.push(`<${SLOTS[slot].element} r:id="${id}" w:fontKey="{${key}}"/>`);
    }
    return [
      `<w:font w:name="${xmlAttr(f.family)}">`,
      f.panose ? `<w:panose1 w:val="${f.panose}"/>` : "",
      `<w:charset w:val="00"/>`,
      `<w:family w:val="${f.familyClass}"/>`,
      `<w:pitch w:val="${f.monospace ? "fixed" : "variable"}"/>`,
      ...embeds,
      "</w:font>",
    ].join("");
  });

  const table = text.get("word/fontTable.xml");
  if (table !== undefined) {
    text.set(
      "word/fontTable.xml",
      table.includes("</w:fonts>")
        ? table.replace("</w:fonts>", `${entries.join("")}</w:fonts>`)
        : table.replace(/<w:fonts\b([^>]*?)\/>/, `<w:fonts$1>${entries.join("")}</w:fonts>`),
    );
  }

  if (rels.length) {
    const relsName = "word/_rels/fontTable.xml.rels";
    const r =
      text.get(relsName) ??
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
    text.set(
      relsName,
      r.includes("</Relationships>")
        ? r.replace("</Relationships>", `${rels.join("")}</Relationships>`)
        : r.replace(
            /<Relationships\b([^>]*?)\/>/,
            `<Relationships$1>${rels.join("")}</Relationships>`,
          ),
    );
    // Keep fonts embedded when the user re-saves in Word.
    const settings = text.get("word/settings.xml");
    if (settings !== undefined && !settings.includes("w:embedTrueTypeFonts")) {
      text.set(
        "word/settings.xml",
        settings.includes("<w:displayBackgroundShape/>")
          ? settings.replace(
              "<w:displayBackgroundShape/>",
              "<w:displayBackgroundShape/><w:embedTrueTypeFonts/>",
            )
          : settings.replace(/(<w:settings\b[^>]*>)/, "$1<w:embedTrueTypeFonts/>"),
      );
    }
  }
}

/**
 * ECMA-376 font obfuscation: XOR the first 32 bytes with the GUID key bytes
 * in reverse order (same algorithm as Word and the `docx` library).
 */
export function obfuscate(data: Uint8Array, key: string): Uint8Array {
  const hex = key.replace(/[{}-]/g, "");
  const bytes = (hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)).reverse();
  const out = data.slice();
  for (let i = 0; i < 32 && i < out.length; i++)
    out[i] = (out[i] as number) ^ (bytes[i % bytes.length] as number);
  return out;
}

/** Deterministic GUID-shaped key from a string (FNV-1a, 4 x 32 bits). */
function guid(seed: string): string {
  let hex = "";
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, "0");
  }
  hex = hex.toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function xmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
