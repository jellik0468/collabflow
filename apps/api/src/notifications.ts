import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const notificationRouter = Router();
notificationRouter.use(protectJsonWrites, requireUser);

function visible(userId: string, email: string): Prisma.NotificationWhereInput {
  return {
    userId,
    OR: [
      { kind: "TASK_ASSIGNED", task: { assigneeId: userId,
        project: { workspace: { members: { some: { userId } } } } } },
      { kind: "INVITATION", invitation: { email, deliveredAt: { not: null }, acceptedAt: null, expiresAt: { gt: new Date() } } },
    ],
  };
}
notificationRouter.get("/", async (req, res, next) => {
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/).optional().safeParse(req.query.before);
  if (!parsed.success) { res.status(400).json({ error: "Invalid notification cursor." }); return; }
  const [date, cursorId] = parsed.data?.split("|") ?? [];
  const createdAt = date ? new Date(date) : null;
  if (createdAt && !Number.isFinite(createdAt.getTime())) { res.status(400).json({ error: "Invalid notification cursor." }); return; }
  try {
    const { id: userId, email } = res.locals.user;
    // Materialize invitation notices for users who registered after delivery, without exposing invite tokens.
    const pending = await prisma.invitation.findMany({
      where: { email, deliveredAt: { not: null }, acceptedAt: null, expiresAt: { gt: new Date() },
        notifications: { none: { userId } } },
      select: { id: true }, take: 100,
    });
    if (pending.length) await prisma.notification.createMany({
      data: pending.map(invitation => ({ userId, invitationId: invitation.id, kind: "INVITATION" as const })),
      skipDuplicates: true,
    });
    const where = visible(userId, email);
    const result = await prisma.$transaction(async tx => {
      const unread = await tx.notification.count({ where: { ...where, readAt: null } });
      const total = await tx.notification.count({ where });
      const notifications = await tx.notification.findMany({
        where: createdAt ? { AND: [where, { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursorId } }] }] } : where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
        select: {
          id: true, kind: true, readAt: true, createdAt: true,
          task: { select: { id: true, title: true, project: { select: { id: true, workspaceId: true, name: true } } } },
          invitation: { select: { workspace: { select: { name: true } } } },
        },
      });
      const page = notifications.slice(0, 50);
      const oldest = page[page.length - 1];
      return { unread, total, nextCursor: notifications.length > 50 && oldest ? `${oldest.createdAt.toISOString()}|${oldest.id}` : null, notifications: page.map(item => ({
        id: item.id, kind: item.kind, readAt: item.readAt, createdAt: item.createdAt,
        message: item.task ? `You were assigned “${item.task.title}” in ${item.task.project.name}.`
          : `You were invited to ${item.invitation!.workspace.name}. Check your email for the secure join link.`,
        href: item.task ? `/app/workspaces/${item.task.project.workspaceId}/projects/${item.task.project.id}?task=${item.task.id}` : null,
      })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    res.json(result);
  } catch (error) { next(error); }
});
notificationRouter.post("/:id/read", async (req, res, next) => {
  try {
    const count = await prisma.notification.updateMany({
      where: { ...visible(res.locals.user.id, res.locals.user.email), id: req.params.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (!count.count && !await prisma.notification.findFirst({ where: { ...visible(res.locals.user.id, res.locals.user.email), id: req.params.id }, select: { id: true } })) {
      res.status(404).json({ error: "Notification unavailable." });
      return;
    }
    res.sendStatus(204);
  } catch (error) { next(error); }
});
