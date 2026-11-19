import { createServer } from "node:http";
import { app } from "./app.js";
import { attachRealtime } from "./realtime.js";

const port = Number(process.env.PORT ?? 4000);
const server = createServer(app);
attachRealtime(server);
server.listen(port, () => { console.info(`CollabFlow API listening on ${port}`); });
