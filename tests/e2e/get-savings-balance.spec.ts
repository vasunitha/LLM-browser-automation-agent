import { test, expect } from "@playwright/test";

test.describe("get-savings-balance", () => {
  test("happy path: search a member and see their savings balance", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Member ID").fill("1001");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/\/members\/1001$/);
    await expect(page.getByText("Member details loaded successfully.")).toBeVisible();
    await expect(page.getByText("Savings Balance:")).toBeVisible();
    await expect(page.getByText("$482.17")).toBeVisible();
  });

  test("unknown member id produces a business-outcome page, not a crash", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Member ID").fill("9999");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByRole("heading", { name: "Member Not Found" })).toBeVisible();
    await expect(page.getByText('No member found with ID "9999".')).toBeVisible();
  });
});
