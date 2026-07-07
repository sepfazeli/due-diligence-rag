import { test, expect } from "@playwright/test";
 
test.describe("Landing page", () => {
  test("loads with correct title and hero", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Dealworthy/);
    await expect(page.getByRole("heading", { name: /worth it/i })).toBeVisible();
  });
 
  test("nav links point to the right places", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Source" }).first()).toHaveAttribute(
      "href",
      /github\.com\/sepfazeli\/due-diligence-rag/
    );
    await expect(page.getByRole("link", { name: "Launch" })).toHaveAttribute("href", /\/app/);
  });
 
  test("CTA buttons navigate to the workspace", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Review a contract" }).first().click();
    await expect(page).toHaveURL(/\/app/);
  });
 
  test("capabilities section is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Clause risk flags")).toBeVisible();
    await expect(page.getByText("Grounded citations")).toBeVisible();
  });
});