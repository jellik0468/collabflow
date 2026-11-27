import { createServer } from "node:http";
import { app } from "./app.js";
import { prisma } from "./auth.js";
import { readRuntimeConfig } from "./config.js";
import { attachRealtime } from "./realtime.js";

const { port } = readRuntimeConfig();
const server = createServer(app);
const realtime = attachRealtime(server);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  realtime.close(() => {
    prisma.$disconnect().then(() => { clearTimeout(timeout); process.exit(0); })
      .catch(() => process.exit(1));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(port, () => { console.info(`CollabFlow listening on ${port}`); });
