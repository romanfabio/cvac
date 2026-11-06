import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

/**
 * Where the site is served from: `/` by default, `/cvac/` for a GitHub
 * Pages project site (the deploy workflow sets CVAC_BASE). Asset, worker
 * and font URLs all follow it.
 */
const trimmed = (process.env.CVAC_BASE ?? "").replace(/^\/+|\/+$/g, "");
const BASE = trimmed ? `/${trimmed}/` : "/";

/**
 * Content-Security-Policy of the built page. The editor never sends data
 * anywhere, and this lets the browser enforce it: the page may load and
 * fetch only its own files (`connect-src 'self'`), and cannot submit forms
 * or embed plugins. Styles allow inline because CodeMirror injects its own.
 *
 * A <meta> policy covers the page (static hosts such as GitHub Pages cannot
 * set headers). It does not reach the build worker, which gets its policy
 * from its own response headers; a host that can set headers should send
 * this same policy for every file.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Production only: Vite's dev server relies on inline scripts and a websocket. */
function csp(): Plugin {
  return {
    name: "cvac-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

/**
 * Third-party notices. The built site contains code from npm packages whose
 * licenses (MIT, Apache-2.0, ...) require their notices to travel with it,
 * and the bundled fonts' OFL. Every package that ends up in the page or the
 * worker bundle is collected and listed in `licenses.txt`, with its license
 * text, linked from the editor's footer.
 */
const bundledPackages = new Set<string>();
const FONTS_DIR = fileURLToPath(new URL("../../packages/fonts/files", import.meta.url));

/** The npm package directory a bundled module comes from, if any. */
function packageDir(id: string): string | undefined {
  const path = id.replace(/^\0/, "").replace(/\?.*$/, "").replace(/\\/g, "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  return name ? `${path.slice(0, at)}/node_modules/${name}` : undefined;
}

/** Records the npm packages in a bundle (the page's, and the worker's). */
function collectLicenses(): Plugin {
  return {
    name: "cvac-collect-licenses",
    apply: "build",
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        for (const id of out.moduleIds) {
          const dir = packageDir(id);
          if (dir) bundledPackages.add(dir);
        }
      }
    },
  };
}

function noticeFor(dir: string): string {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string;
    repository?: string | { url?: string };
  };
  const files = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f))
    .sort();
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const head = [
    `${pkg.name} ${pkg.version}`,
    `License: ${pkg.license ?? "see below"}`,
    ...(repo ? [`Source: ${repo.replace(/^git\+/, "")}`] : []),
  ];
  const texts = files.map((f) => readFileSync(join(dir, f), "utf8").trim());
  return [...head, "", ...(texts.length ? texts : ["(No license file in the package.)"])].join(
    "\n",
  );
}

/** Writes licenses.txt next to index.html. */
function licensesFile(): Plugin {
  return {
    name: "cvac-licenses-file",
    apply: "build",
    generateBundle() {
      // The worker bundle is built while the page is transformed, so its
      // packages are already collected here.
      // Keyed by "name version": nested copies of one version are listed once.
      const notices = new Map<string, string>();
      for (const dir of bundledPackages) {
        if (!existsSync(join(dir, "package.json"))) continue;
        const notice = noticeFor(dir);
        notices.set(notice.slice(0, notice.indexOf("\n")), notice);
      }
      const packages = [...notices.values()].sort((a, b) =>
        a.toLowerCase() < b.toLowerCase() ? -1 : 1,
      );
      const fonts = readdirSync(FONTS_DIR)
        .sort()
        .map((family) => {
          const ofl = readFileSync(join(FONTS_DIR, family, "OFL.txt"), "utf8").trim();
          return `Font: ${family}\nLicense: OFL-1.1\n\n${ofl}`;
        });
      const rule = `\n\n${"=".repeat(78)}\n\n`;
      const intro = [
        "CV as Code (cvac) web editor: third-party notices",
        "",
        "cvac itself is MIT-licensed: https://github.com/romanfabio/cvac/blob/main/LICENSE",
        "This site also contains the following fonts and npm packages, under their own licenses.",
      ].join("\n");
      this.emitFile({
        type: "asset",
        fileName: "licenses.txt",
        source: `${[intro, ...fonts, ...packages].join(rule)}\n`,
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), csp(), collectLicenses(), licensesFile()],
  // Workspace packages expose their TypeScript sources under the "source"
  // condition, so the app always runs the current core (no stale dist).
  resolve: { conditions: ["source", ...defaultClientConditions] },
  worker: { format: "es", plugins: () => [collectLicenses()] },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
  server: { port: 5173, strictPort: true },
});
