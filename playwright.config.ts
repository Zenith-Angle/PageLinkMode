import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 40_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "output/playwright/results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-fixtures.mjs",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
