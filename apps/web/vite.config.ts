import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  plugins: [react(), csp()],
  // Workspace packages expose their TypeScript sources under the "source"
  // condition, so the app always runs the current core (no stale dist).
  resolve: { conditions: ["source", ...defaultClientConditions] },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
  server: { port: 5173, strictPort: true },
});
