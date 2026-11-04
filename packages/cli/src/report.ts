import { styleText } from "node:util";
import { type Diagnostic, sortDiagnostics } from "@cvac/core";

type Style = Parameters<typeof styleText>[0];

/** Output sink, injectable for tests. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Colorize for the error stream (no-op when not a TTY or NO_COLOR). */
  color(style: Style, text: string): string;
}

export const processIo: Io = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  color: (style, text) => styleText(style, text, { stream: process.stderr }),
};

const SEVERITY_STYLE: Record<Diagnostic["severity"], Style> = {
  error: ["bold", "red"],
  warning: ["bold", "yellow"],
  info: ["bold", "cyan"],
};

/**
 * Compiler-style diagnostics with a source excerpt:
 *
 *   error[unknown-property]: Unknown property 'nmae' at 'basics'
 *     --> cv.yaml:5:3
 *      |
 *    5 |   nmae: typo
 *      |   ^^^^
 */
export function printDiagnostics(diags: Diagnostic[], sources: Map<string, string>, io: Io): void {
  for (const d of diags) {
    io.err(
      `${io.color(SEVERITY_STYLE[d.severity], `${d.severity === "info" ? "note" : d.severity}[${d.code}]`)}: ${io.color("bold", d.message)}`,
    );
    if (d.file === undefined) {
      help(d, io);
      io.err("");
      continue;
    }
    if (!d.range) {
      io.err(`  ${io.color("blue", "-->")} ${d.file}`);
      help(d, io);
      io.err("");
      continue;
    }
    const { start, end } = d.range;
    io.err(`  ${io.color("blue", "-->")} ${d.file}:${start.line}:${start.column}`);
    const line = sources.get(d.file)?.split(/\r?\n/)[start.line - 1];
    if (line !== undefined) {
      const gutter = String(start.line).length;
      const bar = io.color("blue", `${" ".repeat(gutter + 1)}|`);
      const width =
        end.line === start.line
          ? Math.max(1, end.column - start.column)
          : Math.max(1, line.length - start.column + 1);
      io.err(bar);
      io.err(`${io.color("blue", `${start.line} |`)} ${line}`);
      io.err(
        `${bar} ${" ".repeat(start.column - 1)}${io.color(SEVERITY_STYLE[d.severity], "^".repeat(width))}`,
      );
    }
    help(d, io);
    io.err("");
  }
}

function help(d: Diagnostic, io: Io): void {
  if (d.help) io.err(`  ${io.color("cyan", "= help:")} ${d.help}`);
}

export function summarize(diags: Diagnostic[]): string {
  const n = (sev: Diagnostic["severity"]) => diags.filter((d) => d.severity === sev).length;
  const parts: string[] = [];
  const e = n("error");
  const w = n("warning");
  const i = n("info");
  if (e) parts.push(`${e} error${e === 1 ? "" : "s"}`);
  if (w) parts.push(`${w} warning${w === 1 ? "" : "s"}`);
  if (i) parts.push(`${i} note${i === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** See `sortDiagnostics` in core. */
export const dedupe = sortDiagnostics;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
