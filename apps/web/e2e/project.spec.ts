import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { cliBuild, downloadAs, hash, open, ROOT } from "./helpers.ts";

const SIDEBAR = join(ROOT, "fixtures/sidebar");
const file = (name: string) => new Uint8Array(readFileSync(join(SIDEBAR, name)));

/** A zipped project folder, as people make one by hand. */
function sidebarZip(): Buffer {
  const zip = zipSync({
    "sidebar/cv.yaml": file("cv.yaml"),
    "sidebar/theme.yaml": file("theme.yaml"),
    "sidebar/photo.jpg": file("photo.jpg"),
  });
  return Buffer.from(zip);
}

const importInput = (page: Page) => page.getByLabel("Import a project (.zip)");

async function importZip(page: Page, name: string, buffer: Buffer) {
  await importInput(page).setInputFiles({ name, mimeType: "application/zip", buffer });
}

test("imports a zipped project folder, photo included, and keeps it after a reload", async ({
  page,
}) => {
  const cli = cliBuild(SIDEBAR);
  page.on("dialog", (d) => d.accept());
  await open(page);
  await importZip(page, "sidebar.zip", sidebarZip());
  await expect(hash(page)).toHaveAttribute("data-sha256", cli.pdf);
  await expect(page.locator(".editor .cm-content")).toContainText("Giulia Ferrari");

  await page.reload();
  await expect(hash(page)).toHaveAttribute("data-sha256", cli.pdf);
  await expect(page.locator(".problems")).not.toContainText("Cannot find the photo");
});

test("exports a project that `cvac build` turns into the same files", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await open(page);
  await importZip(page, "sidebar.zip", sidebarZip());
  // Wait for the imported project's build (it tells the toolbar about the photo).
  const webPdf = cliBuild(SIDEBAR).pdf;
  await expect(hash(page)).toHaveAttribute("data-sha256", webPdf);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("cv-project.zip");
  const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
  expect(Object.keys(files).sort()).toEqual([
    ".cvac/schemas/cv.schema.json",
    ".cvac/schemas/theme.schema.json",
    "cv.yaml",
    "photo.jpg",
    "theme.yaml",
  ]);

  const dir = mkdtempSync(join(tmpdir(), "cvac-e2e-project-"));
  try {
    for (const [name, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
    const cli = cliBuild(dir);
    expect(cli.pdf).toBe(webPdf);

    const docx = await downloadAs(page, "docx");
    const { createHash } = await import("node:crypto");
    expect(
      createHash("sha256")
        .update(readFileSync(await docx.path()))
        .digest("hex"),
    ).toBe(cli.docx);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explains why a file cannot be imported, and changes nothing", async ({ page }) => {
  await open(page);
  const before = await hash(page).getAttribute("data-sha256");
  await importZip(page, "notes.zip", Buffer.from(zipSync({ "notes.txt": strToU8("hi") })));
  await expect(page.getByRole("alert")).toContainText("Could not import notes.zip");
  await expect(page.getByRole("alert")).toContainText("no cv.yaml");
  await expect(hash(page)).toHaveAttribute("data-sha256", before ?? "");
});

test("asks before replacing the files, and cancelling keeps them", async ({ page }) => {
  await open(page);
  const before = await hash(page).getAttribute("data-sha256");
  let asked = "";
  page.on("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await importZip(page, "sidebar.zip", sidebarZip());
  await expect.poll(() => asked).toContain("Replace cv.yaml, theme.yaml and the photo");
  await expect(page.locator(".editor .cm-content")).toContainText("Your Name");
  await expect(hash(page)).toHaveAttribute("data-sha256", before ?? "");
});
