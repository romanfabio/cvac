/**
 * Schema-driven YAML completion for the editor: property names (with their
 * descriptions) and enum/const values, from cvac's JSON Schemas.
 *
 * It works on text, by indentation, rather than on a parse tree, so it keeps
 * working while the document is half-typed and invalid. Pure: unit-tested.
 */

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
}

export interface Suggestion {
  label: string;
  /** Text inserted in place of the typed word. */
  apply: string;
  type: "property" | "enum";
  detail?: string;
  info?: string;
}

export interface Completion {
  /** Offset where the replaced word starts. */
  from: number;
  options: Suggestion[];
}

/**
 * Path segments from the root: property names, or list items carrying that
 * item's own keys (to narrow unions by a `type:` discriminator).
 */
type Segment = string | { item: Map<string, string> };
type Path = Segment[];

interface Line {
  /** Column of the first character after indentation and list dashes. */
  keyCol: number;
  /** Column of the list dash, or -1. */
  dashCol: number;
  key?: string;
  /** The key has an inline value (scalar or flow collection) on this line. */
  hasValue: boolean;
  value: string;
  blank: boolean;
}

function parseLine(text: string): Line {
  const m = /^(\s*)((?:-[ \t]+)*)(.*)$/.exec(text) as RegExpExecArray;
  const indent = (m[1] as string).length;
  const dashes = m[2] as string;
  const rest = (m[3] as string).replace(/\s+$/, "");
  const line: Line = {
    keyCol: indent + dashes.length,
    dashCol: dashes ? indent : -1,
    hasValue: false,
    value: "",
    blank: !dashes && (rest === "" || rest.startsWith("#")),
  };
  const km = /^("[^"]*"|'[^']*'|[^\s#:"'][^:#]*?):(?:\s+|$)(.*)$/.exec(rest);
  if (km) {
    line.key = (km[1] as string).replace(/^["']|["']$/g, "");
    line.value = (km[2] as string).replace(/\s+#.*$/, "").trim();
    line.hasValue = line.value !== "";
  }
  return line;
}

/**
 * Path of the mapping that contains a key starting at column `col` on line
 * `index`. `inItem` says the current line starts a list item ("- key").
 */
function ancestors(lines: string[], index: number, col: number, dashCol: number): Path {
  const path: Path = [];
  let c = col;
  let itemCol = dashCol; // >= 0 while we are inside a list item
  let item = dashCol >= 0 ? siblings(lines, index, col, dashCol) : undefined;
  for (let j = index - 1; j >= 0 && (c > 0 || itemCol >= 0); j--) {
    const l = parseLine(lines[j] as string);
    if (l.blank) continue;
    if (itemCol < 0 && l.dashCol >= 0 && l.keyCol === c && l.dashCol < c) {
      // A sibling key of ours started this list item ("- company: ...").
      itemCol = l.dashCol;
      item = siblings(lines, j, c, itemCol);
      continue;
    }
    if (itemCol >= 0) {
      // Find the key owning the list: block key at or left of the dash.
      const owns =
        l.key && !l.hasValue && (l.keyCol < itemCol || (l.keyCol === itemCol && l.dashCol < 0));
      if (!owns) continue;
      path.unshift(l.key as string, { item: item ?? new Map() });
      c = l.keyCol;
      itemCol = l.dashCol;
      item = itemCol >= 0 ? siblings(lines, j, c, itemCol) : undefined;
      continue;
    }
    if (l.key && !l.hasValue && l.keyCol < c) {
      path.unshift(l.key);
      c = l.keyCol;
      itemCol = l.dashCol;
      item = itemCol >= 0 ? siblings(lines, j, c, itemCol) : undefined;
    }
  }
  return path;
}

/**
 * Keys already present in the mapping around `index` (same column). In a
 * list, a mapping starts at its "- " line: the previous item's keys sit
 * above that line, the next item starts at the next dash, so neither leaks in.
 */
function siblings(
  lines: string[],
  index: number,
  col: number,
  _dashCol: number,
): Map<string, string> {
  const out = new Map<string, string>();
  const current = parseLine(lines[index] as string);
  if (current.key) out.set(current.key, current.value);
  const startsItem = current.dashCol >= 0 && current.keyCol === col;
  if (!startsItem) {
    for (let j = index - 1; j >= 0; j--) {
      const l = parseLine(lines[j] as string);
      if (l.blank) continue;
      if (l.keyCol < col) break;
      if (l.keyCol === col && l.key) out.set(l.key, l.value);
      if (l.dashCol >= 0 && l.keyCol === col) break; // first line of this item
    }
  }
  for (let j = index + 1; j < lines.length; j++) {
    const l = parseLine(lines[j] as string);
    if (l.blank) continue;
    if (l.keyCol < col) break;
    if (l.dashCol >= 0 && l.keyCol === col) break; // the next item starts
    if (l.keyCol === col && l.key) out.set(l.key, l.value);
  }
  return out;
}

function branches(s: JsonSchema | undefined): JsonSchema[] {
  if (!s) return [];
  const alts = s.anyOf ?? s.oneOf;
  return alts ? alts.flatMap(branches) : [s];
}

function schemasAt(root: JsonSchema, path: Path): JsonSchema[] {
  let cur = [root];
  for (const seg of path) {
    if (typeof seg === "string") {
      cur = cur
        .flatMap(branches)
        .flatMap((b) => (b.properties?.[seg] ? [b.properties[seg] as JsonSchema] : []));
    } else {
      // Into a list item, keeping only the union branches that match it.
      const items = cur.flatMap(branches).flatMap((b) => (b.items ? [b.items] : []));
      cur = objectBranches(items, seg.item);
      if (!cur.length) cur = items;
    }
  }
  return cur;
}

/** Object branches, narrowed by a `type:` discriminator when one is set. */
function objectBranches(schemas: JsonSchema[], present: Map<string, string>): JsonSchema[] {
  const objects = schemas.flatMap(branches).filter((b) => b.properties);
  const type = present.get("type");
  if (type === undefined) return objects;
  const matching = objects.filter((b) => b.properties?.type?.const === type);
  return matching.length ? matching : objects;
}

function valuesOf(schemas: JsonSchema[]): string[] {
  const out = new Set<string>();
  for (const b of schemas.flatMap(branches)) {
    if (b.const !== undefined) out.add(String(b.const));
    for (const e of b.enum ?? []) out.add(String(e));
    if (b.type === "boolean") {
      out.add("true");
      out.add("false");
    }
  }
  return [...out];
}

/** Completion at `offset` in `text`, or null where there is nothing to offer. */
export function completeYaml(text: string, offset: number, root: JsonSchema): Completion | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  if (before.includes("#")) return null;
  const lines = text.split("\n");
  const index = text.slice(0, lineStart).split("\n").length - 1;

  // Value position: "key: wor|"
  const value = /^(\s*)((?:-[ \t]+)*)([^\s:#][^:#]*?):[ \t]+([^\s#{}[\],]*)$/.exec(before);
  if (value) {
    const col = (value[1] as string).length + (value[2] as string).length;
    const dashCol = value[2] ? (value[1] as string).length : -1;
    const key = value[3] as string;
    const word = value[4] as string;
    const path = ancestors(lines, index, col, dashCol);
    const present = siblings(lines, index, col, dashCol);
    present.delete(key);
    const props = objectBranches(schemasAt(root, path), present).flatMap((b) =>
      b.properties?.[key] ? [b.properties[key] as JsonSchema] : [],
    );
    const options = valuesOf(props)
      .filter((v) => v.startsWith(word))
      .map((v): Suggestion => ({ label: v, apply: v, type: "enum" }));
    return options.length ? { from: offset - word.length, options } : null;
  }

  // Key position: "  wor|" or "  - wor|"
  const keyPos = /^(\s*)((?:-[ \t]+)*)([A-Za-z_$][\w$-]*)?$/.exec(before);
  if (!keyPos) return null;
  const word = keyPos[3] ?? "";
  const col = (keyPos[1] as string).length + (keyPos[2] as string).length;
  const dashCol = keyPos[2] ? (keyPos[1] as string).length : -1;
  const path = ancestors(lines, index, col, dashCol);
  const present = siblings(lines, index, col, dashCol);
  if (word) present.delete(word);
  const seen = new Set<string>();
  const options: Suggestion[] = [];
  for (const b of objectBranches(schemasAt(root, path), present)) {
    const required = new Set(b.required ?? []);
    for (const [name, prop] of Object.entries(b.properties ?? {})) {
      if (seen.has(name) || present.has(name) || !name.startsWith(word) || name === "$schema")
        continue;
      seen.add(name);
      const info = prop.description ?? branches(prop).find((x) => x.description)?.description;
      options.push({
        label: name,
        apply: `${name}: `,
        type: "property",
        ...(required.has(name) ? { detail: "required" } : {}),
        ...(info ? { info } : {}),
      });
    }
  }
  // Required properties first, then schema order.
  options.sort((a, b) => Number(b.detail === "required") - Number(a.detail === "required"));
  return options.length ? { from: offset - word.length, options } : null;
}
