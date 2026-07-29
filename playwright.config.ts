import { defineConfig, devices } from "@playwright/test";

const port = 3105;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `DATABASE_URL=postgresql://records-preview-test@127.0.0.1:${port + 1}/ygo_wishlist_test_preview NEXT_PUBLIC_RECORDS_UI_PREVIEW=1 NEXT_TELEMETRY_DISABLED=1 RECORDS_BROWSER_TEST=1 next dev --webpack --port ${port}`,
    env: {
      CI: "",
      NEXT_PUBLIC_VERCEL_URL: "",
      VERCEL: "",
      VERCEL_ENV: "",
      VERCEL_REGION: "",
      VERCEL_URL: "",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
