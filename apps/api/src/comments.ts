import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";
import { publishProjectChange } from "./realtime.js";

export const commentRouter = Router({ mergeParams: true });
type Params = { workspaceId: string; projectId: string; taskId: string; commentId: string };
const select = { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } } as const;
const unavailable = { error: "Task or comment unavailable." };
const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/).optional();

function taskAccess(params: Params, userId: string, writable = false): Prisma.TaskWhereInput {
  return {
    id: params.taskId,
    project: {
      id: params.projectId, workspaceId: params.workspaceId,
      ...(writable && { archivedAt: null }),
      workspace: { members: { some: { userId } } },
    },
  };
}

commentRouter.use(protectJsonWrites, requireUser);
commentRouter.get<Params>("/", async (req, res, next) => {
  const cursor = cursorSchema.safeParse(req.query.before);
  if (!cursor.success) { res.status(400).json({ error: "Invalid comments cursor." }); return; }
  const [date, id] = cursor.data?.split("|") ?? [];
  const createdAt = date ? new Date(date) : null;
  if (createdAt && !Number.isFinite(createdAt.getTime())) {
    res.status(400).json({ error: "Invalid comments cursor." });
    return;
  }
  try {
    const task = await prisma.task.findFirstOrThrow({
      where: taskAccess(req.params, res.locals.user.id),
      select: { comments: {
        where: createdAt ? { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] } : undefined,
        select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
      } },
    });
    const comments = task.comments.slice(0, 50);
    const oldest = comments[comments.length - 1];
    res.json({
      viewerId: res.locals.user.id,
      comments: comments.reverse(),
      nextCursor: task.comments.length > 50 && oldest ? `${oldest.createdAt.toISOString()}|${oldest.id}` : null,
    });
  } catch (error) { next(error); }
});

commentRouter.post<Params>("/", async (req, res, next) => {
  const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a comment between 1 and 2,000 characters." }); return; }
  try {
    const id = randomUUID();
    const task = await prisma.task.update({
      where: { ...taskAccess(req.params, res.locals.user.id, true), id: req.params.taskId },
      data: { comments: { create: { id, authorId: res.locals.user.id, body: parsed.data.body } } },
      select: { comments: { where: { id }, select } },
    });
    publishProjectChange(req.params.workspaceId, req.params.projectId);
    res.status(201).json({ comment: task.comments[0] });
  } catch (error) { next(error); }
});

commentRouter.delete<Params>("/:commentId", async (req, res, next) => {
  try {
    await prisma.comment.delete({
      where: { id: req.params.commentId, authorId: res.locals.user.id, task: taskAccess(req.params, res.locals.user.id, true) },
    });
    publishProjectChange(req.params.workspaceId, req.params.projectId);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

const commentNotFound: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    res.status(404).json(unavailable);
    return;
  }
  next(error);
};
commentRouter.use(commentNotFound);
