import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against workspace sources, never a stale dist build.
    alias: {
      "@cvac/core": src("core"),
      "@cvac/fonts": src("fonts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
