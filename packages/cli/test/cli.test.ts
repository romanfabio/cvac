import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDate, parseFormats, parseLangs, planTargets } from "../src/commands/build.ts";
import { STARTER_CV, STARTER_THEME } from "../src/commands/init.ts";
import { startWatch } from "../src/commands/watch.ts";
import { main } from "../src/main.ts";
import type { Io } from "../src/report.ts";

/** Captures output; no colors so assertions see plain text. */
function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l), color: (_s, t) => t };
  return { io, out, err, text: () => [...out, ...err].join("\n") };
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

let dir: string;
let cwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cvac-cli-"));
  cwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const run = async (...argv: string[]) => {
  const c = captureIo();
  const code = await main(argv, c.io);
  return { code, ...c };
};

describe("cvac init", () => {
  it("creates a starter CV, theme and schemas that build cleanly", async () => {
    const init = await run("init");
    expect(init.code).toBe(0);
    for (const f of [
      "cv.yaml",
      "theme.yaml",
      ".cvac/schemas/cv.schema.json",
      ".cvac/schemas/theme.schema.json",
    ]) {
      expect(existsSync(f), f).toBe(true);
    }
    expect(readFileSync("cv.yaml", "utf8")).toBe(STARTER_CV);

    const v = await run("validate", "--lang", "en,it");
    expect(v.code, v.text()).toBe(0);
    expect(v.text()).toContain("✔ cv.yaml + theme.yaml valid");
    expect(v.text()).not.toContain("warning");
  });

  it("refuses to overwrite without --force", async () => {
    writeFileSync("cv.yaml", "x");
    const r = await run("init");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("cv.yaml already exists. Use --force");
    expect(readFileSync("cv.yaml", "utf8")).toBe("x");
    expect((await run("init", "--force")).code).toBe(0);
    expect(readFileSync("theme.yaml", "utf8")).toBe(STARTER_THEME);
  });

  it("can target another directory", async () => {
    expect((await run("init", "my-cv")).code).toBe(0);
    expect(existsSync(join("my-cv", "cv.yaml"))).toBe(true);
  });
});

