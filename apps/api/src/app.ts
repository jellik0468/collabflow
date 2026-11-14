import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { authRouter } from "./auth.js";

export const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/auth", authRouter);
app.get("/api/health", (_req, res) => { res.json({ status: "ok", service: "collabflow-api" }); });
app.use("/api", (_req, res) => { res.status(404).json({ error: "Route not found" }); });
const errorHandler: express.ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
    res.status(error.status).json({ error: "Invalid request body" });
    return;
  }
  console.error("API request failed", error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};
app.use(errorHandler);
