import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const workspaceIds: string[] = [];
afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
it("searches matching task and project text only inside an authorized active workspace", async () => {
  const client = request.agent(app);
  const { body: { user } } = await client.post("/api/auth/register").send({
    name: "Search Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  users.push(user.id);
  const workspace = await prisma.workspace.create({ data: { name: "Search team", members: { create: { userId: user.id, role: "OWNER" } } } });
  const privateWorkspace = await prisma.workspace.create({ data: { name: "Private" } });
  workspaceIds.push(workspace.id, privateWorkspace.id);
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: "Release planning", description: "Prepare launch",
    tasks: { create: { title: "Verify launch", description: "Release checks" } } } });
  await prisma.project.create({ data: { workspaceId: workspace.id, name: "Release archive", archivedAt: new Date(),
    tasks: { create: { title: "Release secret" } } } });
  await prisma.project.create({ data: { workspaceId: privateWorkspace.id, name: "Release private",
    tasks: { create: { title: "Release private task" } } } });
  const path = `/api/workspaces/${workspace.id}/search`;
  await request(app).get(path).query({ q: "release" }).expect(401);
  await client.get(`/api/workspaces/${privateWorkspace.id}/search`).query({ q: "release" }).expect(404);
  await client.get(path).query({ q: "a" }).expect(400);
  const result = await client.get(path).query({ q: " RELEASE " }).expect(200);
  expect(result.body.projects).toEqual([{ id: project.id, name: "Release planning", description: "Prepare launch" }]);
  expect(result.body.tasks).toHaveLength(1);
  expect(result.body.tasks[0]).toMatchObject({ title: "Verify launch", project: { id: project.id, name: "Release planning" } });
  await client.get(path).query({ q: "No matches here" }).expect(200, { projects: [], tasks: [], moreProjects: false, moreTasks: false });
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } });
  await client.get(path).query({ q: "release" }).expect(404);
});