describe("cvac build", () => {
  beforeEach(async () => {
    await run("init");
  });

  it("builds a PDF next to the CV by default", async () => {
    const r = await run("build");
    expect(r.code, r.text()).toBe(0);
    expect(r.out).toEqual([expect.stringMatching(/^✔ cv\.pdf \(1 page, \d+ KB\)$/)]);
    expect(readFileSync("cv.pdf").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("builds every format x language combination, byte-identically", async () => {
    const r = await run("build", "--format", "all", "--lang", "en,it");
    expect(r.code, r.text()).toBe(0);
    const files = ["cv.en.pdf", "cv.en.docx", "cv.it.pdf", "cv.it.docx"];
    for (const f of files) expect(existsSync(f), f).toBe(true);
    const before = files.map(sha);
    expect((await run("build", "-f", "all", "-l", "en,it")).code).toBe(0);
    expect(files.map(sha)).toEqual(before);
  });

  it("honours SOURCE_DATE_EPOCH and --date", async () => {
    await run("build", "-o", "default.pdf");
    process.env.SOURCE_DATE_EPOCH = "1700000000";
    try {
      await run("build", "-o", "epoch.pdf");
    } finally {
      delete process.env.SOURCE_DATE_EPOCH;
    }
    await run("build", "-o", "flag.pdf", "--date", "2023-11-14T22:13:20Z");
    expect(sha("epoch.pdf")).not.toBe(sha("default.pdf"));
    expect(sha("flag.pdf")).toBe(sha("epoch.pdf"));
  });

  it("can skip DOCX font embedding", async () => {
    await run("build", "-f", "docx", "-o", "embedded.docx");
    await run("build", "-f", "docx", "-o", "small.docx", "--no-embed-fonts");
    expect(readFileSync("small.docx").length).toBeLessThan(
      readFileSync("embedded.docx").length / 10,
    );
  });

  it("writes into a directory when -o names one or there are several outputs", async () => {
    const r = await run("build", "-f", "pdf,docx", "-o", "out");
    expect(r.code, r.text()).toBe(0);
    expect(existsSync(join("out", "cv.pdf")) && existsSync(join("out", "cv.docx"))).toBe(true);
  });

  it("reports located errors, writes nothing and exits 1", async () => {
    writeFileSync("cv.yaml", "basics:\n  name: Jane\n  emial: j@example.com\n");
    const r = await run("build");
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain(
      [
        "error[unknown-property]: Unknown property 'emial' at 'basics'",
        "  --> cv.yaml:3:3",
        "  |",
        "3 |   emial: j@example.com",
        "  |   ^^^^^",
      ].join("\n"),
    );
    expect(r.text()).toContain("✘ build failed: 1 error");
    expect(existsSync("cv.pdf")).toBe(false);
  });

  it("locates errors in the theme file too", async () => {
    writeFileSync("theme.yaml", "extends: fancy\n");
    const r = await run("build");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("error[unknown-theme]: Unknown base theme 'fancy'");
    expect(r.text()).toContain("--> theme.yaml:1:10");
  });

  it("picks up theme.yaml next to the CV, or an explicit --theme", async () => {
    writeFileSync("theme.yaml", "page: { size: Letter }\n");
    writeFileSync("a4.yaml", "page: { size: A4 }\n");
    await run("build", "-o", "letter.pdf");
    await run("build", "-o", "a4.pdf", "--theme", "a4.yaml");
    const mediaBox = (f: string) =>
      /\/MediaBox \[([^\]]+)\]/.exec(readFileSync(f, "latin1"))?.[1]?.trim();
    expect(mediaBox("letter.pdf")).toBe("0 0 612 792");
    expect(mediaBox("a4.pdf")).toBe("0 0 595.28 841.89");
  });

  it("warns once about a language the CV is not written in", async () => {
    const r = await run("build", "--lang", "de");
    expect(r.code).toBe(0);
    expect(r.err.filter((l) => l.startsWith("warning"))).toEqual([
      "warning[undeclared-locale]: 'de' is not one of this CV's languages (en, it); texts fall back to 'en'",
    ]);
  });

  it("explains missing files", async () => {
    const r = await run("build", "missing.yaml");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("Cannot find missing.yaml. Run `cvac init`");
  });

  it("rejects bad usage with exit code 2", async () => {
    expect((await run("build", "-f", "odt")).code).toBe(2);
    expect((await run("build", "--date", "yesterday")).code).toBe(2);
    expect((await run("build", "--nope")).code).toBe(2);
  });
});

describe("cvac watch", () => {
  it("rebuilds when the CV changes", async () => {
    await run("init");
    const c = captureIo();
    const handle = await startWatch(undefined, {}, c.io, { debounceMs: 50 });
    try {
      const first = sha("cv.pdf");
      writeFileSync(
        "cv.yaml",
        readFileSync("cv.yaml", "utf8").replace("Your Name", "Changed Name"),
      );
      // fs events can lag a little, poll until the rebuild lands.
      for (let i = 0; i < 50 && sha("cv.pdf") === first; i++) await handle.idle();
      expect(sha("cv.pdf")).not.toBe(first);
      expect(c.out.filter((l) => l.startsWith("✔ cv.pdf")).length).toBeGreaterThanOrEqual(2);
    } finally {
      handle.close();
    }
  });
});

describe("option parsing", () => {
  it("parses formats, languages and dates", () => {
    expect(parseFormats(undefined)).toEqual(["pdf"]);
    expect(parseFormats("all")).toEqual(["pdf", "docx"]);
    expect(parseFormats("DOCX, pdf,docx")).toEqual(["docx", "pdf"]);
    expect(parseLangs("en, it,en")).toEqual(["en", "it"]);
    expect(parseDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(parseDate(undefined, { SOURCE_DATE_EPOCH: "0" })?.getTime()).toBe(0);
    expect(parseDate(undefined, {})).toBeUndefined();
  });

  it("plans output paths", () => {
    const cv = join(dir, "cv.yaml");
    expect(planTargets(cv, ["pdf"], [undefined]).map((t) => t.path)).toEqual([join(dir, "cv.pdf")]);
    expect(planTargets(cv, ["pdf"], ["it"]).map((t) => t.path)).toEqual([join(dir, "cv.it.pdf")]);
    expect(planTargets(cv, ["pdf"], [undefined], "x/me.pdf").map((t) => t.path)).toEqual([
      join(dir, "x", "me.pdf"),
    ]);
  });
});
