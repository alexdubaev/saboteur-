import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", navigationTimeout: 12_000, actionTimeout: 8_000, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
});
