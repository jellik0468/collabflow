import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { io as connect, type Socket } from "socket.io-client";
import { app } from "../src/app.js";
import { attachRealtime, publishProjectChange } from "../src/realtime.js";
import { prisma } from "../src/auth.js";

const server = createServer(app);
const realtime = attachRealtime(server);
const sockets: Socket[] = [];
const users: string[] = [];
const workspaces: string[] = [];
afterAll(async () => {
  sockets.forEach(socket => socket.disconnect());
  await new Promise<void>(resolve => realtime.close(() => resolve()));
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("authenticates subscriptions, delivers persisted changes and rejects revoked sessions", async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server unavailable");
  const url = `http://127.0.0.1:${address.port}`;
  const agent = request.agent(app);
  const registration = await agent.post("/api/auth/register").send({
    name: "Live Tester", email: `${randomUUID()}@example.test`, password: "example-password-for-tests",
  }).expect(201);
  users.push(registration.body.user.id);
  const cookie = registration.headers["set-cookie"][0].split(";")[0];
  const { body: { workspace } } = await agent.post("/api/workspaces").send({ name: "Live workspace" }).expect(201);
  workspaces.push(workspace.id);
  const { body: { project } } = await agent.post(`/api/workspaces/${workspace.id}/projects`)
    .send({ name: "Live project", description: "" }).expect(201);
  const target = { workspaceId: workspace.id, projectId: project.id };

  function socket(headers: Record<string, string> = {}) {
    const client = connect(url, { extraHeaders: headers, reconnection: false, autoConnect: false });
    sockets.push(client);
    return client;
  }
  const anonymous = socket();
  const rejected = new Promise<string>(resolve => anonymous.once("connect_error", error => resolve(error.message)));
  anonymous.connect();
  expect(await rejected).toBe("Authentication required");

  const client = socket({ Cookie: cookie });
  const ready = new Promise<void>(resolve => client.once("connect", resolve));
  client.connect();
  await ready;
  expect(await client.emitWithAck("subscribe-project", { ...target, workspaceId: "other" })).toEqual({ ok: false });
  expect(await client.emitWithAck("subscribe-project", target)).toEqual({ ok: true });
  const changed = new Promise<void>(resolve => client.once("project-changed", resolve));
  await agent.post(`/api/workspaces/${workspace.id}/projects/${project.id}/tasks`).send({
    title: "Shared task", description: "", status: "TODO", priority: "MEDIUM", dueDate: null, assigneeId: null,
  }).expect(201);
  await changed;
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: registration.body.user.id } } });
  const disconnected = new Promise<void>(resolve => client.once("disconnect", () => resolve()));
  publishProjectChange(workspace.id, project.id);
  await disconnected;
  await agent.post("/api/auth/logout").send({}).expect(204);
  const revoked = socket({ Cookie: cookie });
  const revocation = new Promise<string>(resolve => revoked.once("connect_error", error => resolve(error.message)));
  revoked.connect();
  expect(await revocation).toBe("Authentication required");
}, 15_000);
