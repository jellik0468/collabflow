import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const projectRouter = Router({ mergeParams: true });
const details = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
}).strict();
const selection = { id: true, name: true, description: true, archivedAt: true } as const;
const unavailable = { error: "Workspace or project unavailable." };

projectRouter.use(protectJsonWrites, requireUser);

projectRouter.get("/", async (req, res, next) => {
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, members: { some: { userId: res.locals.user.id } } },
      select: { projects: { select: selection, orderBy: [{ createdAt: "desc" }, { id: "asc" }] } },
    });
    if (!workspace) {
      res.status(404).json(unavailable);
      return;
    }
    res.json(workspace);
  } catch (error) { next(error); }
});

projectRouter.post("/", async (req, res, next) => {
  const parsed = details.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a project name up to 100 characters and a description up to 1,000 characters." });
    return;
  }
  try {
    const { workspaceId } = req.params as { workspaceId: string };
    const id = randomUUID();
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId, members: { some: { userId: res.locals.user.id, role: "OWNER" } } },
      data: { projects: { create: { id, ...parsed.data } } },
      select: { projects: { where: { id }, select: selection } },
    });
    res.status(201).json({ project: workspace.projects[0] });
  } catch (error) { next(error); }
});

projectRouter.patch("/:projectId", async (req, res, next) => {
  const parsed = details.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a project name up to 100 characters and a description up to 1,000 characters." });
    return;
  }
  try {
    const { workspaceId, projectId } = req.params as { workspaceId: string; projectId: string };
    const project = await prisma.project.update({
      where: {
        id: projectId,
        workspaceId,
        archivedAt: null,
        workspace: { members: { some: { userId: res.locals.user.id, role: "OWNER" } } },
      },
      data: parsed.data,
      select: selection,
    });
    res.json({ project });
  } catch (error) { next(error); }
});

projectRouter.post("/:projectId/archive", async (req, res, next) => {
  try {
    const { workspaceId, projectId } = req.params as { workspaceId: string; projectId: string };
    const where = {
      id: projectId,
      workspaceId,
      workspace: { members: { some: { userId: res.locals.user.id, role: "OWNER" as const } } },
    };
    const project = await prisma.$transaction(async transaction => {
      await transaction.project.updateMany({ where: { ...where, archivedAt: null }, data: { archivedAt: new Date() } });
      return transaction.project.findFirstOrThrow({ where, select: selection });
    });
    res.json({ project });
  } catch (error) { next(error); }
});

const projectNotFound: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    res.status(404).json(unavailable);
    return;
  }
  next(error);
};
projectRouter.use(projectNotFound);
