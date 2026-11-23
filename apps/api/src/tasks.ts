import { publishProjectChange } from "./realtime.js";
import { randomUUID } from "node:crypto";
import { Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const taskRouter = Router({ mergeParams: true });
const details = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  status: z.nativeEnum(TaskStatus),
  priority: z.nativeEnum(TaskPriority),
  dueDate: z.string().date().refine(value => value >= "0001-01-01").nullable(),
  assigneeId: z.string().min(1).max(128).nullable(),
}).strict();
const selection = {
  id: true, title: true, description: true, status: true, priority: true, dueDate: true, assigneeId: true,
} as const;
const unavailable = { error: "Project or task unavailable." };

function projectAccess(params: Record<string, string>, userId: string, assigneeId?: string | null): Prisma.ProjectWhereInput {
  const memberships = [{ members: { some: { userId } } }];
  if (assigneeId) memberships.push({ members: { some: { userId: assigneeId } } });
  return { id: params.projectId, workspaceId: params.workspaceId, workspace: { AND: memberships } };
}

taskRouter.use(protectJsonWrites, requireUser);
taskRouter.use((req, res, next) => {
  const params = { ...req.params } as { workspaceId: string; projectId?: string };
  if (["POST", "PATCH", "DELETE"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        publishProjectChange(params.workspaceId, params.projectId!);
      }
    });
  }
  next();
});
taskRouter.get("/", async (req, res, next) => {
  try {
    const project = await prisma.project.findFirstOrThrow({
      where: projectAccess(req.params, res.locals.user.id),
      select: {
        tasks: { select: selection, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        workspace: { select: { members: { select: { user: { select: { id: true, name: true } } }, orderBy: [{ user: { name: "asc" } }, { userId: "asc" }] } } },
      },
    });
    res.json({ tasks: project.tasks, assignees: project.workspace.members.map(member => member.user) });
  } catch (error) { next(error); }
});

function saveTask(creating: boolean): RequestHandler {
  return async (req, res, next) => {
    const parsed = details.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid title, description, status, priority, assignee and due date." });
      return;
    }
    const { dueDate, assigneeId, ...fields } = parsed.data;
    const data = { ...fields, assigneeId, dueDate: dueDate ? new Date(dueDate) : null };
    const project = { ...projectAccess(req.params, res.locals.user.id, assigneeId), archivedAt: null };
    try {
      if (creating) {
        const id = randomUUID();
        const { tasks } = await prisma.project.update({
          where: { ...project, id: req.params.projectId },
          data: { tasks: { create: { ...data, id, ...(assigneeId && { notifications: { create: { userId: assigneeId, kind: "TASK_ASSIGNED" } } }) } } },
          select: { tasks: { where: { id }, select: selection } },
        });
        res.status(201).json({ task: tasks[0] });
        return;
      }
      const task = await prisma.$transaction(async tx => {
        // Lock the task before comparing assignments so concurrent saves emit one notification per change.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Task" WHERE id = ${req.params.taskId} FOR UPDATE`);
        const previous = await tx.task.findFirstOrThrow({
          where: { id: req.params.taskId, project }, select: { assigneeId: true },
        });
        return tx.task.update({
          where: { id: req.params.taskId, project },
          data: { ...data, ...(assigneeId && assigneeId !== previous.assigneeId && {
            notifications: { create: { userId: assigneeId, kind: "TASK_ASSIGNED" } },
          }) },
          select: selection,
        });
      });
      res.json({ task });
    } catch (error) { next(error); }
  };
}

taskRouter.post("/", saveTask(true));
taskRouter.patch("/:taskId", saveTask(false));

taskRouter.patch("/:taskId/status", async (req, res, next) => {
  const parsed = z.object({ status: z.nativeEnum(TaskStatus) }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid task status." });
    return;
  }
  try {
    const task = await prisma.task.update({
      where: {
        id: req.params.taskId,
        project: { ...projectAccess(req.params, res.locals.user.id), archivedAt: null },
      },
      data: parsed.data,
      select: selection,
    });
    res.json({ task });
  } catch (error) { next(error); }
});

taskRouter.delete<{ workspaceId: string; projectId: string; taskId: string }>("/:taskId", async (req, res, next) => {
  try {
    await prisma.task.delete({
      where: {
        id: req.params.taskId,
        project: {
          id: req.params.projectId,
          workspaceId: req.params.workspaceId,
          archivedAt: null,
          workspace: { members: { some: { userId: res.locals.user.id, role: "OWNER" } } },
        },
      },
    });
    res.sendStatus(204);
  } catch (error) { next(error); }
});

const taskNotFound: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    res.status(404).json(unavailable);
    return;
  }
  next(error);
};
taskRouter.use(taskNotFound);
