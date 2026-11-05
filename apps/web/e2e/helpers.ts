import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

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

/** Build the starter CV with the real CLI (from sources), to compare hashes. */
export function cliHashes(inputs: CliInputs = {}): { pdf: string; docx: string } {
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
    return {
      pdf: sha256(readFileSync(join(dir, "out/cv.pdf"))),
      docx: sha256(readFileSync(join(dir, "out/cv.docx"))),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Open the editor and wait for the first clean build. */
export async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("Up to date");
  await expect(page.locator(".preview canvas.page").first()).toBeVisible();
}

export const hash = (page: Page) => page.locator(".status .hash");
