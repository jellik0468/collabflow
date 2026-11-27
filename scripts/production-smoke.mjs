import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) throw new Error("Use a disposable PostgreSQL DATABASE_URL for the production smoke test.");
const directory = await mkdtemp(join(tmpdir(), "collabflow-production-"));
const prisma = new PrismaClient();
let api;
let browser;
let proxy;
let email;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
    "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore" });
  // Reserve a local API port before starting the actual compiled production entry point.
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const apiPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  proxy = https.createServer({
    key: await readFile(join(directory, "key.pem")), cert: await readFile(join(directory, "cert.pem")),
  }, (req, res) => {
    const upstream = http.request({
      hostname: "127.0.0.1", port: apiPort, path: req.url, method: req.method,
      headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" },
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(503); res.end(); });
    req.pipe(upstream);
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const origin = `https://127.0.0.1:${proxy.address().port}`;
  api = spawn(process.execPath, ["apps/api/dist/index.js"], {
    env: { ...process.env, NODE_ENV: "production", WEB_ORIGIN: origin, PORT: String(apiPort), TRUST_PROXY: "loopback" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  api.stdout.on("data", data => { output += data; });
  api.stderr.on("data", data => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null) throw new Error(`Production server exited. ${output}`);
    try {
      if ((await fetch(`http://127.0.0.1:${apiPort}/api/ready`)).ok) break;
    } catch {}
    if (attempt === 99) throw new Error("Production server readiness timed out.");
    await delay(100);
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const response = await page.goto(origin + "/app");
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-security-policy"], /default-src 'self'/);
  await page.getByRole("heading", { name: "Sign in to CollabFlow" }).waitFor();
  assert.equal((await page.request.get(origin + "/api/does-not-exist")).status(), 404);
  assert.equal((await page.request.get(origin + "/assets/missing.js")).status(), 404);
  const asset = await page.locator('script[src^="/assets/"]').getAttribute("src");
  const builtAsset = await page.request.get(origin + asset);
  assert.equal(builtAsset.status(), 200);
  assert.match(builtAsset.headers()["cache-control"], /immutable/);
  await page.getByRole("link", { name: "Create an account" }).click();
  email = `production-${Date.now()}@example.test`;
  await page.getByLabel("Full name").fill("Production Tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("production-smoke-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Create your first workspace" }).waitFor();
  const session = (await context.cookies()).find(cookie => cookie.name === "collabflow_session");
  assert.ok(session?.secure && session.httpOnly && session.sameSite === "Lax");
  await page.reload();
  await page.getByRole("heading", { name: "Create your first workspace" }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to CollabFlow" }).waitFor();
  await browser.close();
  browser = null;
  const exited = once(api, "exit");
  api.kill("SIGTERM");
  const [code] = await exited;
  assert.equal(code, 0);
  api = null;
  console.log("Production HTTPS smoke passed: built assets, SPA links, readiness, secure session persistence, registration, logout and graceful shutdown.");
} finally {
  await browser?.close();
  api?.kill("SIGKILL");
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if (email) await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
