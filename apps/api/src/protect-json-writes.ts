import type { RequestHandler } from "express";

export const protectJsonWrites: RequestHandler = (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
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
};
