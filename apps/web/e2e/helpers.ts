import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Download, expect, type Page } from "@playwright/test";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const sha256 = (bytes: Buffer | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export interface CliInputs {
  /** Rewrite the starter cv.yaml / theme.yaml before building. */
  cv?: (starter: string) => string;
  theme?: (starter: string) => string;
  /** Extra files next to the CV (the photo). */
  files?: Record<string, Uint8Array>;
}

/** SHA-256 of each output format. */
export type Hashes = Record<"pdf" | "docx" | "html" | "md" | "txt", string>;

const hashesIn = (dir: string): Hashes => {
  const h = (ext: string) => sha256(readFileSync(join(dir, `cv.${ext}`)));
  return { pdf: h("pdf"), docx: h("docx"), html: h("html"), md: h("md"), txt: h("txt") };
};

/** Build the starter CV with the real CLI (from sources), to compare hashes. */
export function cliHashes(inputs: CliInputs = {}): Hashes {
  const dir = mkdtempSync(join(tmpdir(), "cvac-e2e-"));
  try {
    const cli = (...args: string[]) =>
      execFileSync(
        process.execPath,
        ["--conditions=source", join(ROOT, "packages/cli/src/bin.ts"), ...args],
        { cwd: dir, stdio: "pipe" },
      );
    cli("init");
    for (const [name, edit] of [
      ["cv.yaml", inputs.cv],
      ["theme.yaml", inputs.theme],
    ] as const) {
      if (!edit) continue;
      const file = join(dir, name);
      writeFileSync(file, edit(readFileSync(file, "utf8")));
    }
    for (const [name, data] of Object.entries(inputs.files ?? {})) {
      writeFileSync(join(dir, name), data);
    }
    cli("build", "cv.yaml", "--format", "all", "--out", "out");
    return hashesIn(join(dir, "out"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Build `dir/cv.yaml` (with `dir/theme.yaml`, if any) with the CLI; hashes of the outputs. */
export function cliBuild(dir: string): Hashes {
  const out = mkdtempSync(join(tmpdir(), "cvac-e2e-out-"));
  try {
    execFileSync(
      process.execPath,
      [
        "--conditions=source",
        join(ROOT, "packages/cli/src/bin.ts"),
        "build",
        join(dir, "cv.yaml"),
        "--format",
        "all",
        "--out",
        out,
      ],
      { stdio: "pipe" },
    );
    return hashesIn(out);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Open the editor and wait for the first clean build. */
export async function open(page: Page) {
  await page.goto("./");
  await expect(page.locator(".status")).toContainText("Up to date");
  await expect(page.locator(".preview canvas.page").first()).toBeVisible();
}

/** The menu entry of each format, as the download menu labels it. */
const MENU_LABEL = {
  pdf: /^PDF/,
  docx: /^Word/,
  html: /^Web page/,
  md: /^Markdown/,
  txt: /^Plain text/,
};

/** Download a format through the menu on the download button's arrow. */
export async function downloadAs(page: Page, format: keyof typeof MENU_LABEL): Promise<Download> {
  await page.getByRole("button", { name: "More download formats" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: MENU_LABEL[format] }).click(),
  ]);
  return download;
}

export const hash = (page: Page) => page.locator(".status .hash");
