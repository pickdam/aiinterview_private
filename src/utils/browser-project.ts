import type { TestInfo } from "@playwright/test";

type ProjectUse = {
  browserName?: string;
  channel?: string;
};

export const getBrowserLabel = (testInfo: TestInfo): string => {
  const projectUse = testInfo.project.use as ProjectUse;
  const channel = projectUse.channel?.toLowerCase();
  const browserName = projectUse.browserName?.toLowerCase();

  if (channel?.startsWith("msedge")) {
    return "EDGE";
  }

  if (browserName === "firefox") {
    return "FIREFOX";
  }

  if (browserName === "webkit") {
    return "SAFARI";
  }

  if (browserName === "chromium") {
    return "CHROMIUM";
  }

  return testInfo.project.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

export const withBrowserApplicantPrefix = (
  testInfo: TestInfo,
  applicantName: string,
): string => `[${getBrowserLabel(testInfo)}] ${applicantName}`;
