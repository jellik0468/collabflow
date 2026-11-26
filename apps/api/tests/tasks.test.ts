import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const workspaces: string[] = [];
const fields = { title: " Draft release ", description: "Prepare the checklist.", status: "TODO", priority: "HIGH", dueDate: "2026-12-01", assigneeId: null };

async function account() {
  const client = request.agent(app);
  const result = await client.post("/api/auth/register").send({
    name: "Task Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  const id: string = result.body.user.id;
  users.push(id);
  return { client, id };
}

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("scopes task access, assignees and edits to workspace members and deletion to owners", async () => {
  const owner = await account();
  const member = await account();
  const outsider = await account();
  const { body: { workspace } } = await owner.client.post("/api/workspaces").send({ name: "Team" }).expect(201);
  workspaces.push(workspace.id);
  const { body: { project } } = await owner.client.post(`/api/workspaces/${workspace.id}/projects`)
    .send({ name: "Launch", description: "" }).expect(201);
  const projectPath = `/api/workspaces/${workspace.id}/projects/${project.id}`;
  const path = `${projectPath}/tasks`;
  await request(app).get(path).expect(401);
  await outsider.client.get(path).expect(404);
  await owner.client.post(path).send({ ...fields, assigneeId: outsider.id }).expect(404);
  await owner.client.post(path).send({ ...fields, dueDate: "2026-02-30" }).expect(400);
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id } });
  const result = await member.client.post(path).send({ ...fields, assigneeId: owner.id }).expect(201);
  const task = { ...fields, id: result.body.task.id, version: 1, title: "Draft release", assigneeId: owner.id, dueDate: "2026-12-01T00:00:00.000Z" };
  expect(result.body.task).toEqual(task);
  const listing = await member.client.get(path).expect(200);
  expect(listing.body.tasks).toEqual([task]);
  expect(listing.body.assignees).toEqual(expect.arrayContaining([
    { id: owner.id, name: "Task Tester" }, { id: member.id, name: "Task Tester" },
  ]));
  expect(listing.body.assignees).toHaveLength(2);
  const taskPath = `${path}/${task.id}`;
  await outsider.client.patch(taskPath).send(fields).expect(404);
  await member.client.patch(taskPath).send({ ...fields, assigneeId: outsider.id }).expect(404);
  await member.client.patch(taskPath).set("Origin", "https://other.example").send(fields).expect(403);
  await member.client.patch(taskPath).send({ ...fields, status: "DONE", dueDate: null }).expect(200, {
    task: { ...task, version: 2, status: "DONE", assigneeId: null, dueDate: null },
  });
  const statusPath = `${taskPath}/status`;
  await outsider.client.patch(statusPath).send({ status: "TODO" }).expect(404);
  await member.client.patch(statusPath).send({ status: "UNKNOWN" }).expect(400);
  await member.client.patch(statusPath).send({ status: "TODO", title: "Overwrite" }).expect(400);
  await member.client.patch(statusPath).send({ status: "IN_PROGRESS" }).expect(200, {
    task: { ...task, version: 3, status: "IN_PROGRESS", assigneeId: null, dueDate: null },
  });
  await member.client.delete(taskPath).send({}).expect(404);

  const archivedTask = await owner.client.post(path).send(fields).expect(201);
  await owner.client.delete(taskPath).send({}).expect(204);
  const historyPath = `${path}/${archivedTask.body.task.id}`;
  await owner.client.post(`${projectPath}/archive`).send({}).expect(200);
  await member.client.get(path).expect(200);
  await owner.client.post(path).send(fields).expect(404);
  await owner.client.patch(historyPath).send(fields).expect(404);
  await owner.client.patch(`${historyPath}/status`).send({ status: "DONE" }).expect(404);
  await owner.client.delete(historyPath).send({}).expect(404);
});


it("rejects stale task edits without overwriting a concurrent update", async () => {
  const owner = await account();
  const { body: { workspace } } = await owner.client.post("/api/workspaces").send({ name: "Conflict team" }).expect(201);
  workspaces.push(workspace.id);
  const { body: { project } } = await owner.client.post(`/api/workspaces/${workspace.id}/projects`).send({ name: "Concurrent project", description: "" }).expect(201);
  const path = `/api/workspaces/${workspace.id}/projects/${project.id}/tasks`;
  const { body: { task } } = await owner.client.post(path).send(fields).expect(201);
  expect(task.version).toBe(1);
  const taskPath = `${path}/${task.id}`;
  const attempts = await Promise.all([
    owner.client.patch(taskPath).send({ ...fields, title: "First update", expectedVersion: 1 }),
    owner.client.patch(taskPath).send({ ...fields, title: "Second update", expectedVersion: 1 }),
  ]);
  expect(attempts.map(result => result.status).sort()).toEqual([200, 409]);
  const saved = attempts.find(result => result.status === 200)!.body.task;
  expect(saved.version).toBe(2);
  await owner.client.patch(`${taskPath}/status`).send({ status: "DONE" }).expect(200);
  await owner.client.patch(taskPath).send({ ...fields, title: "Stale update", expectedVersion: 2 }).expect(409);
  const listing = await owner.client.get(path).expect(200);
  expect(listing.body.tasks[0]).toMatchObject({ title: saved.title, status: "DONE", version: 3 });
});
