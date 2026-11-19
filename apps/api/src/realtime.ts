import type { Server as HttpServer } from "node:http";
import type { Request } from "express";
import cookieParser from "cookie-parser";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { getSession, prisma } from "./auth.js";

const subscription = z.object({ workspaceId: z.string().min(1).max(128), projectId: z.string().uuid() }).strict();
type Subscription = z.infer<typeof subscription>;
const listeners = new Set<(workspaceId: string, projectId: string) => void>();

export function publishProjectChange(workspaceId: string, projectId: string) {
  for (const listener of listeners) listener(workspaceId, projectId);
}

export function attachRealtime(server: HttpServer) {
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const io = new Server(server, {
    cors: { origin, credentials: true },
    maxHttpBufferSize: 4096,
    allowRequest: (req, callback) => callback(null, !req.headers.origin || req.headers.origin === origin),
  });
  io.engine.use(cookieParser());

  async function authorized(socket: Socket, target?: Subscription) {
    const session = await getSession(socket.request as Request);
    if (!session) return false;
    if (!target) return true;
    return Boolean(await prisma.project.findFirst({
      where: {
        id: target.projectId, workspaceId: target.workspaceId,
        workspace: { members: { some: { userId: session.userId } } },
      },
      select: { id: true },
    }));
  }

  io.use((socket, next) => {
    authorized(socket).then(valid => next(valid ? undefined : new Error("Authentication required")))
      .catch(() => next(new Error("Authentication unavailable")));
  });
  io.on("connection", socket => {
    let current: Subscription | undefined;
    let checking = false;
    let generation = 0;
    socket.on("subscribe-project", async (input: unknown, ack?: (result: { ok: boolean }) => void) => {
      if (checking) {
        if (typeof ack === "function") ack({ ok: false });
        return;
      }
      checking = true;
      current = undefined;
      generation++;
      try {
        const parsed = subscription.safeParse(input);
        if (!parsed.success || !await authorized(socket, parsed.data)) {
          if (typeof ack === "function") ack({ ok: false });
          return;
        }
        current = parsed.data;
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ ok: false });
      } finally { checking = false; }
    });

    const notify = (workspaceId: string, projectId: string) => {
      const target = current;
      const version = generation;
      if (!target || target.workspaceId !== workspaceId || target.projectId !== projectId) return;
      authorized(socket, target).then(valid => {
        if (version !== generation || !socket.connected) return;
        if (valid) socket.emit("project-changed");
        else socket.disconnect(true);
      }).catch(() => socket.disconnect(true));
    };
    listeners.add(notify);
    const expiryCheck = setInterval(() => {
      authorized(socket, current).then(valid => { if (!valid) socket.disconnect(true); })
        .catch(() => socket.disconnect(true));
    }, 30_000);
    expiryCheck.unref();
    socket.on("disconnect", () => {
      generation++;
      clearInterval(expiryCheck);
      listeners.delete(notify);
    });
  });
  return io;
}
