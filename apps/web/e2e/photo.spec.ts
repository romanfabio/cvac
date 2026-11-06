import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cliHashes, hash, open, ROOT } from "./helpers.ts";

const PHOTO = readFileSync(join(ROOT, "fixtures/sidebar/photo.jpg"));
const withPhoto = (cv: string) =>
  cv.replace("  name: Your Name\n", "  name: Your Name\n  photo: photo.jpg\n");

let starterCv = "";
let expected: { pdf: string; docx: string };
test.beforeAll(() => {
  expected = cliHashes({
    cv: (t) => {
      starterCv = t;
      return withPhoto(t);
    },
    files: { "photo.jpg": PHOTO },
  });
});

async function seedCv(page: Page) {
  await page.addInitScript((cv) => localStorage.setItem("cvac:cv.yaml", cv), withPhoto(starterCv));
}

const photoInput = (page: Page) => page.getByLabel("Choose the file for photo.jpg");
const problems = (page: Page) => page.locator(".problems");

test("a chosen photo is saved in the browser and gives the CLI's bytes", async ({ page }) => {
  await seedCv(page);
  await page.goto("./");
  await expect(problems(page)).toContainText("Cannot find the photo 'photo.jpg'");

  await photoInput(page).setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: PHOTO });
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  await expect(problems(page)).not.toContainText("Cannot find the photo");

  await page.reload();
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  await expect(problems(page)).not.toContainText("Cannot find the photo");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a 4 MB photo, over the old localStorage limit, survives a reload", async ({ page }) => {
  // Bytes after the JPEG's end marker are ignored by decoders but count toward the size.
  const big = Buffer.concat([PHOTO, Buffer.alloc(4_200_000 - PHOTO.length)]);
  await seedCv(page);
  await page.goto("./");
  await photoInput(page).setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: big });
  await expect(problems(page)).toContainText("The photo is 4.2 MB");

  await page.reload();
  await expect(problems(page)).toContainText("The photo is 4.2 MB");
  await expect(problems(page)).not.toContainText("Cannot find the photo");
});

test("moves a photo saved by older versions out of localStorage", async ({ page }) => {
  await seedCv(page);
  await page.addInitScript(
    (b64) => localStorage.setItem("cvac:photo:photo.jpg", b64),
    PHOTO.toString("base64"),
  );
  await page.goto("./");
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  expect(await page.evaluate(() => localStorage.getItem("cvac:photo:photo.jpg"))).toBeNull();
});

test("says so when the browser cannot save the photo", async ({ page }) => {
  await seedCv(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("storage blocked");
      },
    });
  });
  await page.goto("./");
  await photoInput(page).setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: PHOTO });
  // The photo is still used for this session.
  await expect(hash(page)).toHaveAttribute("data-sha256", expected.pdf);
  await expect(page.getByRole("alert")).toContainText("could not save the photo");
});

test("Add photo puts the photo into the starter CV, and Remove photo takes it out", async ({
  page,
}) => {
  // What the button writes: the starter's commented hint becomes the key.
  const added = cliHashes({
    cv: (t) => t.replace(/^ {2}# photo:.*$/m, "  photo: photo.jpg"),
    files: { "photo.jpg": PHOTO },
  });
  const plain = cliHashes();
  page.on("dialog", (d) => d.accept());
  await open(page);
  await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);

  await page
    .getByLabel("Add a photo")
    .setInputFiles({ name: "Me.JPG", mimeType: "image/jpeg", buffer: PHOTO });
  await expect(hash(page)).toHaveAttribute("data-sha256", added.pdf);
  await expect(page.locator(".editor .cm-content")).toContainText("photo: photo.jpg");
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  // Still there after a reload: the CV line and the saved image.
  await page.reload();
  await expect(hash(page)).toHaveAttribute("data-sha256", added.pdf);

  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(hash(page)).toHaveAttribute("data-sha256", plain.pdf);
  await expect(page.locator(".editor .cm-content")).not.toContainText("photo: photo.jpg");
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  // The image is gone from the browser too.
  const saved = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("cvac");
        req.onsuccess = () => {
          const count = req.result.transaction("photos").objectStore("photos").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(saved).toBe(0);
});

test("a PNG gets photo.png", async ({ page }) => {
  const png = readFileSync(join(ROOT, "fixtures/sidebar/photo.png"));
  await open(page);
  await page
    .getByLabel("Add a photo")
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".editor .cm-content")).toContainText("photo: photo.png");
  await expect(page.locator(".problems")).not.toContainText("Cannot find the photo");
});
