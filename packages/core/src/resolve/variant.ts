import type { Diagnostic } from "../diagnostics.ts";
import type { Content, Variant } from "../model/content.ts";

type Path = (string | number)[];

export interface VariantResolution {
  /** The CV with only what this variant includes (unchanged without a variant). */
  content: Content;
  /** Variant name, if one was selected. */
  name: string | undefined;
  diagnostics: Diagnostic[];
  /**
   * Map a path in `content` back to the original document, so diagnostics
   * computed on the filtered CV point at the right place in the YAML.
   */
  mapPath(path: Path): Path;
}

/**
 * Select a variant. `name` is a variant from `meta.variants`, or else a tag
 * (`--variant backend` keeps untagged items plus those tagged `backend`).
 *
 * An element with tags is kept when it has at least one of the variant's
 * tags (or the variant lists none) and none of its `exclude` tags. Untagged
 * elements are always kept. Applies to sections, items and bullet points.
 */
export function resolveVariant(content: Content, name: string | undefined): VariantResolution {
  const identity: VariantResolution = {
    content,
    name: undefined,
    diagnostics: [],
    mapPath: (p) => p,
  };
  if (name === undefined) return identity;

  const named = content.meta?.variants?.[name];
  const used = usedTags(content);
  if (!named && !used.has(name)) {
    const variants = Object.keys(content.meta?.variants ?? {});
    return {
      ...identity,
      diagnostics: [
        {
          code: "unknown-variant",
          severity: "error",
          message: `No variant or tag named '${name}'`,
          help: `${variants.length ? `Variants: ${variants.join(", ")}. ` : ""}${used.size ? `Tags: ${[...used].sort().join(", ")}.` : "No item has tags yet: add tags: [...] to items or define meta.variants."}`,
        },
      ],
    };
  }

  const v: Variant = named ?? { tags: [name] };
  const keep = (tags: string[] | undefined) => {
    if (!tags?.length) return true;
    if (v.exclude?.some((t) => tags.includes(t))) return false;
    return !v.tags?.length || v.tags.some((t) => tags.includes(t));
  };

  const indexMaps = new Map<string, number[]>();
  const overrides: [Path, Path][] = [];
  const key = (p: Path) => JSON.stringify(p);

  // Sections: explicit selection/order, then tag filtering.
  const byId = (s: Content["sections"][number]) => s.id ?? s.type;
  const order: number[] = v.sections
    ? v.sections.flatMap((id) => {
        const i = content.sections.findIndex((s) => byId(s) === id);
        return i >= 0 ? [i] : [];
      })
    : content.sections.map((_, i) => i);
  const sectionIdx = order.filter((i) =>
    keep((content.sections[i] as Content["sections"][number]).tags),
  );
  indexMaps.set(key(["sections"]), sectionIdx);

  const sections = sectionIdx.map((si, k) => {
    const s = content.sections[si] as Content["sections"][number];
    const itemIdx = s.items
      .map((_, i) => i)
      .filter((i) => keep((s.items[i] as { tags?: string[] }).tags));
    indexMaps.set(key(["sections", k, "items"]), itemIdx);
    const items = itemIdx.map((ii, m) => {
      const it = s.items[ii] as Record<string, unknown> & { highlights?: unknown[] };
      if (!it.highlights) return it;
      const hIdx = it.highlights
        .map((_, i) => i)
        .filter((i) => {
          const h = it.highlights?.[i];
          return keep(
            typeof h === "object" && h !== null && "text" in h
              ? (h as { tags?: string[] }).tags
              : undefined,
          );
        });
      indexMaps.set(key(["sections", k, "items", m, "highlights"]), hIdx);
      return { ...it, highlights: hIdx.map((i) => it.highlights?.[i]) };
    });
    return { ...s, items } as typeof s;
  });

  const basics = { ...content.basics };
  if (named && v.title !== undefined) {
    basics.title = v.title;
    overrides.push([
      ["basics", "title"],
      ["meta", "variants", name, "title"],
    ]);
  }
  if (named && v.summary !== undefined) {
    basics.summary = v.summary;
    overrides.push([
      ["basics", "summary"],
      ["meta", "variants", name, "summary"],
    ]);
  }

  const mapPath = (path: Path): Path => {
    for (const [from, to] of overrides) {
      if (from.every((seg, i) => path[i] === seg)) return [...to, ...path.slice(from.length)];
    }
    const out: Path = [];
    for (let i = 0; i < path.length; i++) {
      const seg = path[i] as string | number;
      const map = typeof seg === "number" ? indexMaps.get(key(path.slice(0, i))) : undefined;
      out.push(map ? (map[seg as number] ?? seg) : seg);
    }
    return out;
  };

  return { content: { ...content, basics, sections }, name, diagnostics: [], mapPath };
}

/** All tags used on sections, items and bullet points. */
export function usedTags(content: Content): Set<string> {
  const tags = new Set<string>();
  const add = (t: string[] | undefined) => {
    for (const x of t ?? []) tags.add(x);
  };
  for (const s of content.sections) {
    add(s.tags);
    for (const it of s.items as { tags?: string[]; highlights?: unknown[] }[]) {
      add(it.tags);
      for (const h of it.highlights ?? []) {
        if (typeof h === "object" && h !== null && "text" in h)
          add((h as { tags?: string[] }).tags);
      }
    }
  }
  return tags;
}

/** Apply `mapPath` to content-origin diagnostics. */
export function mapDiagnostics(diags: Diagnostic[], v: VariantResolution): Diagnostic[] {
  if (!v.name) return diags;
  return diags.map((d) =>
    d.origin === "content" && d.path ? { ...d, path: v.mapPath(d.path) } : d,
  );
}
