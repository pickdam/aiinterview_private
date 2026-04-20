import { Browser, Page, test as base, expect } from "@playwright/test";
import { UserRoles } from "@src/enums/user-roles";
import { ReportingApi } from "@src/api/reporting-api";
import { readFileSync } from "node:fs";
import process from "process";
import { loginToReportingApiAsRole } from "@src/utils/api-auth";

const test = base.extend<
  { freshApiAdmin: ReportingApi; pageUser: Page; pageAdmin: Page },
  { apiAdmin: ReportingApi }
>({
  ...Object.fromEntries(
    Object.entries(UserRoles).map(([key, role]) => [
      `page${key}`,
      async (
        { browser }: { browser: Browser },
        use: (page: Page) => Promise<void>,
      ) => {
        const context = await browser.newContext({
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
