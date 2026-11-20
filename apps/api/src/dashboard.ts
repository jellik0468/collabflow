import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.use(protectJsonWrites, requireUser);
dashboardRouter.get<{ workspaceId: string }>("/", async (req, res, next) => {
  const workspaceId = req.params.workspaceId;
  const userId: string = res.locals.user.id;
  try {
    const dashboard = await prisma.$transaction(async tx => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { userId: true },
      });
      if (!member) return null;
      const where = { project: { workspaceId, archivedAt: null } };
      const assignedWhere = { ...where, assigneeId: userId, status: { not: "DONE" as const } };
      const counts = await tx.task.groupBy({ by: ["status"], where, _count: true });
      const totalTasks = counts.reduce((sum, item) => sum + item._count, 0);
      const completedTasks = counts.find(item => item.status === "DONE")?._count ?? 0;
      const inProgressTasks = counts.find(item => item.status === "IN_PROGRESS")?._count ?? 0;
      const activeProjects = await tx.project.count({ where: { workspaceId, archivedAt: null } });
      const assignedOpenTasks = await tx.task.count({ where: assignedWhere });
      const projects = await tx.project.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 8,
        select: { id: true, name: true, _count: { select: { tasks: true } } },
      });
      const projectCompletions = await tx.task.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projects.map(project => project.id) }, status: "DONE" },
        _count: true,
      });
      const assignedTasks = await tx.task.findMany({
        where: assignedWhere,
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
        take: 10,
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true,
          project: { select: { id: true, name: true } },
        },
      });
      return {
        summary: { totalTasks, completedTasks, inProgressTasks, activeProjects, assignedOpenTasks,
          completionRate: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0 },
        projects: projects.map(project => ({
          id: project.id, name: project.name, taskCount: project._count.tasks,
          completedCount: projectCompletions.find(item => item.projectId === project.id)?._count ?? 0,
        })),
        assignedTasks,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!dashboard) {
      res.status(404).json({ error: "Workspace unavailable." });
      return;
    }
    res.json(dashboard);
  } catch (error) { next(error); }
});
