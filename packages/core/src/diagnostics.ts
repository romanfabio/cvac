/** 1-based line/column position in a source file. */
export interface Position {
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type Severity = "error" | "warning" | "info";

/**
 * A problem found in user input. Shared by the CLI (printed) and the web
 * editor (Monaco markers), so it must stay serializable.
 */
export interface Diagnostic {
  /** Stable machine-readable code, e.g. `required`, `unknown-property`. */
  code: string;
  severity: Severity;
  message: string;
  /** File name as given by the caller (no fs access in core). */
  file?: string;
  range?: Range;
  /** Path into the document, e.g. `["sections", 0, "items", 2, "role"]`. */
  path?: (string | number)[];
  /** Which input the path refers to. */
  origin?: "content" | "theme";
  /** How to fix it, shown under the message. */
  help?: string;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** `file:line:col: severity [code] message`, the conventional compiler format. */
export function formatDiagnostic(d: Diagnostic): string {
  const loc = [d.file ?? "<input>", d.range?.start.line, d.range?.start.column]
    .filter((p) => p !== undefined)
    .join(":");
  return `${loc}: ${d.severity} [${d.code}] ${d.message}`;
}

/**
 * Same problem reported by several builds (e.g. pdf + docx) is printed once,
 * and everything is sorted in source order (file, line, column; problems
 * without a location last), like a compiler.
 */
export function sortDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const unique = diags.filter((d) => {
    const key = JSON.stringify([d.severity, d.code, d.message, d.file, d.range?.start, d.path]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = (d: Diagnostic): [number, string, number, number] => [
    d.file === undefined ? 1 : 0,
    d.file ?? "",
    d.range?.start.line ?? Number.MAX_SAFE_INTEGER,
    d.range?.start.column ?? 0,
  ];
  return unique
    .map((d, i) => ({ d, i, r: rank(d) }))
    .sort((a, b) => {
      for (let k = 0; k < 4; k++) {
        const x = a.r[k] as number | string;
        const y = b.r[k] as number | string;
        if (x !== y) return x < y ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.d);
}
