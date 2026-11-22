import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";

export const workspaceRouter = Router();
const workspaceName = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const select = { id: true, name: true } as const;

workspaceRouter.use(protectJsonWrites, requireUser);

workspaceRouter.get("/", async (_req, res, next) => {
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: res.locals.user.id },
      orderBy: [{ workspace: { createdAt: "asc" } }, { workspaceId: "asc" }],
      select: { workspace: { select }, role: true },
    });
    res.json({ workspaces: memberships.map(({ workspace, role }) => ({ ...workspace, role })) });
  } catch (error) { next(error); }
});

workspaceRouter.post("/", async (req, res, next) => {
  const parsed = workspaceName.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a workspace name between 1 and 80 characters." });
    return;
  }
  try {
    const workspace = await prisma.workspace.create({
      data: { name: parsed.data.name, members: { create: { userId: res.locals.user.id, role: "OWNER" } } },
      select,
    });
    res.status(201).json({ workspace: { ...workspace, role: "OWNER" } });
  } catch (error) { next(error); }
});

workspaceRouter.patch("/:id", async (req, res, next) => {
  const parsed = workspaceName.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a workspace name between 1 and 80 characters." });
    return;
  }
  try {
    const workspace = await prisma.workspace.update({
      where: {
        id: req.params.id,
        members: { some: { userId: res.locals.user.id, role: "OWNER" } },
      },
      data: { name: parsed.data.name },
      select,
    });
    res.json({ workspace: { ...workspace, role: "OWNER" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Workspace unavailable for renaming." });
      return;
    }
    next(error);
  }
});


workspaceRouter.get("/:id/members", async (req, res, next) => {
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, members: { some: { userId: res.locals.user.id } } },
      select: { members: { orderBy: [{ role: "asc" }, { user: { name: "asc" } }], select: {
        role: true, user: { select: { id: true, name: true, email: true } },
      } } },
    });
    if (!workspace) { res.status(404).json({ error: "Workspace unavailable." }); return; }
    res.json({ members: workspace.members.map(({ role, user }) => ({ ...user, role })) });
  } catch (error) { next(error); }
});
