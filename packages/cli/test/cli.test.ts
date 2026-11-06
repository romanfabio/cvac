import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  // The real path: on macOS the temp folder is under /var, a symlink to
  // /private/var, and process.cwd() (used to resolve --out) reports the latter.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cvac-cli-")));
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
    const files = ["en", "it"].flatMap((l) =>
      ["pdf", "docx", "md", "txt"].map((f) => `cv.${l}.${f}`),
    );
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

  it("builds Markdown and plain text", async () => {
    const r = await run("build", "-f", "md,txt", "--lang", "it");
    expect(r.code, r.text()).toBe(0);
    const md = readFileSync("cv.it.md", "utf8");
    expect(md).toMatch(/^# .+\n/);
    expect(md).toContain("\n## Esperienza\n");
    const txt = readFileSync("cv.it.txt", "utf8");
    expect(txt).toContain("\nEsperienza\n----------\n");
    expect(md.endsWith("\n") && !md.includes("\r")).toBe(true);
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
    expect(parseFormats("all")).toEqual(["pdf", "docx", "md", "txt"]);
    expect(parseFormats("md,TXT")).toEqual(["md", "txt"]);
    expect(() => parseFormats("html")).toThrow(/Unknown format 'html'/);
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

describe("cvac lint", () => {
  beforeEach(async () => {
    await run("init");
  });

  it("passes the starter CV in every language", async () => {
    const r = await run("lint", "--lang", "en,it");
    expect(r.code, r.text()).toBe(0);
    expect(r.out).toEqual(["✔ cv.yaml: no problems found"]);
  });

  it("reports located findings with help, in source order", async () => {
    writeFileSync(
      "cv.yaml",
      [
        "basics:",
        "  name: Jane 🚀",
        "  email: j@example.com",
        "sections:",
        "  - type: experience",
        "    title: My Journey",
        "    items: [{ company: A, role: B, start: 2022, end: 2021 }]",
        "",
      ].join("\n"),
    );
    const r = await run("lint");
    expect(r.code).toBe(1);
    const headers = r.err.filter((l) => /^(error|warning|note)\[/.test(l));
    expect(headers).toEqual([
      "note[lint/missing-phone]: No phone number",
      "note[lint/missing-headline]: No headline",
      "warning[lint/emoji]: Text contains 🚀",
      "note[lint/no-skills]: No skills section",
      "warning[lint/nonstandard-heading]: Heading 'My Journey' is not a standard experience heading",
      "error[lint/date-order]: End date 2021 is before start date 2022",
    ]);
    expect(r.text()).toContain("  --> cv.yaml:6:12");
    expect(r.text()).toContain("  = help: Swap the dates or fix the typo");
    expect(r.text()).toContain("✘ cv.yaml: 1 error, 2 warnings, 3 notes");
  });

  it("fails on warnings only with --strict", async () => {
    writeFileSync(
      "cv.yaml",
      readFileSync("cv.yaml", "utf8").replace(
        "  - type: experience\n",
        "  - type: experience\n    title: My Journey\n",
      ),
    );
    expect((await run("lint")).code).toBe(0);
    const strict = await run("lint", "--strict");
    expect(strict.code).toBe(1);
    expect(strict.text()).toContain("(--strict)");
  });

  it("respects meta.lint overrides", async () => {
    writeFileSync(
      "cv.yaml",
      readFileSync("cv.yaml", "utf8")
        .replace(
          "  locales: [en, it]\n",
          "  locales: [en, it]\n  lint: { nonstandard-heading: off }\n",
        )
        .replace("  - type: experience\n", "  - type: experience\n    title: My Journey\n"),
    );
    expect((await run("lint", "--strict")).code).toBe(0);
  });

  it("lists the rules", async () => {
    const r = await run("lint", "--list");
    expect(r.code).toBe(0);
    expect(r.out.some((l) => /^missing-glyphs\s+error\s+/.test(l))).toBe(true);
  });

  it("build lints by default: lint errors block writing, --no-lint skips it", async () => {
    writeFileSync(
      "cv.yaml",
      readFileSync("cv.yaml", "utf8").replace("Your Name", '"Your Name 漢"'),
    );
    const blocked = await run("build");
    expect(blocked.code).toBe(1);
    expect(blocked.text()).toContain("error[lint/missing-glyphs]");
    expect(existsSync("cv.pdf")).toBe(false);

    const skipped = await run("build", "--no-lint");
    expect(skipped.code, skipped.text()).toBe(0);
    expect(existsSync("cv.pdf")).toBe(true);
  });

  it("build prints lint warnings but still writes", async () => {
    writeFileSync(
      "cv.yaml",
      readFileSync("cv.yaml", "utf8").replace('  phone: "+39 000 000 0000"\n', ""),
    );
    const r = await run("build");
    expect(r.code).toBe(0);
    expect(r.text()).toContain("note[lint/missing-phone]");
    expect(r.text()).toContain("built with 1 note");
    expect(existsSync("cv.pdf")).toBe(true);
  });
});

describe("variants", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "variants", "cv.yaml");
  beforeEach(() => {
    writeFileSync("cv.yaml", readFileSync(FIXTURE, "utf8"));
  });

  it("builds one variant, with the variant in the file name", async () => {
    const r = await run("build", "--variant", "backend", "--lang", "it", "-f", "all");
    expect(r.code, r.text()).toBe(0);
    expect(existsSync("cv.backend.it.pdf") && existsSync("cv.backend.it.docx")).toBe(true);
  });

  it("builds every named variant with --variant all", async () => {
    const r = await run("build", "--variant", "all");
    expect(r.code, r.text()).toBe(0);
    expect(r.out.map((l) => l.split(" ")[1])).toEqual(["cv.backend.pdf", "cv.lead.pdf"]);
  });

  it("variants differ from each other and from the full CV", async () => {
    await run("build", "--variant", "backend,lead");
    await run("build");
    expect(new Set([sha("cv.pdf"), sha("cv.backend.pdf"), sha("cv.lead.pdf")]).size).toBe(3);
  });

  it("explains unknown variants with the available names", async () => {
    const r = await run("build", "--variant", "backnd");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("error[unknown-variant]: No variant or tag named 'backnd'");
    expect(r.text()).toContain("= help: Variants: backend, lead. Tags: backend, hands-on, lead.");
  });

  it("--variant all needs named variants", async () => {
    writeFileSync("cv.yaml", "basics: { name: J, email: j@example.com }\n");
    const r = await run("build", "--variant", "all");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("error[no-variants]");
  });

  it("lint and validate check each variant, locating findings in the original file", async () => {
    // Remove Initech's start date: it is part of both variants.
    writeFileSync("cv.yaml", readFileSync("cv.yaml", "utf8").replace("        start: 2014\n", ""));
    const r = await run("lint", "--variant", "all");
    expect(r.code).toBe(0);
    const warnings = r.err.filter((l) => l.startsWith("warning[lint/missing-dates]"));
    expect(warnings).toHaveLength(1); // same finding in both variants, printed once
    const at = r.err[r.err.indexOf(warnings[0] as string) + 1];
    const line = Number(/cv\.yaml:(\d+):/.exec(at ?? "")?.[1]);
    expect(readFileSync("cv.yaml", "utf8").split("\n")[line - 1]).toContain("company: Initech");
    expect((await run("validate", "--variant", "all")).code).toBe(0);
  });

  it("lists variants and tags", async () => {
    const r = await run("variants");
    expect(r.code).toBe(0);
    expect(r.out).toContain("  backend  Backend roles  ·  tags: backend");
    expect(r.out).toContain("  hands-on (1)");
  });
});

describe("themes and photos", () => {
  const SIDEBAR = join(import.meta.dirname, "..", "..", "..", "fixtures", "sidebar");
  const mediaBox = (f: string) =>
    /\/MediaBox \[([^\]]+)\]/.exec(readFileSync(f, "latin1"))?.[1]?.trim();

  it("follows extends chains across theme files, relative to each file", async () => {
    await run("init");
    mkdirSync("themes");
    writeFileSync("themes/base.yaml", "extends: sidebar\npage: { size: Letter }\n");
    writeFileSync(
      "theme.yaml",
      "extends: ./themes/base.yaml\ntokens: { colors: { accent: '#7a1f3d' } }\n",
    );
    const r = await run("build");
    expect(r.code, r.text()).toBe(0);
    expect(mediaBox("cv.pdf")).toBe("0 0 612 792");
    expect(r.text()).toContain("warning[lint/multi-column]");
  });

  it("reports theme cycles", async () => {
    await run("init");
    writeFileSync("theme.yaml", "extends: ./other.yaml\n");
    writeFileSync("other.yaml", "extends: ./theme.yaml\n");
    const r = await run("build");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("error[theme-cycle]");
  });

  it("reads the photo relative to the CV, from any working directory", async () => {
    mkdirSync("me");
    writeFileSync(join("me", "cv.yaml"), readFileSync(join(SIDEBAR, "cv.yaml")));
    writeFileSync(join("me", "photo.jpg"), readFileSync(join(SIDEBAR, "photo.jpg")));
    const r = await run("build", "me/cv.yaml", "-f", "all");
    expect(r.code, r.text()).toBe(0);
    expect(readFileSync(join("me", "cv.pdf"), "latin1")).toMatch(/\/Subtype \/Image/);
  });

  it("locates a missing photo in the CV", async () => {
    writeFileSync("cv.yaml", "basics:\n  name: J\n  email: j@example.com\n  photo: nope.png\n");
    const r = await run("build");
    expect(r.code).toBe(1);
    expect(r.text()).toContain("error[photo-not-found]: Cannot find the photo 'nope.png'");
    expect(r.text()).toContain("--> cv.yaml:4:10");
  });
});
