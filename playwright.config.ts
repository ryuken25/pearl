import { defineConfig, devices } from "@playwright/test";

// Screenshot-walkthrough config. Drives the PRODUCTION build (vite
// preview) in a mobile viewport. RPC + price endpoints are mocked inside
// the spec so the walkthrough is deterministic and offline.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Pixel 7"],
    // Pin the viewport so screenshots are stable across devices.
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
