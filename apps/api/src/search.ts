import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const searchRouter = Router({ mergeParams: true });
searchRouter.use(protectJsonWrites, requireUser);
searchRouter.get<{ workspaceId: string }>("/", async (req, res, next) => {
  const query = z.string().trim().min(2).max(100).safeParse(req.query.q);
  if (!query.success) { res.status(400).json({ error: "Search with between 2 and 100 characters." }); return; }
  try {
    const result = await prisma.$transaction(async tx => {
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: req.params.workspaceId, userId: res.locals.user.id } },
        select: { userId: true },
      });
      if (!membership) return null;
      const text = { contains: query.data, mode: "insensitive" as const };
      const projects = await tx.project.findMany({
        where: { workspaceId: req.params.workspaceId, archivedAt: null, OR: [{ name: text }, { description: text }] },
        orderBy: [{ name: "asc" }, { id: "asc" }], take: 11,
        select: { id: true, name: true, description: true },
      });
      const tasks = await tx.task.findMany({
        where: { project: { workspaceId: req.params.workspaceId, archivedAt: null }, OR: [{ title: text }, { description: text }] },
        orderBy: [{ title: "asc" }, { id: "asc" }], take: 26,
        select: { id: true, title: true, status: true, project: { select: { id: true, name: true } } },
      });
      return {
        projects: projects.slice(0, 10), tasks: tasks.slice(0, 25),
        moreProjects: projects.length > 10, moreTasks: tasks.length > 25,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!result) { res.status(404).json({ error: "Workspace unavailable." }); return; }
    res.json(result);
  } catch (error) { next(error); }
});
