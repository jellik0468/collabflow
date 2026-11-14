import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const port = Number(process.env.PORT ?? 4000);
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_req, res) => { res.json({ status: "ok", service: "collabflow-api" }); });
app.use("/api", (_req, res) => { res.status(404).json({ error: "Route not found" }); });
app.listen(port, () => { console.info(`CollabFlow API listening on ${port}`); });
