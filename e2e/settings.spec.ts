import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("shows color mode options and a live preview", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Settings" })
    ).toBeVisible();

    await expect(page.getByText("Light", { exact: true })).toBeVisible();
    await expect(page.getByText("System", { exact: true })).toBeVisible();
    await expect(page.getByText("Dark", { exact: true })).toBeVisible();
  });

  test("switching to dark mode updates the preview", async ({ page }) => {
    const body = page.locator("body");

    const before = await body.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );

    await page.getByText("Dark", { exact: true }).click();

    await expect(body).not.toHaveCSS("background-color", before);
  });

  test("back to workspace returns to the workspace", async ({ page }) => {
    const back = page.getByText("Back to workspace", { exact: true });

    await expect(back).toBeVisible();

    await back.click();

    await page.waitForURL(/\/app/, {
      timeout: 10000,
    });

    await expect(page).toHaveURL(/\/app/);
  });
});