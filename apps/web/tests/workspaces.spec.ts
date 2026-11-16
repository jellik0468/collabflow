import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("manages workspaces and their projects across reloads", async ({ page, baseURL, isMobile }) => {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: baseURL! },
    data: { name: "Workspace Tester", email: `${randomUUID()}@example.test`, password: "browser-test-password" },
  });
  expect(response.status()).toBe(201);
  await page.goto("/app");
  const menu = page.getByRole("button", { name: "Open menu" });
  if (isMobile) await menu.click();

  const switcher = page.getByRole("combobox", { name: "Workspace" });
  await expect(switcher.locator("option:checked")).toHaveText("Preview workspace");
  for (const name of ["Product", "Operations"]) {
    await page.getByRole("button", { name: "New workspace" }).click();
    await page.getByRole("textbox", { name: "Workspace name" }).fill(name);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(switcher.locator("option:checked")).toHaveText(name);
  }

  await switcher.selectOption({ label: "Product" });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Product Studio");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(switcher.locator("option:checked")).toHaveText("Product Studio");

  if (isMobile) await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("heading", { name: "Product Studio" })).toBeVisible();
  await expect(page.getByText("No projects in this workspace yet.")).toBeVisible();
  await expect(page.getByText("Total tasks")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Product Studio" })).toBeVisible();
  if (isMobile) await menu.click();
  await switcher.selectOption({ label: "Operations" });
  await expect(switcher.locator("option:checked")).toHaveText("Operations");

  if (isMobile) await page.getByRole("button", { name: "Close menu" }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Release planning");
  await page.getByLabel(/Description/).fill("Coordinate the release checklist.");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Release planning" })).toBeVisible();
  const projectUrl = page.url();
  await page.getByRole("button", { name: "Edit project" }).click();
  await page.getByLabel("Project name").fill("Release readiness");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Release readiness" })).toBeVisible();

  if (isMobile) await menu.click();
  await switcher.selectOption({ label: "Product Studio" });
  if (isMobile) await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByText("No projects in this workspace yet.")).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: "Release readiness" })).toBeVisible();
  await expect(page.getByText("Coordinate the release checklist.")).toBeVisible();
  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByText("No active projects in this workspace.")).toBeVisible();
  await page.getByText("Archived projects (1)", { exact: true }).click();
  await page.getByRole("link", { name: /Release readiness/ }).click();
  await expect(page.getByText("Archived project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
});
