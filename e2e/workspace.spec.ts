import { test, expect } from "@playwright/test";

test.describe("Workspace (/app)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app");
  });

  test("loads with Analyze and Documents tabs", async ({ page }) => {
    await expect(page.getByText("01 Analyze")).toBeVisible();
    await expect(page.getByText("02 Documents")).toBeVisible();
  });

  test("load demo data populates the session", async ({ page }) => {
    const loadDemo = page.getByRole("button", {
      name: /Load demo data/i,
    });

    await loadDemo.click();

    await expect(loadDemo).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("analyze tab shows empty state when there are no documents", async ({
    page,
  }) => {
    await page.getByText("01 Analyze").click();

    await expect(page.getByText("No documents yet")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Add documents" })
    ).toBeVisible();
  });

  test("settings icon link navigates to /settings", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/settings/);
  });
});