import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: { name: "Jamie Davis", email: `${randomUUID()}@example.test`, password: "browser-test-password" },
  });
  expect(response.status()).toBe(201);
});

test("first-run onboarding creates a real workspace and opens projects", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create your first workspace" })).toBeVisible();
  await expect(page.getByText("Total tasks")).toHaveCount(0);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Design studio");
  await page.locator(".workspace-form").getByRole("button", { name: "Create workspace", exact: true }).click();
  if (isMobile) await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(page.getByRole("heading", { name: "Design studio" })).toBeVisible();
  await page.screenshot({ path: `/tmp/collabflow-dashboard-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  await page.getByRole("link", { name: "Open projects", exact: true }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Website redesign");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Website redesign", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kanban board" })).toHaveCount(0);
  await expect(page.getByLabel("Kanban board")).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Website redesign", exact: true })).toBeVisible();
});

test("unavailable project URLs show an honest empty state", async ({ page }) => {
  await page.goto("/app/projects/website?task=CF-101");
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Create your first workspace" })).toBeVisible();
});

test("settings saves theme preference across reloads", async ({ page, isMobile }) => {
  await page.goto("/app/settings");
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Theme" })).toHaveValue("dark");
  await page.screenshot({ path: `/tmp/collabflow-settings-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).not.toBeVisible();
  }
});
