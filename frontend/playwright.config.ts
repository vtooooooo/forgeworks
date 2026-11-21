import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";

const external = process.env.FORGEWORKS_E2E_URL;
const servers: PlaywrightTestConfig["webServer"] = [
  {
    command: "sh examples/start_console_api.sh",
    cwd: "..",
    url: "http://127.0.0.1:18080/health",
    timeout: 45000,
    env: {
      FORGEWORKS_PLANNER_TOKEN: "local-browser-test",
      FORGEWORKS_CONSOLE_MODE: "local",
      FORGEWORKS_CONSOLE_API_PORT: "18080",
      FORGEWORKS_CONSOLE_TEST_SCALE: "1",
    },
  },
  {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    timeout: 45000,
    env: { FORGEWORKS_API_URL: "http://127.0.0.1:18080" },
  },
];
export default defineConfig({
  testDir: "e2e",
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: external ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  webServer: external ? undefined : servers,
});
