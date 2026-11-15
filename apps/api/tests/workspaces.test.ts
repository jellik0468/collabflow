import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const userIds: string[] = [];
const workspaceIds: string[] = [];

async function account() {
  const agent = request.agent(app);
  const result = await agent.post("/api/auth/register").send({
    name: "Test User",
    email: `${randomUUID()}@example.test`,
    password: "example-password-for-tests",
  }).expect(201);
  userIds.push(result.body.user.id);
  return { agent, id: result.body.user.id };
}

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

it("requires authentication for workspace operations", async () => {
  await request(app).get("/api/workspaces").expect(401);
  await request(app).post("/api/workspaces").send({ name: "Example" }).expect(401);
  await request(app).patch("/api/workspaces/example").send({ name: "Example" }).expect(401);
});

it("persists workspaces, isolates membership and allows only the owner to rename", async () => {
  const owner = await account();
  const other = await account();
  await owner.agent.get("/api/workspaces").expect(200, { workspaces: [] });
  await owner.agent.post("/api/workspaces").send({ name: "   " }).expect(400);
  const { body: { workspace } } = await owner.agent.post("/api/workspaces")
    .send({ name: "  Product Team  " }).expect(201);
  workspaceIds.push(workspace.id);
  expect(workspace).toEqual({ id: expect.any(String), name: "Product Team", role: "OWNER" });
  await owner.agent.get("/api/workspaces").expect(200, { workspaces: [workspace] });
  await other.agent.get("/api/workspaces").expect(200, { workspaces: [] });

  const path = `/api/workspaces/${workspace.id}`;
  await other.agent.patch(path).send({ name: "Other name" }).expect(404);
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: other.id } });
  await other.agent.get("/api/workspaces").expect(200, { workspaces: [{ ...workspace, role: "MEMBER" }] });
  await other.agent.patch(path).send({ name: "Other name" }).expect(404);
  await owner.agent.patch(path).set("Origin", "https://other.example").send({ name: "Other name" }).expect(403);
  await owner.agent.patch(path).send({ name: "X".repeat(81) }).expect(400);
  await owner.agent.patch(path).send({ name: "Product Studio" }).expect(200, {
    workspace: { ...workspace, name: "Product Studio" },
  });
  await other.agent.get("/api/workspaces").expect(200, {
    workspaces: [{ ...workspace, name: "Product Studio", role: "MEMBER" }],
  });
});
