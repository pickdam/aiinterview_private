// import { resolve } from "path"
import process from "process";

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

const path = process.env.ENV_PATH ?? ".env";
dotenv.config({ path });

const chromiumMediaLaunchOptions = {
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
};

const firefoxMediaLaunchOptions = {
  firefoxUserPrefs: {
    "media.navigator.permission.disabled": true,
    "media.navigator.streams.fake": true,
  },
};

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./src/tests/",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Update number of workers as we find the limit of skill-hub-qa on CI */
  // workers: process.env.CI ? 3 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-reports/html/", open: "never" }],
    ["junit", { outputFile: "test-reports/junit/junit.xml" }],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    httpCredentials: {
      username: "track",
      password: "future2025",
    },
    permissions: ["camera", "microphone"],
    headless: process.env.HEADLESS === "true",
    launchOptions: chromiumMediaLaunchOptions,
    ...devices["Desktop Chrome"],
    locale: "en",
    screenshot: {
      mode: "only-on-failure",
      fullPage: true,
    },
    trace: "retain-on-failure",
  },
  // globalTeardown: resolve("./global-teardown"),

  /* Configure projects for major browsers */
  projects: [
    {
      name: "Log in all accounts",
      testMatch: "**/accounts.setup.ts",
      fullyParallel: false, // Don't run in parallel or we might overload auth0
    },
    {
      name: "All Tests",
      dependencies: ["Log in all accounts"],
      fullyParallel: true,
    },
    {
      name: "Firefox",
      dependencies: ["Log in all accounts"],
      fullyParallel: true,
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: firefoxMediaLaunchOptions,
        permissions: [],
      },
    },
    {
      name: "Edge",
      dependencies: ["Log in all accounts"],
      fullyParallel: true,
      use: {
        ...devices["Desktop Edge"],
        channel: "msedge",
        launchOptions: chromiumMediaLaunchOptions,
      },
    },
    {
      name: "Safari",
      dependencies: ["Log in all accounts"],
      fullyParallel: true,
      use: {
        ...devices["Desktop Safari"],
        launchOptions: {},
        permissions: [],
      },
    },
  ],
});
