import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

/**
 * Resolve the Chromium executable.
 *
 * Resolution order:
 * 1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var (explicit override, works in any env)
 * 2. The Nix-store path used by the Replit environment
 * 3. Fall back to Playwright's bundled Chromium (works on non-Nix machines)
 *
 * If none of the above exists, Playwright will error with a clear message.
 */
function resolveChromiumExecutable(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;

  const nixPath =
    "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium-browser";
  if (existsSync(nixPath)) return nixPath;

  return undefined;
}

const TEST_PORT = 5179;
const BASE_URL = `http://localhost:${TEST_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    headless: true,
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /**
   * Start a dedicated test instance of the admin app with the auth bypass
   * enabled at build time via VITE_TEST_BYPASS_AUTH=true.
   *
   * This flag is replaced by Vite at server startup — it is a compile-time
   * constant in the served bundle and cannot be changed by users in DevTools.
   * It is never set in the regular dev or production servers.
   */
  webServer: {
    command: `VITE_TEST_BYPASS_AUTH=true PORT=${TEST_PORT} BASE_PATH=/admin/ pnpm run dev`,
    url: `${BASE_URL}/admin/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
