import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDocx,
  buildPdf,
  parseContent,
  parseTheme,
  STARTER_CV,
  STARTER_THEME,
} from "@cvac/core";
import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "../../../packages/fonts/src/index.ts";
import { type BuildRequest, runBuild } from "../src/engine.ts";

const fonts = loadBundledFonts();
const req = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  id: 1,
  format: "pdf",
  cv: STARTER_CV,
  theme: STARTER_THEME,
  assets: {},
  ...over,
});

describe("web build engine", () => {
  it("produces exactly what the core (and so the CLI) produces", async () => {
    const r = await runBuild(req(), fonts);
    expect(r.diagnostics).toEqual([]);
    const cv = parseContent(STARTER_CV).value;
    const theme = parseTheme(STARTER_THEME).value;
    if (!cv || !theme) throw new Error("starter files must parse");
    const direct = await buildPdf(cv, { fonts, theme });
    expect(r.bytes).toEqual(direct.pdf);
    expect(r.pages).toBe(1);

    const docx = await runBuild(req({ format: "docx", locale: "it" }), fonts);
    expect(docx.bytes).toEqual((await buildDocx(cv, { fonts, theme, locale: "it" })).docx);
  });

  it("reports what the toolbar needs", async () => {
    const r = await runBuild(req(), fonts);
    expect(r).toMatchObject({ locales: ["en", "it"], variants: [] });
    expect(r.photo).toBeUndefined();
  });

  it("locates problems in either file and withholds the output", async () => {
    const r = await runBuild(
      req({
        cv: STARTER_CV.replace("  name: Your Name", "  nmae: Your Name"),
        theme: "extends: fancy\n",
      }),
      fonts,
    );
    expect(r.bytes).toBeUndefined();
    expect(r.diagnostics.map((d) => [d.file, d.code, d.range?.start.line])).toEqual(
      expect.arrayContaining([["cv.yaml", "unknown-property", expect.any(Number)]]),
    );
  });

  it("locates theme-resolution errors in theme.yaml", async () => {
    const r = await runBuild(req({ theme: "extends: fancy\n" }), fonts);
    expect(r.diagnostics).toMatchObject([
      { code: "unknown-theme", file: "theme.yaml", range: { start: { line: 1 } } },
    ]);
  });

  it("includes lint findings, like cvac build", async () => {
    const r = await runBuild(
      req({ cv: STARTER_CV.replace('  phone: "+39 000 000 0000"\n', "") }),
      fonts,
    );
    expect(r.bytes).toBeDefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(["lint/missing-phone"]);
  });

  it("an empty theme means the default theme", async () => {
    const r = await runBuild(req({ theme: "  \n" }), fonts);
    expect(r.diagnostics).toEqual([]);
    expect(r.bytes).toBeDefined();
  });

  it("uses uploaded photos", async () => {
    const FIX = join(import.meta.dirname, "..", "..", "..", "fixtures", "sidebar");
    const cv = readFileSync(join(FIX, "cv.yaml"), "utf8");
    const missing = await runBuild(req({ cv, theme: "extends: sidebar\n" }), fonts);
    expect(missing.photo).toBe("photo.jpg");
    expect(missing.diagnostics.map((d) => d.code)).toContain("photo-not-found");
    const withPhoto = await runBuild(
      req({
        cv,
        theme: "extends: sidebar\n",
        assets: { "photo.jpg": new Uint8Array(readFileSync(join(FIX, "photo.jpg"))) },
      }),
      fonts,
    );
    expect(withPhoto.bytes).toBeDefined();
  });
});
