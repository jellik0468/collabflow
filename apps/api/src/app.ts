import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readRuntimeConfig } from "./config.js";
import { searchRouter } from "./search.js";
import { notificationRouter } from "./notifications.js";
import { invitationRouter, workspaceInvitationRouter } from "./invitations.js";
import { commentRouter } from "./comments.js";
import { dashboardRouter } from "./dashboard.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { taskRouter } from "./tasks.js";
import { projectRouter } from "./projects.js";
import { workspaceRouter } from "./workspaces.js";
import { prisma, authRouter } from "./auth.js";

const config = readRuntimeConfig();
export const app = express();
if (config.trustProxy.length) app.set("trust proxy", config.trustProxy);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
  } },
}));
app.use(cors({ origin: config.origin }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/invitations", invitationRouter);
app.use("/api/workspaces/:workspaceId/invitations", workspaceInvitationRouter);
app.use("/api/workspaces/:workspaceId/projects/:projectId/tasks/:taskId/comments", commentRouter);
app.use("/api/workspaces/:workspaceId/projects/:projectId/tasks", taskRouter);
app.use("/api/workspaces/:workspaceId/projects", projectRouter);
app.use("/api/workspaces/:workspaceId/dashboard", dashboardRouter);
app.use("/api/workspaces/:workspaceId/search", searchRouter);
app.use("/api/workspaces", workspaceRouter);
app.get("/api/health", (_req, res) => { res.json({ status: "ok", service: "collabflow-api" }); });
app.get("/api/ready", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.use("/api", (_req, res) => { res.status(404).json({ error: "Route not found" }); });
if (config.production) {
  const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const indexPath = fileURLToPath(new URL("../../web/dist/index.html", import.meta.url));
  if (!existsSync(indexPath)) throw new Error("The frontend build is missing. Run npm run build before starting production.");
  app.use("/assets", express.static(webRoot + "assets", { immutable: true, maxAge: "1y", fallthrough: false }));
  app.use(express.static(webRoot, { index: false, maxAge: 0 }));
  app.get(["/", "/login", "/register", "/invite", "/app", "/app/*"], (req, res, next) => {
    if (!req.accepts("html")) { next(); return; }
    res.set("Cache-Control", "no-store");
    res.sendFile(indexPath);
  });
  app.use((_req, res) => { res.status(404).json({ error: "Route not found" }); });
}
const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.status === 404) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
    res.status(error.status).json({ error: "Invalid request body" });
    return;
  }
  console.error("API request failed", error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};
app.use(errorHandler);
