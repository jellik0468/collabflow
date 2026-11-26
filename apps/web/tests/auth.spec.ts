import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("registers, restores a session and returns to a protected task after login", async ({ page, baseURL }) => {
  const email = `${randomUUID()}@example.test`;
  const password = "browser-test-password";
  let taskUrl = "/app/my-tasks";
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: "Sign in to CollabFlow" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Alex Lee");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  const formFits = await page.locator(".auth-card").evaluate(card => card.getBoundingClientRect().right <= window.innerWidth);
  expect(formFits).toBe(true);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/my-tasks$/);
  const headers = { Origin: baseURL! };
  const workspaceResponse = await page.request.post("/api/workspaces", { headers, data: { name: "Auth workspace" } });
  expect(workspaceResponse.status()).toBe(201);
  const { workspace } = await workspaceResponse.json();
  const projectResponse = await page.request.post(`/api/workspaces/${workspace.id}/projects`, { headers, data: { name: "Auth project", description: "" } });
  expect(projectResponse.status()).toBe(201);
  const { project } = await projectResponse.json();
  const taskResponse = await page.request.post(`/api/workspaces/${workspace.id}/projects/${project.id}/tasks`, {
    headers, data: { title: "Verify protected links", description: "", status: "TODO", priority: "MEDIUM", dueDate: null, assigneeId: null },
  });
  expect(taskResponse.status()).toBe(201);
  const { task } = await taskResponse.json();
  taskUrl = `/app/workspaces/${workspace.id}/projects/${project.id}?task=${task.id}`;
  await page.goto(taskUrl);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Verify protected links" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close task panel" }).click();
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto(taskUrl);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Verify protected links" })).toBeVisible();
  const prisma = new PrismaClient();
  try {
    await prisma.session.updateMany({ where: { user: { email } }, data: { expiresAt: new Date(0) } });
  } finally { await prisma.$disconnect(); }
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Sign in to CollabFlow" })).toBeVisible();
  await expect(page).toHaveURL(/next=/);
});
