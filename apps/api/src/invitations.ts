import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma, requireUser } from "./auth.js";
import { protectJsonWrites } from "./protect-json-writes.js";
import { invitationMailer } from "./mail.js";

export const workspaceInvitationRouter = Router({ mergeParams: true });
export const invitationRouter = Router();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const unavailable = { error: "Invitation unavailable, expired, or intended for another account." };
const inviteLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many invitations. Try again later." } });
workspaceInvitationRouter.use(protectJsonWrites, requireUser);
invitationRouter.use(protectJsonWrites, requireUser);

workspaceInvitationRouter.post<{ workspaceId: string }>("/", inviteLimit, async (req, res, next) => {
  const parsed = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid email address." }); return; }
  let invitationId: string | undefined;
  try {
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.workspaceId, members: { some: { userId: res.locals.user.id, role: "OWNER" } } },
      select: { id: true, name: true, members: { where: { user: { email: parsed.data.email } }, select: { userId: true } } },
    });
    if (!workspace) { res.status(404).json({ error: "Workspace unavailable." }); return; }
    if (workspace.members.length) { res.status(409).json({ error: "This account is already a workspace member." }); return; }
    const sendMail = invitationMailer();
    if (!sendMail) { res.status(503).json({ error: "Email delivery is not configured. Contact the workspace administrator." }); return; }
    const token = randomBytes(32).toString("base64url");
    invitationId = randomUUID();
    await prisma.workspace.update({
      where: { id: workspace.id, members: { some: { userId: res.locals.user.id, role: "OWNER" } } },
      data: { invitations: { create: { id: invitationId, email: parsed.data.email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) } } },
    });
    const url = new URL("/invite", process.env.WEB_ORIGIN ?? "http://localhost:5173");
    url.hash = `token=${token}`;
    try {
      await sendMail(parsed.data.email, `You have been invited to ${workspace.name} on CollabFlow.\n\nSign in or create an account using this email address, then open this link to join as a member. The invitation expires in 7 days.\n\n${url.href}\n\nIf you did not expect this invitation, you can ignore it.`);
    } catch {
      await prisma.invitation.deleteMany({ where: { id: invitationId, deliveredAt: null } });
      res.status(503).json({ error: "Could not deliver the invitation. Please try again." });
      return;
    }
    await prisma.invitation.update({ where: { id: invitationId }, data: { deliveredAt: new Date() } });
    res.status(201).json({ message: "Invitation sent." });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Workspace unavailable." }); return;
    }
    next(error);
  }
});

invitationRouter.post("/accept", async (req, res, next) => {
  const parsed = tokenInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(unavailable); return; }
  try {
    const result = await prisma.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hash(parsed.data.token) }, include: { workspace: { select: { id: true, name: true } } },
      });
      if (!invitation || invitation.email !== res.locals.user.email || !invitation.deliveredAt || invitation.expiresAt <= new Date()) return null;
      if (invitation.acceptedAt) {
        const membership = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: res.locals.user.id } },
        });
        return membership ? invitation.workspace : null;
      }
      const consumed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (!consumed.count) return null;
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: res.locals.user.id } },
        create: { workspaceId: invitation.workspaceId, userId: res.locals.user.id, role: "MEMBER" },
        update: {},
      });
      return invitation.workspace;
    });
    if (!result) { res.status(404).json(unavailable); return; }
    res.json({ workspace: result });
  } catch (error) { next(error); }
});
