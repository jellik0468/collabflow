import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";

test("delivers an owner invitation and joins through the sign-in flow", async ({ page, browser, baseURL, isMobile }) => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const password = "invitation-browser-password";
  const passwordHash = await bcrypt.hash(password, 12);
  const owner = await prisma.user.create({ data: { name: "Invitation Owner", email: `owner-${suffix}@example.test`, passwordHash } });
  const recipient = await prisma.user.create({ data: { name: "Invited Member", email: `member-${suffix}@example.test`, passwordHash } });
  const workspace = await prisma.workspace.create({ data: { name: "Invitation Workspace", members: { create: { userId: owner.id, role: "OWNER" } } } });
  const guest = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const login = await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { email: owner.email, password } });
    expect(login.status()).toBe(200);
    await page.goto("/app");
    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("combobox", { name: "Workspace" }).selectOption({ label: workspace.name });
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await page.getByLabel("Email address").fill(recipient.email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation sent.", { exact: true })).toBeVisible();
    const directory = fileURLToPath(new URL("../../../.local-mail/", import.meta.url));
    let text = "";
    for (const filename of await readdir(directory)) {
      const mail = JSON.parse(await readFile(directory + filename, "utf8"));
      if (mail.to === recipient.email) text = mail.text;
    }
    expect(text).toContain("Invitation Workspace");
    const url = text.match(/http[^\s]+\/invite#token=[A-Za-z0-9_-]+/)?.[0];
    expect(url).toBeTruthy();
    const guestPage = await guest.newPage();
    await guestPage.goto(url!);
    await guestPage.getByRole("link", { name: "Sign in", exact: true }).click();
    await guestPage.getByLabel("Email address").fill(recipient.email);
    await guestPage.getByLabel("Password").fill(password);
    await guestPage.getByRole("button", { name: "Sign in" }).click();
    await guestPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(guestPage.getByRole("heading", { name: "Workspace joined" })).toBeVisible();
    await expect(guestPage).toHaveURL(/\/invite$/);
    await guestPage.getByRole("link", { name: "Open workspace" }).click();
    await expect(guestPage.getByRole("heading", { name: workspace.name })).toBeVisible();
    await expect(guestPage.getByRole("button", { name: "New project" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(recipient.email, { exact: true })).toBeVisible();
    const { project } = await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, {
      headers: { Origin: baseURL! }, data: { name: "Notification project", description: "" },
    })).json();
    const taskResponse = await page.request.post(`/api/workspaces/${workspace.id}/projects/${project.id}/tasks`, {
      headers: { Origin: baseURL! }, data: { title: "Review invitation", description: "", status: "TODO", priority: "MEDIUM", dueDate: null, assigneeId: recipient.id },
    });
    expect(taskResponse.status()).toBe(201);
    await guestPage.goto("/app/notifications");
    await expect(guestPage.getByText("1 unread", { exact: true })).toBeVisible();
    await expect(guestPage.getByRole("link", { name: "Notifications, 1 unread" })).toBeVisible();
    await guestPage.getByRole("button", { name: "Mark as read", exact: true }).click();
    await expect(guestPage.getByText("0 unread", { exact: true })).toBeVisible();
    await guestPage.reload();
    await expect(guestPage.getByText("Read", { exact: true })).toBeVisible();
    await guestPage.getByRole("link", { name: /You were assigned.*Review invitation/ }).click();
    await expect(guestPage.getByRole("dialog", { name: "Review invitation" })).toBeVisible();

  } finally {
    await guest.close();
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, recipient.id] } } });
    await prisma.$disconnect();
  }
});
