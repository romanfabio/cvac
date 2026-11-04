import type { FontSet } from "@cvac/core";
import { BUNDLED_FACES } from "@cvac/fonts/faces";
import { type BuildRequest, runBuild } from "./engine.ts";

// Font files are bundled as assets and fetched once per worker.
const urls = import.meta.glob("../../../packages/fonts/files/source-sans-3/*.ttf", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

let fonts: Promise<FontSet> | undefined;
function loadFonts(): Promise<FontSet> {
  fonts ??= Promise.all(
    BUNDLED_FACES.map(async ([family, weight, italic, file]) => {
      const name = file.split("/").pop() as string;
      const url = Object.entries(urls).find(([k]) => k.endsWith(`/${name}`))?.[1];
      if (!url) throw new Error(`Font ${file} is not bundled`);
      const res = await fetch(url);
      return { family, weight, italic, data: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
  return fonts;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = async (e) => {
  const result = await runBuild(e.data, await loadFonts());
  ctx.postMessage(result, result.bytes ? [result.bytes.buffer as ArrayBuffer] : []);
};
