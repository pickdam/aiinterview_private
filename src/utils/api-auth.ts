import { Buffer } from "node:buffer";
import process from "node:process";

import type { APIRequestContext, Page } from "@playwright/test";
import type { UserAccount } from "@src/types/user-account";
import { UserRoles } from "@src/enums/user-roles";
import { getAccountForRole } from "@src/utils/accounts";

type ReportingLoginResponse = {
  id_token?: unknown;
};

const adminAuthCookieName = "ai_interview_auth_token";
const fallbackTokenLifetimeSeconds = 55 * 60;

const reportingApiPath = (path: string): string => {
  const baseUrl = process.env.REPORTING_API_BASE_URL?.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return baseUrl ? `${baseUrl}/${normalizedPath}` : normalizedPath;
};

const tokenExpiration = (token: string): number => {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf-8"),
    ) as { exp?: unknown };

    if (typeof payload.exp === "number") {
      return payload.exp;
    }
  } catch {
    // Fall back to a conservative expiry if the token cannot be decoded.
  }

  return Math.floor(Date.now() / 1000) + fallbackTokenLifetimeSeconds;
};

export const loginToReportingApi = async (
  request: APIRequestContext,
  user: UserAccount,
): Promise<string> => {
  const loginResp = await request.post(reportingApiPath("reporting/login"), {
    data: { username: user.email, password: user.password },
  });

  if (!loginResp.ok()) {
    throw new Error(
      `Reporting API login failed for role ${user.role}: ` +
        `${loginResp.status()} ${await loginResp.text()}`,
    );
  }

  const loginData = (await loginResp.json()) as ReportingLoginResponse;

  if (typeof loginData.id_token !== "string" || !loginData.id_token) {
    throw new Error(
      `id_token not found in reporting API login response for role: ${user.role}`,
    );
  }

  return loginData.id_token;
};

export const loginToReportingApiAsRole = async (
  request: APIRequestContext,
  role: UserRoles,
): Promise<string> => {
  return loginToReportingApi(request, getAccountForRole(role));
};

export const refreshAdminBrowserAuth = async (page: Page): Promise<void> => {
  const authToken = await loginToReportingApiAsRole(page.request, UserRoles.Admin);
  const baseUrl = process.env.BASE_URL;

  if (!baseUrl) {
    throw new Error("BASE_URL is required to refresh admin browser auth");
  }

  await page.context().addCookies([
    {
      expires: tokenExpiration(authToken),
      httpOnly: true,
      name: adminAuthCookieName,
      sameSite: "Lax",
      secure: new URL(baseUrl).protocol === "https:",
      url: new URL(baseUrl).origin,
      value: authToken,
    },
  ]);
};
