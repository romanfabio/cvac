/**
 * Read, add and remove `basics.photo` in cv.yaml as text, so the photo
 * button edits the file the user sees (keeping comments, layout and undo
 * history). Only block-style `basics:` is handled; for anything else the
 * functions return undefined and the editor asks the user to edit by hand.
 */

interface Block {
  lines: string[];
  /** Index of the `basics:` line. */
  start: number;
  /** Index just past the last line of the block. */
  end: number;
  /** Indentation of the block's keys. */
  indent: string;
}

function basicsBlock(text: string): Block | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^basics:[ \t]*(#.*)?\r?$/.test(l));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && /^([ \t]|\r?$)/.test(lines[end] as string)) end++;
  // Trailing blank lines belong to the gap before the next key.
  while (end > start + 1 && /^[ \t]*\r?$/.test(lines[end - 1] as string)) end--;
  const child = lines.slice(start + 1, end).find((l) => /^[ \t]+[^ \t#\r]/.test(l));
  const indent = child ? (/^[ \t]+/.exec(child)?.[0] ?? "  ") : "  ";
  return { lines, start, end, indent };
}

const key = (indent: string, name: string, commented = false) =>
  new RegExp(`^${indent}${commented ? "#[ \\t]*" : ""}${name}:(?:[ \\t]+(.*))?\\r?$`);

function findKey(b: Block, name: string, commented = false): number {
  for (let i = b.start + 1; i < b.end; i++) {
    if (key(b.indent, name, commented).test(b.lines[i] as string)) return i;
  }
  return -1;
}

/** The value of `basics.photo` as written, if it is set. */
export function readPhoto(text: string): string | undefined {
  const b = basicsBlock(text);
  if (!b) return undefined;
  const i = findKey(b, "photo");
  if (i < 0) return undefined;
  const raw = (key(b.indent, "photo").exec(b.lines[i] as string)?.[1] ?? "")
    .replace(/[ \t]+#.*$/, "")
    .trim();
  const value = /^(["'])(.*)\1$/.exec(raw)?.[2] ?? raw;
  return value || undefined;
}

/**
 * Set `basics.photo` to `path`: replace the existing value, or a commented
 * `# photo:` line, or add the key after `name` (or first in `basics`).
 * Undefined when the CV has no block-style `basics:`.
 */
export function setPhoto(text: string, path: string): string | undefined {
  const b = basicsBlock(text);
  if (!b) return undefined;
  const line = `${b.indent}photo: ${path}`;
  const at = [findKey(b, "photo"), findKey(b, "photo", true)].find((i) => i >= 0);
  if (at !== undefined) {
    b.lines[at] = line;
    return b.lines.join("\n");
  }
  // After name's value (which may span nested lines), else first in basics.
  let insert = b.start + 1;
  const name = findKey(b, "name");
  if (name >= 0) {
    insert = name + 1;
    while (insert < b.end && (b.lines[insert] as string).startsWith(`${b.indent} `)) insert++;
  }
  b.lines.splice(insert, 0, line);
  return b.lines.join("\n");
}

/** Remove the `basics.photo` line. Undefined when there is none. */
export function removePhoto(text: string): string | undefined {
  const b = basicsBlock(text);
  if (!b) return undefined;
  const i = findKey(b, "photo");
  if (i < 0) return undefined;
  b.lines.splice(i, 1);
  return b.lines.join("\n");
}

/** The path the photo button writes for a chosen file: photo.png or photo.jpg. */
export function photoPathFor(file: { name: string; type: string }): string {
  return file.type === "image/png" || /\.png$/i.test(file.name) ? "photo.png" : "photo.jpg";
}
