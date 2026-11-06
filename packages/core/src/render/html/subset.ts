/// <reference path="../docx/fontkit.d.ts" />
import { create as openFont } from "fontkit";

/**
 * Web-font subsetting: a TrueType font cut down to the glyphs a document
 * uses, loadable by browsers. fontkit's subsetter writes only the tables a
 * PDF needs (glyf, loca, hmtx, ...), so this adds what browsers require:
 * `cmap` (characters to the new glyph ids), `OS/2`, `post` (version 3, no
 * glyph names) and `name`. Pure and deterministic: the same font and
 * characters always give the same bytes.
 *
 * The OFL's Reserved Font Name rule: a subset is a modified font, so the
 * `name` table gets a new family name (`familyName`). The copyright, license
 * and license URL records are copied from the original.
 */

interface Glyph {
  id: number;
}
interface FontkitFont {
  glyphForCodePoint(cp: number): Glyph;
  createSubset(): { includeGlyph(glyph: number): number; encode(): Uint8Array };
}

export interface SubsetResult {
  /** The subset font (TrueType). */
  data: Uint8Array;
  /** Characters the font has no glyph for (left out, the browser falls back). */
  missing: number[];
}

/** Subset `font` to the characters in `codePoints` (with .notdef). */
export function subsetFont(
  font: Uint8Array,
  codePoints: Iterable<number>,
  familyName: string,
): SubsetResult {
  const f = openFont(font as never) as FontkitFont;
  const subset = f.createSubset();
  const map = new Map<number, number>();
  const missing: number[] = [];
  for (const cp of [...new Set(codePoints)].sort((a, b) => a - b)) {
    const g = f.glyphForCodePoint(cp);
    if (!g || g.id === 0) {
      missing.push(cp);
      continue;
    }
    map.set(cp, subset.includeGlyph(g.id));
  }
  const tables = readTables(new Uint8Array(subset.encode()));
  const original = readTables(font);
  for (const tag of ["OS/2", "post", "name"]) {
    if (!original.has(tag)) throw new Error(`The font has no '${tag}' table`);
  }
  tables.set("cmap", cmapTable(map));
  tables.set("OS/2", original.get("OS/2") as Uint8Array);
  tables.set("post", postV3(original.get("post") as Uint8Array));
  tables.set("name", nameTable(original.get("name") as Uint8Array, familyName));
  return { data: writeFont(tables), missing };
}

// --- sfnt container -----------------------------------------------------------

function readTables(font: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = v.getUint16(4);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(at, at + 4));
    const offset = v.getUint32(at + 8);
    const length = v.getUint32(at + 12);
    out.set(tag, font.slice(offset, offset + length));
  }
  return out;
}

function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const v = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/** Tables sorted by tag, 4-byte aligned, with checksums and head.checkSumAdjustment. */
function writeFont(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const head = tables.get("head");
  if (head) new DataView(head.buffer, head.byteOffset).setUint32(8, 0);
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  let size = 12 + n * 16;
  const offsets: number[] = [];
  for (const tag of tags) {
    offsets.push(size);
    size += ((tables.get(tag) as Uint8Array).length + 3) & ~3;
  }
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  v.setUint16(6, searchRange);
  v.setUint16(8, entrySelector);
  v.setUint16(10, n * 16 - searchRange);
  tags.forEach((tag, i) => {
    const data = tables.get(tag) as Uint8Array;
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[at + k] = tag.charCodeAt(k);
    v.setUint32(at + 4, checksum(data));
    v.setUint32(at + 8, offsets[i] as number);
    v.setUint32(at + 12, data.length);
    out.set(data, offsets[i]);
  });
  const headIndex = tags.indexOf("head");
  if (headIndex >= 0) {
    v.setUint32((offsets[headIndex] as number) + 8, (0xb1b0afba - checksum(out)) >>> 0);
  }
  return out;
}

// --- tables -------------------------------------------------------------------

class Writer {
  bytes: number[] = [];
  u16(x: number) {
    this.bytes.push((x >>> 8) & 0xff, x & 0xff);
  }
  u32(x: number) {
    this.u16(x >>> 16);
    this.u16(x & 0xffff);
  }
  done() {
    return new Uint8Array(this.bytes);
  }
}

/**
 * `cmap` with a Windows Unicode BMP subtable (format 4), plus a full-range
 * one (format 12) when a character lies beyond the BMP.
 */
