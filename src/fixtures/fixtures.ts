import { Browser, Page, test as base, expect } from "@playwright/test";
import { UserRoles } from "@src/enums/user-roles";
import { ReportingApi } from "@src/api/reporting-api";
import type { SttProvider } from "@src/api/types";
import { Buffer } from "node:buffer";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import process from "process";
import { loginToReportingApiAsRole } from "@src/utils/api-auth";

type InterviewCompanyIds = Record<SttProvider, number>;
type SharedInterviewCompaniesCache = {
  companies: Partial<InterviewCompanyIds>;
  reportingApiBaseUrl?: string;
};

const sharedInterviewCompanyProviders: SttProvider[] = ["openai", "elevenlabs"];
const sharedInterviewCompaniesPath = ".auth/interview-companies.json";
const sharedInterviewCompaniesLockPath = ".auth/interview-companies.lock";
const sharedInterviewCompaniesLockTimeoutMs = 30000;
const sharedInterviewCompaniesStaleLockMs = 120000;
const lockPollMs = 250;

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

const readReusableInterviewCompanyIds = async (
  apiAdmin: ReportingApi,
): Promise<InterviewCompanyIds | undefined> => {
  if (!existsSync(sharedInterviewCompaniesPath)) {
    return undefined;
  }

  const cache = JSON.parse(
    readFileSync(sharedInterviewCompaniesPath, "utf-8"),
  ) as SharedInterviewCompaniesCache;

  if (cache.reportingApiBaseUrl !== process.env.REPORTING_API_BASE_URL) {
    return undefined;
  }

  const companyIds = Object.fromEntries(
    sharedInterviewCompanyProviders.map((provider) => [
      provider,
      cache.companies[provider],
    ]),
  ) as Partial<InterviewCompanyIds>;

  if (
    !sharedInterviewCompanyProviders.every(
      (provider) => typeof companyIds[provider] === "number",
    )
  ) {
    return undefined;
  }

  const companyResponses = await Promise.all(
    sharedInterviewCompanyProviders.map((provider) =>
      apiAdmin.getCompany(companyIds[provider] as number),
    ),
  );

  if (!companyResponses.every((response) => response.ok())) {
    return undefined;
  }

  return companyIds as InterviewCompanyIds;
};

const acquireSharedInterviewCompanyLock = async (): Promise<void> => {
  const deadline = Date.now() + sharedInterviewCompaniesLockTimeoutMs;

  while (Date.now() < deadline) {
    try {
      mkdirSync(sharedInterviewCompaniesLockPath);
      return;
    } catch (error) {
      if (
        existsSync(sharedInterviewCompaniesLockPath) &&
        Date.now() - statSync(sharedInterviewCompaniesLockPath).mtimeMs >
          sharedInterviewCompaniesStaleLockMs
      ) {
        rmSync(sharedInterviewCompaniesLockPath, {
          force: true,
          recursive: true,
        });
      }

      await wait(lockPollMs);
    }
  }

  throw new Error("Timed out waiting for shared interview company lock");
};

const releaseSharedInterviewCompanyLock = (): void => {
  rmSync(sharedInterviewCompaniesLockPath, {
    force: true,
    recursive: true,
  });
};

const createSharedInterviewCompanyIds = async (
  apiAdmin: ReportingApi,
): Promise<InterviewCompanyIds> => {
  const timestamp = Date.now();
  const entries = await Promise.all(
    sharedInterviewCompanyProviders.map(async (provider) => {
      const companyResp = await apiAdmin.createCompany({
        company_name: `E2E Shared ${provider} ${timestamp}`,
        stt_provider: provider,
      });

      if (!companyResp.ok()) {
        throw new Error(
          `Failed to create shared ${provider} company: ${companyResp.status()} ${await companyResp.text()}`,
        );
      }

      const { company_id: companyId } = (await companyResp.json()) as {
        company_id: number;
      };

      return [provider, companyId] as const;
    }),
  );

  const companyIds = Object.fromEntries(entries) as InterviewCompanyIds;

  writeFileSync(
    sharedInterviewCompaniesPath,
    JSON.stringify(
      {
        companies: companyIds,
        reportingApiBaseUrl: process.env.REPORTING_API_BASE_URL,
      } satisfies SharedInterviewCompaniesCache,
      null,
      2,
    ),
  );

  return companyIds;
};

const getSharedInterviewCompanyIds = async (
  apiAdmin: ReportingApi,
): Promise<InterviewCompanyIds> => {
  const cachedCompanyIds = await readReusableInterviewCompanyIds(apiAdmin);

  if (cachedCompanyIds) {
    return cachedCompanyIds;
  }

  await acquireSharedInterviewCompanyLock();

  try {
    return (
      (await readReusableInterviewCompanyIds(apiAdmin)) ??
      (await createSharedInterviewCompanyIds(apiAdmin))
    );
  } finally {
    releaseSharedInterviewCompanyLock();
  }
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
    await use(await getSharedInterviewCompanyIds(apiAdmin));
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
