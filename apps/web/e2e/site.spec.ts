import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test("the footer links the third-party notices", async ({ page, context }) => {
  await open(page);
  const [notices] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Licenses" }).click(),
  ]);
  await notices.waitForLoadState();
  const text = (await notices.locator("body").textContent()) ?? "";
  expect(text).toContain("cvac itself is MIT-licensed");
  // Fonts, and packages from both the page and the build worker.
  for (const part of [
    "SIL OPEN FONT LICENSE",
    "react ",
    "@codemirror/view",
    "pdfjs-dist",
    "pdfkit",
  ]) {
    expect(text).toContain(part);
  }
});

test("every file loads from inside the site's base path", async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("http://localhost") && !url.startsWith(baseURL ?? "")) outside.push(url);
  });
  await open(page);
  expect(outside).toEqual([]);
});
