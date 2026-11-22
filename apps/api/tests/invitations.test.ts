import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const workspaces: string[] = [];
let directory: string;
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function account() {
  const client = request.agent(app);
  const email = `${randomUUID()}@example.test`;
  const { body } = await client.post("/api/auth/register").send({ name: "Invite Tester", email, password: "example-password-for-tests" }).expect(201);
  users.push(body.user.id);
  return { client, email, id: body.user.id as string };
}
it("delivers hashed email-bound invitations and accepts them atomically without granting owner access", async () => {
  directory = await mkdtemp(join(tmpdir(), "collabflow-invitations-"));
  vi.stubEnv("MAIL_MODE", "file");
  vi.stubEnv("MAIL_DIRECTORY", directory);
  const owner = await account();
  const recipient = await account();
  const { body: { workspace } } = await owner.client.post("/api/workspaces").send({ name: "Invitation Team" }).expect(201);
  workspaces.push(workspace.id);
  const path = `/api/workspaces/${workspace.id}/invitations`;
  await request(app).post(path).send({ email: recipient.email }).expect(401);
  await recipient.client.post(path).send({ email: recipient.email }).expect(404);
  await owner.client.post(path).send({ email: owner.email }).expect(409);
  await owner.client.post(path).send({ email: "invalid" }).expect(400);
  const response = await owner.client.post(path).send({ email: recipient.email.toUpperCase() }).expect(201);
  expect(response.body).toEqual({ message: "Invitation sent." });
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  const mail = JSON.parse(await readFile(join(directory, files[0]), "utf8"));
  expect(mail.to).toBe(recipient.email);
  const token = mail.text.match(/token=([A-Za-z0-9_-]{43})/)[1];
  const invitation = await prisma.invitation.findFirstOrThrow({ where: { workspaceId: workspace.id } });
  expect(invitation.tokenHash).not.toContain(token);
  expect(invitation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(invitation.deliveredAt).not.toBeNull();
  await owner.client.post("/api/invitations/accept").send({ token }).expect(404);
  await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
  await recipient.client.post("/api/invitations/accept").send({ token }).expect(404);
  await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() + 86400000) } });
  const accepts = await Promise.all([1, 2].map(() => recipient.client.post("/api/invitations/accept").send({ token })));
  expect(accepts.some(result => result.status === 200)).toBe(true);
  expect(accepts.every(result => [200, 404].includes(result.status))).toBe(true);
  await recipient.client.post("/api/invitations/accept").send({ token }).expect(200);
  const membership = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: recipient.id } },
  });
  expect(membership.role).toBe("MEMBER");
  await recipient.client.post(path).send({ email: "other@example.test" }).expect(404);
  await recipient.client.get(`/api/workspaces/${workspace.id}/members`).expect(200);
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: recipient.id } } });
  await recipient.client.post("/api/invitations/accept").send({ token }).expect(404);
  vi.stubEnv("MAIL_MODE", "");
  vi.stubEnv("SMTP_HOST", "");
  await owner.client.post(path).send({ email: "new@example.test" }).expect(503);
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(1);
  vi.stubEnv("MAIL_MODE", "file");
  vi.stubEnv("MAIL_DIRECTORY", join(directory, files[0], "invalid-directory"));
  await owner.client.post(path).send({ email: "new@example.test" }).expect(503);
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(1);
});
