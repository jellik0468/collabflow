import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const workspaces: string[] = [];
afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function account() {
  const client = request.agent(app);
  const { body } = await client.post("/api/auth/register").send({
    name: "Comment Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  users.push(body.user.id);
  return { client, id: body.user.id as string };
}

it("requires membership, preserves text and lets authors delete their own comments", async () => {
  const owner = await account();
  const author = await account();
  const workspace = await prisma.workspace.create({
    data: { name: "Comment workspace", members: { create: { userId: owner.id, role: "OWNER" } } },
  });
  workspaces.push(workspace.id);
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: "Comment project" } });
  const task = await prisma.task.create({ data: { projectId: project.id, title: "Discuss release" } });
  const path = `/api/workspaces/${workspace.id}/projects/${project.id}/tasks/${task.id}/comments`;
  await request(app).get(path).expect(401);
  await author.client.get(path).expect(404);
  await author.client.post(path).send({ body: "Not a member" }).expect(404);
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: author.id } });
  await author.client.post(path).send({ body: "   " }).expect(400);
  await author.client.post(path).send({ body: "a".repeat(2001) }).expect(400);
  const body = "Line one\n<script>alert('test')</script>";
  const result = await author.client.post(path).send({ body }).expect(201);
  const comment = result.body.comment;
  expect(comment).toEqual({ id: expect.any(String), body, createdAt: expect.any(String), author: { id: author.id, name: "Comment Tester" } });
  await owner.client.get(path).expect(200, { viewerId: owner.id, comments: [comment], nextCursor: null });
  await owner.client.delete(`${path}/${comment.id}`).send({}).expect(404);
  await author.client.delete(`${path}/${comment.id}`).set("Origin", "https://other.example").send({}).expect(403);
  await author.client.delete(`${path}/${comment.id}`).send({}).expect(204);
  await prisma.comment.createMany({ data: Array.from({ length: 53 }, (_, index) => ({
    taskId: task.id, authorId: author.id, body: `Comment ${index}`, createdAt: new Date("2026-01-01"),
  })) });
  const first = await owner.client.get(path).expect(200);
  expect(first.body.comments).toHaveLength(50);
  expect(first.body.nextCursor).toEqual(expect.any(String));
  const older = await owner.client.get(path).query({ before: first.body.nextCursor }).expect(200);
  expect(older.body.comments).toHaveLength(3);
  expect(older.body.nextCursor).toBeNull();
  expect(new Set([...first.body.comments, ...older.body.comments].map(item => item.id)).size).toBe(53);
  await prisma.project.update({ where: { id: project.id }, data: { archivedAt: new Date() } });
  await owner.client.get(path).expect(200);
  await author.client.post(path).send({ body: "Archived" }).expect(404);
  await author.client.delete(`${path}/${first.body.comments[0].id}`).send({}).expect(404);
});
