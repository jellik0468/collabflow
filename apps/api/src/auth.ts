import { randomBytes, createHash } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const prisma = new PrismaClient();
export const authRouter = Router();
const cookieName = "collabflow_session";
const sessionDays = 7;
const authSchema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(10).max(128) });
const registerSchema = authSchema.extend({ name: z.string().trim().min(1).max(80) });
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const publicUser = (user: { id: string; name: string; email: string }) => ({ id: user.id, name: user.name, email: user.email });
const cookieOptions = { httpOnly: true as const, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
const reject = (res: Response) => res.status(401).json({ error: "Invalid credentials" });

async function createSession(userId: string, res: Response) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86400000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  res.cookie(cookieName, token, { ...cookieOptions, expires: expiresAt });
}
async function getSession(req: Request) {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length > 128) return null;
  return prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true }
  });
}
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session) { reject(res); return; }
    res.locals.user = session.user;
    next();
  } catch (error) { next(error); }
}
authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid registration details" }); return; }
    const { email, name, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, name, passwordHash } });
    await createSession(user.id, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "Email already registered" }); return;
    }
    next(error);
  }
});
authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) { reject(res); return; }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) { reject(res); return; }
    await createSession(user.id, res);
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});
authRouter.get("/me", requireUser, (_req, res) => { res.json({ user: publicUser(res.locals.user) }); });
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[cookieName];
    if (typeof token === "string") await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
  } catch (error) { next(error); }
});
