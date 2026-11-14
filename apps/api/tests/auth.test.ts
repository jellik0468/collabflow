import { randomUUID, createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/auth.js";

const users: string[] = [];
const password = "correct-horse-battery-staple";
const register = () => {
  const email = `${randomUUID()}@example.test`;
  users.push(email);
  return request(app).post("/api/auth/register").send({ name: "Test User", email, password });
};

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: users } } });
  await prisma.$disconnect();
});

describe("PostgreSQL-backed authentication", () => {
  it("registers atomically and persists only hashes", async () => {
    const result = await register().expect(201);
    const cookie = result.headers["set-cookie"][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Expires=/);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.body.user.id },
      include: { sessions: true }
    });
    expect(Object.keys(result.body.user).sort()).toEqual(["email", "id", "name"]);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.sessions).toHaveLength(1);
    const token = cookie.split(";")[0].split("=")[1];
    expect(user.sessions[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    await request(app).get("/api/auth/me").set("Cookie", cookie.split(";")[0]).expect(200);
    await request(app).post("/api/auth/register")
      .send({ name: user.name, email: user.email.toUpperCase(), password }).expect(409);
    await request(app).post("/api/auth/register")
      .send({ name: user.name, email: "long@example.test", password: "🟣".repeat(19) }).expect(400);
  });

  it("accepts valid login and rejects invalid credentials", async () => {
    const { body: { user } } = await register().expect(201);
    await request(app).post("/api/auth/login").send({ email: user.email, password: "incorrect-password" }).expect(401);
    await request(app).post("/api/auth/login").send({ email: "unknown@example.test", password }).expect(401);
    await request(app).post("/api/auth/login").send({ email: user.email.toUpperCase(), password }).expect(200);
  });

  it("rejects unauthenticated and expired sessions", async () => {
    await request(app).get("/api/auth/me").expect(401);
    const result = await register().expect(201);
    await prisma.session.updateMany({
      where: { userId: result.body.user.id },
      data: { expiresAt: new Date(0) }
    });
    await request(app).get("/api/auth/me").set("Cookie", result.headers["set-cookie"][0].split(";")[0]).expect(401);
  });

  it("revokes the session on logout and clears its cookie", async () => {
    const result = await register().expect(201);
    const cookie = result.headers["set-cookie"][0].split(";")[0];
    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie).send({}).expect(204);
    expect(logout.headers["set-cookie"][0]).toContain("collabflow_session=;");
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    expect(await prisma.session.count({
      where: { userId: result.body.user.id, revokedAt: { not: null } }
    })).toBe(1);
  });

  it("rejects cross-origin writes and form-encoded requests", async () => {
    await request(app).post("/api/auth/logout").set("Origin", "https://other.example").send({}).expect(403);
    await request(app).post("/api/auth/logout").type("form").send({}).expect(415);
    await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{").expect(400);
  });

  it("limits repeated authentication attempts", async () => {
    let status = 0;
    for (let attempt = 0; attempt < 21 && status !== 429; attempt++) {
      const response = await request(app).post("/api/auth/login").send({});
      status = response.status;
      expect([401, 429]).toContain(status);
    }
    expect(status).toBe(429);
  });
});
