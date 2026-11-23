import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const workspaces: string[] = [];
async function account() {
  const client = request.agent(app);
  const email = `${randomUUID()}@example.test`;
  const { body } = await client.post("/api/auth/register").send({ name: "Notification Tester", email, password: "example-password-for-tests" }).expect(201);
  users.push(body.user.id);
  return { client, id: body.user.id as string, email };
}
afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
it("persists recipient-only assignment notifications and invitation notices with idempotent read controls", async () => {
  const owner = await account();
  const recipient = await account();
  const workspace = await prisma.workspace.create({ data: { name: "Notifications Team", members: { create: [
    { userId: owner.id, role: "OWNER" }, { userId: recipient.id },
  ] } } });
  workspaces.push(workspace.id);
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: "Notify project" } });
  const path = `/api/workspaces/${workspace.id}/projects/${project.id}/tasks`;
  const fields = { title: "Assigned work", description: "", status: "TODO", priority: "HIGH", dueDate: null, assigneeId: recipient.id };
  const { body: { task } } = await owner.client.post(path).send(fields).expect(201);
  await request(app).get("/api/notifications").expect(401);
  const inbox = await recipient.client.get("/api/notifications").expect(200);
  expect(inbox.body.unread).toBe(1);
  expect(inbox.body.notifications).toHaveLength(1);
  const notice = inbox.body.notifications[0];
  expect(notice.href).toBe(`/app/workspaces/${workspace.id}/projects/${project.id}?task=${task.id}`);
  expect(notice.message).toContain("Assigned work");
  await owner.client.get("/api/notifications").expect(200, { notifications: [], total: 0, unread: 0, nextCursor: null });
  await owner.client.post(`/api/notifications/${notice.id}/read`).send({}).expect(404);
  await recipient.client.post(`/api/notifications/${notice.id}/read`).send({}).expect(204);
  await recipient.client.post(`/api/notifications/${notice.id}/read`).send({}).expect(204);
  expect((await recipient.client.get("/api/notifications").expect(200)).body.unread).toBe(0);
  await Promise.all([1, 2].map(() => owner.client.patch(`${path}/${task.id}`).send(fields).expect(200)));
  expect(await prisma.notification.count({ where: { taskId: task.id } })).toBe(1);
  await owner.client.patch(`${path}/${task.id}`).send({ ...fields, assigneeId: owner.id }).expect(200);
  expect((await recipient.client.get("/api/notifications").expect(200)).body.notifications).toHaveLength(0);
  const ownerInbox = await owner.client.get("/api/notifications").expect(200);
  expect(ownerInbox.body.unread).toBe(1);

  const invitation = await prisma.invitation.create({ data: {
    workspaceId: workspace.id, email: recipient.email, tokenHash: randomUUID(), deliveredAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
  } });
  const invited = await recipient.client.get("/api/notifications").expect(200);
  expect(invited.body.notifications).toHaveLength(1);
  expect(invited.body.notifications[0]).toMatchObject({ kind: "INVITATION", href: null });
  expect(JSON.stringify(invited.body)).not.toContain(invitation.tokenHash);
  await recipient.client.get("/api/notifications").expect(200);
  expect(await prisma.notification.count({ where: { invitationId: invitation.id, userId: recipient.id } })).toBe(1);
  await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
  expect((await recipient.client.get("/api/notifications").expect(200)).body.notifications).toHaveLength(0);
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } } });
  expect((await owner.client.get("/api/notifications").expect(200)).body.notifications).toHaveLength(0);
});
