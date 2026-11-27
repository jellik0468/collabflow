import "dotenv/config";

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  const origin = new URL(env.WEB_ORIGIN ?? "http://localhost:5173");
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.href !== origin.origin + "/") {
    throw new Error("WEB_ORIGIN must be an HTTP or HTTPS origin without a path.");
  }
  if (production && (!env.WEB_ORIGIN || origin.protocol !== "https:")) throw new Error("Production requires an HTTPS WEB_ORIGIN.");
  if (production && !env.DATABASE_URL) throw new Error("Production requires DATABASE_URL.");
  const trustProxy = env.TRUST_PROXY?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  if (trustProxy.some(value => /^(true|false|\d+)$/i.test(value))) throw new Error("TRUST_PROXY must name trusted proxy addresses or CIDR ranges.");
  return { production, port, origin: origin.origin, trustProxy };
}
