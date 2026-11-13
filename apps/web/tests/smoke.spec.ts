import { expect, test } from "@playwright/test";

test("dashboard renders and navigates to the project board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good morning, Jamie/ })).toBeVisible();
  await page.getByRole("link", { name: "Website redesign" }).first().click();
  await expect(page.getByRole("heading", { name: /Website redesign/ })).toBeVisible();
  await expect(page.getByText("Design onboarding experience")).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByText("Build workspace navigation")).toBeVisible();
});

test("task drawer has shareable URL and can be closed", async ({ page }) => {
  await page.goto("/app/projects/website");
  await page.getByRole("button", { name: /Design onboarding experience/ }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
  await expect(page).toHaveURL(/task=CF-101/);
  await page.getByRole("button", { name: "Close task details" }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toHaveCount(0);
});

test("theme preference persists after reload", async ({ page, isMobile }) => {
  await page.goto("/app");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