function cmapTable(map: Map<number, number>): Uint8Array {
  const cps = [...map.keys()].sort((a, b) => a - b);
  const bmp = cps.filter((c) => c <= 0xffff);
  const sub4 = format4(bmp, map);
  const wide = cps.length > bmp.length ? format12(cps, map) : undefined;
  const w = new Writer();
  const count = wide ? 2 : 1;
  w.u16(0);
  w.u16(count);
  const first = 4 + count * 8;
  w.u16(3);
  w.u16(1);
  w.u32(first);
  if (wide) {
    w.u16(3);
    w.u16(10);
    w.u32(first + sub4.length);
  }
  const head = w.done();
  const out = new Uint8Array(head.length + sub4.length + (wide?.length ?? 0));
  out.set(head);
  out.set(sub4, head.length);
  if (wide) out.set(wide, head.length + sub4.length);
  return out;
}

function format4(cps: number[], map: Map<number, number>): Uint8Array {
  // One segment per run of consecutive characters with consecutive glyphs.
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const cp of cps) {
    const gid = map.get(cp) as number;
    const last = segs[segs.length - 1];
    if (last && cp === last.end + 1 && gid - cp === last.delta) last.end = cp;
    else segs.push({ start: cp, end: cp, delta: gid - cp });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 * 2 ** entrySelector;
  const w = new Writer();
  w.u16(4);
  w.u16(16 + n * 8);
  w.u16(0);
  w.u16(n * 2);
  w.u16(searchRange);
  w.u16(entrySelector);
  w.u16(n * 2 - searchRange);
  for (const s of segs) w.u16(s.end);
  w.u16(0);
  for (const s of segs) w.u16(s.start);
  for (const s of segs) w.u16(s.delta & 0xffff);
  for (const _ of segs) w.u16(0);
  return w.done();
}

function format12(cps: number[], map: Map<number, number>): Uint8Array {
  const groups: { start: number; end: number; gid: number }[] = [];
  for (const cp of cps) {
    const gid = map.get(cp) as number;
    const last = groups[groups.length - 1];
    if (last && cp === last.end + 1 && gid === last.gid + (cp - last.start)) last.end = cp;
    else groups.push({ start: cp, end: cp, gid });
  }
  const w = new Writer();
  w.u16(12);
  w.u16(0);
  w.u32(16 + groups.length * 12);
  w.u32(0);
  w.u32(groups.length);
  for (const g of groups) {
    w.u32(g.start);
    w.u32(g.end);
    w.u32(g.gid);
  }
  return w.done();
}

/** `post` version 3: the original metrics, without glyph names. */
function postV3(post: Uint8Array): Uint8Array {
  const out = post.slice(0, 32);
  new DataView(out.buffer).setUint32(0, 0x00030000);
  return out;
}

/** Name ids kept from the original: copyright, trademark, license, license URL. */
const KEPT_NAMES = new Set([0, 7, 13, 14]);

/**
 * A Windows-platform `name` table with the new family name (ids 1-4, 6) and
 * the original's legal records (in their Windows English versions).
 */
function nameTable(original: Uint8Array, family: string): Uint8Array {
  const v = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const records: { id: number; text: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const [platform, encoding, language, id] = [0, 2, 4, 6].map((o) => v.getUint16(at + o));
    if (platform !== 3 || encoding !== 1 || language !== 0x409 || !KEPT_NAMES.has(id as number)) {
      continue;
    }
    const length = v.getUint16(at + 8);
    const offset = strings + v.getUint16(at + 10);
    records.push({ id: id as number, text: original.slice(offset, offset + length) });
  }
  const ps = family.replace(/[^A-Za-z0-9-]/g, "");
  for (const [id, text] of [
    [1, family],
    [2, "Regular"],
    [3, ps],
    [4, family],
    [6, ps],
  ] as const) {
    records.push({ id, text: utf16be(text) });
  }
  records.sort((a, b) => a.id - b.id);
  const w = new Writer();
  w.u16(0);
  w.u16(records.length);
  w.u16(6 + records.length * 12);
  let offset = 0;
  for (const r of records) {
    w.u16(3);
    w.u16(1);
    w.u16(0x409);
    w.u16(r.id);
    w.u16(r.text.length);
    w.u16(offset);
    offset += r.text.length;
  }
  for (const r of records) w.bytes.push(...r.text);
  return w.done();
}

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) >> 8;
    out[i * 2 + 1] = s.charCodeAt(i) & 0xff;
  }
  return out;
}
