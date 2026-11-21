import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT ?? "4174";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}/`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "he-IL",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
  ],
  webServer: {
    command: "bun scripts/e2e-server.ts",
    url: `http://localhost:${port}/data/index.json`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, E2E_PORT: port } as Record<string, string>,
  },
});
