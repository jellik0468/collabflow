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

it("returns real workspace counts, excludes archives and isolates assignments and membership", async () => {
  const agent = request.agent(app);
  const { body: { user } } = await agent.post("/api/auth/register").send({
    name: "Dashboard Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  users.push(user.id);
  const other = await prisma.user.create({ data: { name: "Other", email: `${randomUUID()}@example.test`, passwordHash: "unused" } });
  users.push(other.id);
  const workspace = await prisma.workspace.create({
    data: { name: "Dashboard workspace", members: { create: { userId: user.id, role: "OWNER" } } },
  });
  workspaceIds.push(workspace.id);
  const path = `/api/workspaces/${workspace.id}/dashboard`;
  await request(app).get(path).expect(401);
  await agent.get("/api/workspaces/unknown/dashboard").expect(404);
  const empty = await agent.get(path).expect(200);
  expect(empty.body).toEqual({
    summary: { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, activeProjects: 0, assignedOpenTasks: 0, completionRate: 0 },
    projects: [], assignedTasks: [],
  });
  const project = await prisma.project.create({
    data: { workspaceId: workspace.id, name: "Active project", tasks: { create: [
      { title: "My task", status: "IN_PROGRESS", assigneeId: user.id, dueDate: new Date("2026-12-01") },
      { title: "Completed", status: "DONE", assigneeId: user.id },
      { title: "Other task", assigneeId: other.id },
    ] } },
  });
  await prisma.project.create({ data: { workspaceId: workspace.id, name: "Archived", archivedAt: new Date(),
    tasks: { create: { title: "Archived task", assigneeId: user.id } } } });
  const result = await agent.get(path).expect(200);
  expect(result.body.summary).toEqual({
    totalTasks: 3, completedTasks: 1, inProgressTasks: 1, activeProjects: 1, assignedOpenTasks: 1, completionRate: 33,
  });
  expect(result.body.projects).toEqual([{ id: project.id, name: "Active project", taskCount: 3, completedCount: 1 }]);
  expect(result.body.assignedTasks).toHaveLength(1);
  expect(result.body.assignedTasks[0]).toMatchObject({ title: "My task", project: { id: project.id }, dueDate: "2026-12-01T00:00:00.000Z" });
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } });
  await agent.get(path).expect(404);
});
