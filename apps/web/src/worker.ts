import type { FontFace } from "@cvac/core";
import { BUNDLED_FACES } from "@cvac/fonts/faces";
import { type BuildRequest, runBuild } from "./engine.ts";

// Font files are bundled as assets; each family is fetched the first time a
// theme uses it, then kept for the life of the worker.
const urls = import.meta.glob("../../../packages/fonts/files/*/*.ttf", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const families = new Map<string, Promise<FontFace[]>>();

function loadFamily(family: string): Promise<FontFace[]> {
  let p = families.get(family);
  if (!p) {
    p = Promise.all(
      BUNDLED_FACES.filter(([f]) => f === family).map(async ([, weight, italic, file]) => {
        const url = Object.entries(urls).find(([k]) => k.endsWith(`/files/${file}`))?.[1];
        if (!url) throw new Error(`Font ${file} is not bundled`);
        const res = await fetch(url);
        return { family, weight, italic, data: new Uint8Array(await res.arrayBuffer()) };
      }),
    );
    families.set(family, p);
  }
  return p;
}

/** Faces of the requested families, in bundle order (unknown families load nothing). */
async function loadFonts(wanted: string[]): Promise<FontFace[]> {
  const known = [...new Set(BUNDLED_FACES.map(([f]) => f))];
  const lower = new Set(wanted.map((f) => f.toLowerCase()));
  const sets = await Promise.all(
    known.filter((f) => lower.has(f.toLowerCase())).map((f) => loadFamily(f)),
  );
  return sets.flat();
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = async (e) => {
  const result = await runBuild(e.data, loadFonts);
  ctx.postMessage(result, result.bytes ? [result.bytes.buffer as ArrayBuffer] : []);
};
