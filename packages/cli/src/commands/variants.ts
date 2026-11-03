import { hasErrors, usedTags } from "@cvac/core";
import { loadInputs } from "../inputs.ts";
import { type Io, printDiagnostics } from "../report.ts";

/** List named variants and every tag in use, with how often it is used. */
export function runVariants(cv: string | undefined, io: Io): number {
  const inputs = loadInputs(cv, undefined);
  if (!inputs.content || hasErrors(inputs.diagnostics)) {
    printDiagnostics(inputs.diagnostics, inputs.sources, io);
    return 1;
  }
  const content = inputs.content;
  const variants = Object.entries(content.meta?.variants ?? {});
  if (variants.length) {
    io.out("Variants:");
    const width = Math.max(...variants.map(([n]) => n.length));
    for (const [name, v] of variants) {
      const parts = [
        v.tags?.length ? `tags: ${v.tags.join(", ")}` : "",
        v.exclude?.length ? `exclude: ${v.exclude.join(", ")}` : "",
        v.sections?.length ? `sections: ${v.sections.join(", ")}` : "",
      ].filter(Boolean);
      io.out(
        `  ${name.padEnd(width)}  ${[v.description, parts.join("; ")].filter(Boolean).join("  ·  ")}`,
      );
    }
  } else {
    io.out("No named variants (add meta.variants to cv.yaml).");
  }

  const counts = new Map<string, number>();
  const count = (tags: string[] | undefined) => {
    for (const t of tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  };
  for (const s of content.sections) {
    count(s.tags);
    for (const it of s.items as { tags?: string[]; highlights?: unknown[] }[]) {
      count(it.tags);
      for (const h of it.highlights ?? []) {
        if (typeof h === "object" && h !== null && "text" in h)
          count((h as { tags?: string[] }).tags);
      }
    }
  }
  io.out("");
  if (usedTags(content).size) {
    io.out("Tags (usable as --variant <tag>):");
    for (const [t, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      io.out(`  ${t} (${n})`);
    }
  } else {
    io.out("No tags yet: add tags: [backend] to sections, items or bullets.");
  }
  return 0;
}
