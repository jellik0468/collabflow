import { randomBytes, createHash } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const prisma = new PrismaClient();
export const authRouter = Router();
const cookieName = "collabflow_session";
const sessionDays = 7;
const authSchema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(10).max(128) });
const registerSchema = authSchema.extend({
  name: z.string().trim().min(1).max(80),
  password: authSchema.shape.password.refine(password => Buffer.byteLength(password, "utf8") <= 72)
});
const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);
const limitAttempts = (limit: number) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." }
});

authRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method === "POST") {
    const origin = req.get("Origin");
    const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    if (origin && origin !== webOrigin) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Expected application/json" });
      return;
    }
  }
  next();
});
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const publicUser = (user: { id: string; name: string; email: string }) => ({ id: user.id, name: user.name, email: user.email });
const cookieOptions = { httpOnly: true as const, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
const reject = (res: Response) => res.status(401).json({ error: "Invalid credentials" });

function makeSession() {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86400000);
  return { token, data: { tokenHash: hashToken(token), expiresAt } };
}

function setSessionCookie(res: Response, session: ReturnType<typeof makeSession>) {
  res.cookie(cookieName, session.token, { ...cookieOptions, expires: session.data.expiresAt });
}
async function getSession(req: Request) {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length > 128) return null;
  return prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, name: true, email: true } } }
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
authRouter.post("/register", limitAttempts(10), async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid registration details" }); return; }
    const { email, name, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const session = makeSession();
    const user = await prisma.user.create({
      data: { email, name, passwordHash, sessions: { create: session.data } }
    });
    setSessionCookie(res, session);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "Email already registered" }); return;
    }
    next(error);
  }
});
authRouter.post("/login", limitAttempts(20), async (req, res, next) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) { reject(res); return; }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || !valid || Buffer.byteLength(parsed.data.password, "utf8") > 72) { reject(res); return; }
    const session = makeSession();
    await prisma.session.create({ data: { userId: user.id, ...session.data } });
    setSessionCookie(res, session);
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
