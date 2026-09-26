import { defineConfig } from "@playwright/test";
if (!process.env.DB_NAME?.endsWith("_test"))
  throw new Error("Browser tests require a dedicated DB_NAME ending in _test.");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.mjs",
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: [
    {
      command: "npm start -w backend",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "test",
        ADMIN_ENCRYPTION_KEY: "ef".repeat(32),
        PORT: "4000",
        PUBLIC_ORIGIN: "http://localhost:5173",
        COOKIE_SECURE: "false",
      },
    },
    {
      command: "npm run dev -w frontend -- --host 127.0.0.1",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
