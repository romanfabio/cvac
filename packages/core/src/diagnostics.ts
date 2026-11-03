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
