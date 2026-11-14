import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "./tests",
  workers: 2,
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: [
    { command: "npm run start -w @collabflow/api", cwd: fileURLToPath(new URL("../..", import.meta.url)), url: "http://127.0.0.1:4000/api/health", env: { WEB_ORIGIN: baseURL }, timeout: 60_000 },
    { command: "npm run dev -- --host 127.0.0.1 --strictPort", url: baseURL, timeout: 60_000 },
  ],
});
