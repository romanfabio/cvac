import PDFKitDefault from "pdfkit";

/**
 * pdfkit ships two builds that write different bytes for the same document:
 * the Node build compresses streams with Node's zlib (whose output depends
 * on the zlib version, and Chromium's zlib fork may vary with CPU features),
 * the browser build with fflate (pure JavaScript, the same everywhere).
 *
 * To keep output byte-identical across Node versions, machines and the web
 * editor, cvac always uses the browser build. It has no browser-only code.
 * Browsers and bundlers resolve "pdfkit" to it already; in Node it is loaded
 * by file URL from next to the Node build (the package's exports map does
 * not list it, but plain file URLs are not subject to it).
 */
type PDFKitConstructor = typeof PDFKitDefault;

let loaded: Promise<PDFKitConstructor> | undefined;

export function loadPdfKit(): Promise<PDFKitConstructor> {
  loaded ??= isNode() ? loadBrowserBuild() : Promise.resolve(PDFKitDefault);
  return loaded;
}

function isNode(): boolean {
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof p?.versions?.node === "string";
}

async function loadBrowserBuild(): Promise<PDFKitConstructor> {
  const nodeBuild = import.meta.resolve("pdfkit");
  const url = new URL("pdfkit.browser.mjs", nodeBuild).href;
  const mod = (await import(/* @vite-ignore */ url)) as { default: PDFKitConstructor };
  return mod.default;
}

/** Which build is in use (for tests and diagnostics). */
export async function pdfKitBuild(): Promise<"browser" | "node"> {
  const ctor = await loadPdfKit();
  return ctor === PDFKitDefault && isNode() ? "node" : "browser";
}
