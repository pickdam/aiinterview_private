import { Browser, Page, test as base, expect } from "@playwright/test";
import { UserRoles } from "@src/enums/user-roles";
import { ReportingApi } from "@src/api/reporting-api";
import { Buffer } from "node:buffer";
import {
  readFileSync,
} from "node:fs";
import process from "process";
import { loginToReportingApiAsRole } from "@src/utils/api-auth";
import {
  ensureSharedInterviewCompanyIds,
  type InterviewCompanyIds,
} from "@src/utils/shared-interview-companies";

const getHttpCredentials = ():
  | { username: string; password: string }
  | undefined => {
  const basicAuth = process.env.REPORTING_API_BASIC_AUTH?.trim();

  if (!basicAuth?.startsWith("Basic ")) {
    return undefined;
  }

  const decodedCredentials = Buffer.from(
    basicAuth.slice("Basic ".length),
    "base64",
  ).toString("utf-8");
  const separatorIndex = decodedCredentials.indexOf(":");

  if (separatorIndex === -1) {
    return undefined;
  }

  return {
    password: decodedCredentials.slice(separatorIndex + 1),
    username: decodedCredentials.slice(0, separatorIndex),
  };
};

const test = base.extend<
  { freshApiAdmin: ReportingApi; pageUser: Page; pageAdmin: Page },
  { apiAdmin: ReportingApi; interviewCompanyIds: InterviewCompanyIds }
>({
  ...Object.fromEntries(
    Object.entries(UserRoles).map(([key, role]) => [
      `page${key}`,
      async (
        { browser }: { browser: Browser },
        use: (page: Page) => Promise<void>,
      ) => {
        const context = await browser.newContext({
          httpCredentials: getHttpCredentials(),
          storageState: `./.auth/${role}.json`,
        });
        const page = await context.newPage();

        await use(page);
        await page.close();
        await context.close();
      },
    ]),
  ),

  // Worker-scoped: created once per worker, available in beforeAll.
  // Reads the id_token stored by accounts.setup.ts — no redundant login.
  apiAdmin: [async ({ playwright }, use) => {
    const { id_token: authToken } = JSON.parse(
      readFileSync(`.auth/${UserRoles.Admin}.json`, "utf-8"),
    );
    const apiCtx = await playwright.request.newContext({
      baseURL: process.env.REPORTING_API_BASE_URL,
    });
    await use(new ReportingApi(apiCtx, authToken));
    await apiCtx.dispose();
  }, { scope: "worker" }],

  // Worker-scoped fixture backed by a shared cache, so parallel workers and
  // browser projects reuse the same provider-specific companies.
  interviewCompanyIds: [async ({ apiAdmin }, use) => {
    await use(await ensureSharedInterviewCompanyIds(apiAdmin));
  }, { scope: "worker" }],

  // Test-scoped: logs in through the Reporting API for every test that needs
  // fresh data seeding credentials. Use this for long-running interview specs
  // where a worker-scoped token can expire before all scenarios finish.
  freshApiAdmin: async ({ playwright }, use) => {
    const apiCtx = await playwright.request.newContext({
      baseURL: process.env.REPORTING_API_BASE_URL,
    });
    const authToken = await loginToReportingApiAsRole(apiCtx, UserRoles.Admin);

    await use(new ReportingApi(apiCtx, authToken));
    await apiCtx.dispose();
  },
});

export { test, expect };
