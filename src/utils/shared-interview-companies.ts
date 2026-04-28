import type { SttProvider } from "@src/api/types";
import { ReportingApi } from "@src/api/reporting-api";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import process from "process";
import { setTimeout as wait } from "node:timers/promises";

export type InterviewCompanyIds = Record<SttProvider, number>;
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
    } catch {
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

export const ensureSharedInterviewCompanyIds = async (
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
