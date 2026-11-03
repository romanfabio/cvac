import {
  type Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  parseDocument,
} from "yaml";
import type { z } from "zod";
import type { Diagnostic, Range } from "../diagnostics.ts";

export interface ParseResult<T> {
  /** Present only when there are no errors. */
  value?: T;
  diagnostics: Diagnostic[];
}

export interface ParseOptions {
  /** File name used in diagnostics. */
  file?: string;
}

type Path = (string | number)[];

/** A parsed YAML document plus helpers to map paths back to source ranges. */
export class SourceDoc {
  readonly doc: Document.Parsed;
  readonly file: string | undefined;
  private readonly lines: LineCounter;

  constructor(source: string, file?: string) {
    this.lines = new LineCounter();
    this.doc = parseDocument(source, { lineCounter: this.lines, uniqueKeys: true });
    this.file = file;
  }

  rangeOf(offsets: readonly [number, number, ...number[]] | undefined): Range | undefined {
    if (!offsets) return undefined;
    const s = this.lines.linePos(offsets[0]);
    const e = this.lines.linePos(offsets[1]);
    return { start: { line: s.line, column: s.col }, end: { line: e.line, column: e.col } };
  }

  /**
   * Range for a path. Walks as deep as the document allows; for a missing
   * property it falls back to the key of the deepest existing parent.
   * With `key: true` the property key is highlighted instead of its value.
   */
  locate(path: Path, opts: { key?: boolean } = {}): Range | undefined {
    let node: unknown = this.doc.contents;
    let keyNode: Node | undefined;
    for (const seg of path) {
      if (isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && p.key.value === seg);
        if (!pair) break;
        keyNode = isNode(pair.key) ? pair.key : undefined;
        node = pair.value;
      } else if (isSeq(node) && typeof seg === "number" && node.items[seg] !== undefined) {
        keyNode = undefined;
        node = node.items[seg];
      } else {
        break;
      }
    }
    // Point at the key for whole mappings/lists: underlining every line of
    // a block is noise, the key names what the message is about.
    const container = isMap(node) || isSeq(node);
    const target = (opts.key || container) && keyNode ? keyNode : isNode(node) ? node : keyNode;
    return this.rangeOf(target?.range ?? undefined);
  }

  diag(d: Omit<Diagnostic, "file" | "range">, opts: { key?: boolean } = {}): Diagnostic {
    const out: Diagnostic = { ...d };
    if (this.file !== undefined) out.file = this.file;
    const range = d.path ? this.locate(d.path, opts) : undefined;
    if (range) out.range = range;
    return out;
  }
}

/** Parse YAML and validate it against a zod schema, producing located diagnostics. */
export function parseYamlWith<S extends z.ZodType>(
  schema: S,
  source: string,
  opts: ParseOptions = {},
): { result: ParseResult<z.output<S>>; src: SourceDoc } {
  const src = new SourceDoc(source, opts.file);
  const diagnostics: Diagnostic[] = [];

  for (const err of src.doc.errors) {
    diagnostics.push(
      withFile(
        src,
        {
          code: "yaml-syntax",
          severity: "error",
          message: err.message.split("\n")[0] ?? err.message,
        },
        src.rangeOf(err.pos),
      ),
    );
  }
  for (const warn of src.doc.warnings) {
    diagnostics.push(
      withFile(
        src,
        {
          code: "yaml-warning",
          severity: "warning",
          message: warn.message.split("\n")[0] ?? warn.message,
        },
        src.rangeOf(warn.pos),
      ),
    );
  }
  if (diagnostics.some((d) => d.severity === "error")) return { result: { diagnostics }, src };

  const data: unknown = src.doc.toJS() ?? {};
  // reportInput: issues carry the offending value, needed to tell
  // "missing" apart from "wrong type" and to build helpful messages.
  const parsed = schema.safeParse(data, { reportInput: true });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) diagnostics.push(...issueToDiagnostics(src, issue));
    return { result: { diagnostics }, src };
  }
  return { result: { value: parsed.data, diagnostics }, src };
}

function withFile(src: SourceDoc, d: Diagnostic, range: Range | undefined): Diagnostic {
  if (src.file !== undefined) d.file = src.file;
  if (range) d.range = range;
  return d;
}

function issueToDiagnostics(src: SourceDoc, issue: z.core.$ZodIssue): Diagnostic[] {
  const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
  const where = path.length ? ` at '${formatPath(path)}'` : "";

  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((k) =>
        src.diag(
          {
            code: "unknown-property",
            severity: "error",
            message: `Unknown property '${k}'${where}`,
            path: [...path, k],
          },
          { key: true },
        ),
      );
    case "invalid_type":
      if (issue.input === undefined) {
        const name = path.at(-1);
        return [
          src.diag(
            {
              code: "required",
              severity: "error",
              message: `Missing required property '${String(name)}'${
                path.length > 1 ? ` in '${formatPath(path.slice(0, -1))}'` : ""
              }`,
              path,
            },
            { key: true },
          ),
        ];
      }
      return [
        src.diag({
          code: "invalid-type",
          severity: "error",
          message: `Expected ${issue.expected}, got ${describe(issue.input)}${where}`,
          path,
        }),
      ];
    case "invalid_union":
      if ("discriminator" in issue && issue.discriminator) {
        return [
          src.diag({
            code: "invalid-discriminator",
            severity: "error",
            message: `Invalid '${issue.discriminator}'${where}${
              issue.input !== undefined ? `: ${JSON.stringify(issue.input)}` : ""
            }`,
            path: [...path, issue.discriminator],
          }),
        ];
      }
      return [unionDiagnostic(src, issue, path, where)];
    default:
      return [
        src.diag({
          code: "invalid-value",
          severity: "error",
          message: `${issue.message}${where}`,
          path,
        }),
      ];
  }
}

/**
 * Union failures are mostly LocalizedText (string or language map). The
 * classic trap: an unquoted "Label: value" in YAML becomes a mapping.
 */
function unionDiagnostic(
  src: SourceDoc,
  issue: z.core.$ZodIssueInvalidUnion,
  path: (string | number)[],
  where: string,
): Diagnostic {
  const input = issue.input;
  const badKey = issue.errors
    .flat()
    .find((e) => e.code === "invalid_key")
    ?.path.find((p): p is string => typeof p === "string");
  if (
    badKey !== undefined &&
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const quoteHint = /\s/.test(badKey)
      ? ` If this is text containing ": ", wrap it in quotes: "${badKey}: ..."`
      : "";
    return src.diag({
      code: "invalid-text",
      severity: "error",
      message: `Expected text or a language map like { en: ..., it: ... }, but '${badKey}' is not a language code${where}.${quoteHint}`,
      path,
    });
  }
  if (issue.errors.flat().every((e) => e.code === "invalid_type") && input !== undefined) {
    return src.diag({
      code: "invalid-type",
      severity: "error",
      message: `Unexpected ${describe(input)}${where}`,
      path,
    });
  }
  const specific = issue.errors
    .flat()
    .filter((e) => e.code !== "invalid_type")
    .map((e) => e.message);
  return src.diag({
    code: "invalid-value",
    severity: "error",
    message: `${specific[0] ?? issue.message}${where}`,
    path,
  });
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "mapping";
  return `${typeof v} ${JSON.stringify(v)}`;
}

export function formatPath(path: Path): string {
  return path.reduce<string>(
    (acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg),
    "",
  );
}
