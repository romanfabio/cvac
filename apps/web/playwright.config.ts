import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
/** The site's base path, as built (CVAC_BASE, e.g. /cvac/ for GitHub Pages). */
const trimmed = (process.env.CVAC_BASE ?? "").replace(/^\/+|\/+$/g, "");
const BASE = trimmed ? `/${trimmed}/` : "/";

/**
 * End-to-end tests of the production build (`vite build` + `vite preview`),
 * run with `npm run e2e` after `npm run build`. They use the installed Google
 * Chrome (present on GitHub runners), so no browser download is needed.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Tests navigate to "./", which resolves inside the base path.
    baseURL: `http://localhost:${PORT}${BASE}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
  },
});
