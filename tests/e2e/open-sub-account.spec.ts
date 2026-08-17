import { test, expect } from "@playwright/test";

test.describe("open-sub-account", () => {
  test("happy path: valid form reaches the confirmation screen", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Member ID").fill("1002");
    await page.getByRole("button", { name: "Search" }).click();

    await page.getByRole("link", { name: "Open Sub-Account" }).click();
    await expect(page.getByRole("heading", { name: "Open Sub-Account" })).toBeVisible();

    await page.getByLabel("Account Type").selectOption("sub_savings");
    await page.getByLabel("Account Nickname").fill("Vacation Fund");
    await page.getByLabel("Initial Deposit (USD)").fill("100.00");
    await page.getByRole("button", { name: "Open Sub-Account" }).click();

    await expect(page.getByRole("heading", { name: "Sub-Account Opened" })).toBeVisible();
    await expect(page.getByText("Sub-account opened successfully.")).toBeVisible();
    await expect(page.getByText("Vacation Fund")).toBeVisible();
  });

  test("invalid form input shows validation errors instead of proceeding", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Member ID").fill("1002");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: "Open Sub-Account" }).click();

    await page.getByLabel("Account Nickname").fill("A");
    await page.getByLabel("Initial Deposit (USD)").fill("1.00");
    await page.getByRole("button", { name: "Open Sub-Account" }).click();

    await expect(page.getByText("Please fix the errors below.")).toBeVisible();
    await expect(page.getByText(/Nickname must be between/)).toBeVisible();
    await expect(page.getByText(/Initial deposit must be at least/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open Sub-Account" })).toBeVisible();
  });
});
