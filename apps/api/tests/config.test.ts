import { expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";

it("requires valid production origin, database and explicitly scoped proxy trust", () => {
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://local/test", WEB_ORIGIN: "https://collabflow.example" };
  expect(readRuntimeConfig(env)).toMatchObject({ production: true, port: 4000, origin: env.WEB_ORIGIN, trustProxy: [] });
  expect(() => readRuntimeConfig({ ...env, WEB_ORIGIN: "http://collabflow.example" })).toThrow(/HTTPS/);
  expect(() => readRuntimeConfig({ ...env, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  expect(() => readRuntimeConfig({ ...env, WEB_ORIGIN: "https://collabflow.example/path" })).toThrow(/without a path/);
  expect(() => readRuntimeConfig({ ...env, PORT: "NaN" })).toThrow(/PORT/);
  expect(() => readRuntimeConfig({ ...env, TRUST_PROXY: "true" })).toThrow(/trusted proxy/);
  expect(readRuntimeConfig({ ...env, TRUST_PROXY: "loopback" }).trustProxy).toEqual(["loopback"]);
});
