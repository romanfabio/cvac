import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cliHashes, hash, open, sha256 } from "./helpers.ts";

let expected: { pdf: string; docx: string };
test.beforeAll(() => {
  expected = cliHashes();
});

test("previews the starter CV with the same PDF bytes as the CLI", async ({ page }) => {
  await open(page);
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  const canvas = page.locator(".preview canvas.page").first();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  expect(box && box.height / box.width).toBeCloseTo(842 / 595, 1); // A4 portrait
  await expect(page.locator(".problems")).toHaveText("No problems");
});

test("a built-in serif theme gives the CLI's bytes, loading its font on demand", async ({
  page,
}) => {
  const theme = "version: 1\nextends: classic\n";
  const cli = cliHashes({ theme: () => theme });
  await page.addInitScript((t) => localStorage.setItem("cvac:theme.yaml", t), theme);
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".ttf")) fonts.push(r.url().split("/").pop() ?? "");
  });
  await open(page);
  await expect(hash(page)).toHaveAttribute("data-sha256", cli.pdf);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f) => f.startsWith("SourceSerif4"))).toBe(true);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download DOCX" }).click(),
  ]);
  expect(sha256(readFileSync(await download.path()))).toBe(cli.docx);
});

test("the theme picker rewrites extends: in theme.yaml", async ({ page }) => {
  const cli = cliHashes({ theme: (t) => t.replace("extends: default", "extends: modern") });
  await open(page);
  const picker = page.getByLabel("Theme");
  await expect(picker).toHaveValue("default");
  await picker.selectOption("modern");
  await expect(hash(page)).toHaveAttribute("data-sha256", cli.pdf);

  await page.getByRole("tab", { name: "theme.yaml" }).click();
  await expect(page.locator(".editor .cm-content")).toContainText("extends: modern");
  // Undo in the editor goes back to the previous base, and the picker follows.
  await page.locator(".editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(picker).toHaveValue("default");
});

test("the default theme loads only the sans-serif font", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".ttf")) fonts.push(r.url().split("/").pop() ?? "");
  });
  await open(page);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f) => f.startsWith("SourceSans3"))).toBe(true);
});

test("downloads a DOCX with the same bytes as the CLI", async ({ page }) => {
  await open(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download DOCX" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("cv.docx");
  expect(sha256(readFileSync(await download.path()))).toBe(expected.docx);
});

test("reports an error while editing and recovers on undo", async ({ page }) => {
  await open(page);
  const editor = page.locator(".editor .cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.insertText("bogus: 1\n");

  const problem = page.locator(".problem.error").first();
  await expect(problem).toContainText("bogus");
  await expect(problem).toContainText("cv.yaml:1");
  await expect(page.locator(".tab.active .badge")).toHaveText("1");
  await expect(page.locator(".status")).toContainText("1 error");
  // The preview keeps the last good build.
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeDisabled();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".problems")).toHaveText("No problems");
  await expect(page.locator(".status")).toContainText("Up to date");
});

test("edits change the PDF, and the edit survives a reload", async ({ page }) => {
  await open(page);
  await page.locator(".editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n# a comment changes nothing\n");
  await page.waitForTimeout(600); // past the debounce
  await expect(page.locator(".status")).toContainText("Up to date");
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);

  await page.getByRole("tab", { name: "theme.yaml" }).click();
  await page.locator(".editor .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nlayout:\n  type: sidebar\n");
  await expect(hash(page)).not.toHaveAttribute("data-sha256", expected.pdf);
  await expect(page.locator(".problem.warning")).toContainText("column");
  const changed = await hash(page).getAttribute("data-sha256");

  await page.reload();
  await expect(page.locator(".status")).toContainText("Up to date");
  await expect(hash(page)).toHaveAttribute("data-sha256", changed ?? "");
});

test("fits a phone screen without horizontal scrolling", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  await open(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);

  // Editor first, preview below it, both full width.
  const left = await page.locator(".left").boundingBox();
  const canvas = await page.locator(".preview canvas.page").first().boundingBox();
  expect(left && canvas).toBeTruthy();
  if (!left || !canvas) return;
  expect(left.width).toBeGreaterThan(viewport.width - 2);
  expect(canvas.y).toBeGreaterThan(left.y + left.height - 1);
  expect(canvas.width).toBeGreaterThan(viewport.width * 0.8);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(viewport.width);
  await expect(page.locator(".editor .cm-content")).toBeVisible();
  for (const name of ["Download PDF", "Download DOCX"]) {
    const b = await page.getByRole("button", { name }).boundingBox();
    expect(b && b.x + b.width).toBeLessThanOrEqual(viewport.width);
  }
});
