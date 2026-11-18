import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("manages workspaces, projects and tasks across reloads", async ({ page, baseURL, isMobile }) => {
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
  await page.getByRole("button", { name: "New task" }).click();
  const taskPanel = page.getByRole("dialog");
  await taskPanel.getByLabel("Task title").fill("Verify rollout");
  await taskPanel.getByLabel("Description").fill("Check the deployment checklist.");
  await taskPanel.getByLabel("Status").selectOption("IN_PROGRESS");
  await taskPanel.getByLabel("Priority").selectOption("HIGH");
  await taskPanel.getByLabel("Assignee").selectOption({ label: "Workspace Tester" });
  await taskPanel.getByLabel("Due date").fill("2026-12-01");
  await taskPanel.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(/task=[a-f0-9-]+$/);
  await expect(taskPanel.getByRole("heading", { name: "Verify rollout" })).toBeVisible();
  const dimensions = await taskPanel.evaluate(el => ({ panel: el.clientWidth, viewport: window.innerWidth }));
  expect(dimensions.panel).toBe(isMobile ? dimensions.viewport : 480);
  await page.reload();
  await expect(taskPanel.getByText("Check the deployment checklist.")).toBeVisible();
  await expect(taskPanel.getByText("2026-12-01")).toBeVisible();
  await expect(taskPanel.getByText("Workspace Tester")).toBeVisible();
  await taskPanel.getByRole("button", { name: "Edit task" }).click();
  await taskPanel.getByLabel("Status").selectOption("DONE");
  await taskPanel.getByRole("button", { name: "Save task" }).click();
  await expect(taskPanel.getByText("Done", { exact: true })).toBeVisible();
  await taskPanel.getByRole("button", { name: "Close task panel" }).click();
  const done = page.getByRole("region", { name: "Done column" });
  const todo = page.getByRole("region", { name: "To do column" });
  const taskLink = page.getByRole("link", { name: /Verify rollout/ });
  const status = page.getByRole("combobox", { name: "Status for Verify rollout" });
  await expect(done.getByRole("link", { name: /Verify rollout/ })).toBeVisible();
  if (isMobile) await status.selectOption("TODO");
  else await taskLink.dragTo(todo);
  await expect(todo.getByRole("link", { name: /Verify rollout/ })).toBeVisible();
  await page.reload();
  await expect(todo.getByRole("link", { name: /Verify rollout/ })).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await status.selectOption("IN_PROGRESS");
  await expect(taskLink).toContainText("In progress");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("region", { name: "In progress column" }).getByRole("link", { name: /Verify rollout/ })).toBeVisible();
  await page.getByRole("link", { name: /Verify rollout/ }).click();
  await taskPanel.getByRole("button", { name: "Delete task" }).click();
  await taskPanel.getByRole("button", { name: "Confirm delete" }).click();
  await expect(taskPanel).toHaveCount(0);
  await expect(page.getByText("No tasks in this project yet.")).toBeVisible();

  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByText("No active projects in this workspace.")).toBeVisible();
  await page.getByText("Archived projects (1)", { exact: true }).click();
  await page.getByRole("link", { name: /Release readiness/ }).click();
  await expect(page.getByText("Archived project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
});
