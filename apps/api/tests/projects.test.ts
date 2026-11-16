import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const userIds: string[] = [];
const workspaceIds: string[] = [];
const projectDetails = { name: "  Release plan ", description: " Prepare launch. " };

async function account() {
  const agent = request.agent(app);
  const { body } = await agent.post("/api/auth/register").send({
    name: "Project Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  userIds.push(body.user.id);
  return { agent, id: body.user.id as string };
}

async function createWorkspace(agent: Awaited<ReturnType<typeof account>>["agent"]) {
  const { body } = await agent.post("/api/workspaces").send({ name: "Test workspace" }).expect(201);
  workspaceIds.push(body.workspace.id);
  return body.workspace.id as string;
}

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

it("scopes projects to a workspace and protects access and mutations", async () => {
  const owner = await account();
  const reader = await account();
  const workspaceId = await createWorkspace(owner.agent);
  const otherWorkspaceId = await createWorkspace(owner.agent);
  const path = `/api/workspaces/${workspaceId}/projects`;
  await request(app).get(path).expect(401);
  await reader.agent.get(path).expect(404);
  await reader.agent.post(path).send(projectDetails).expect(404);
  await owner.agent.get(path).expect(200, { projects: [] });
  await owner.agent.post(path).send({ ...projectDetails, name: " " }).expect(400);
  await owner.agent.post(path).send({ ...projectDetails, description: "a".repeat(1001) }).expect(400);

  const { body: { project } } = await owner.agent.post(path).send(projectDetails).expect(201);
  expect(project).toEqual({ id: expect.any(String), name: "Release plan", description: "Prepare launch.", archivedAt: null });
  await owner.agent.get(`/api/workspaces/${otherWorkspaceId}/projects`).expect(200, { projects: [] });
  await owner.agent.patch(`/api/workspaces/${otherWorkspaceId}/projects/${project.id}`).send(projectDetails).expect(404);

  await prisma.workspaceMember.create({ data: { workspaceId, userId: reader.id } });
  await reader.agent.get(path).expect(200, { projects: [project] });
  await reader.agent.post(path).send(projectDetails).expect(404);
  await reader.agent.patch(`${path}/${project.id}`).send(projectDetails).expect(404);
  await reader.agent.post(`${path}/${project.id}/archive`).send({}).expect(404);
  await owner.agent.patch(`${path}/${project.id}`).set("Origin", "https://other.example").send(projectDetails).expect(403);
});

it("persists edits and archives projects without changing the archive date on retry", async () => {
  const { agent } = await account();
  const workspaceId = await createWorkspace(agent);
  const path = `/api/workspaces/${workspaceId}/projects`;
  const { body: { project } } = await agent.post(path).send(projectDetails).expect(201);
  const projectPath = `${path}/${project.id}`;
  const fields = { name: "Release readiness", description: "Confirm milestones." };
  await agent.patch(projectPath).send(fields).expect(200, { project: { ...project, ...fields } });
  const { body: { project: archived } } = await agent.post(`${projectPath}/archive`).send({}).expect(200);
  expect(archived).toEqual({ id: project.id, ...fields, archivedAt: expect.any(String) });
  await agent.post(`${projectPath}/archive`).send({}).expect(200, { project: archived });
  await agent.patch(projectPath).send(projectDetails).expect(404);
  await agent.get(path).expect(200, { projects: [archived] });
});
