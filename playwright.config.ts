import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4399;

/**
 * Runs the real server against the hand-written fixture logs, so the tests never read or change
 * the machine's own Claude Code sessions.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 } } },
  ],
  webServer: {
    command: "npm run build && npx tsx src/server/main.ts --no-open",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      OFFICE_PORT: String(PORT),
      CLAUDE_CONFIG_DIR: path.resolve("tests/fixtures/claude"),
      OFFICE_HOME: path.resolve("test-results/office-home"),
    },
  },
});
