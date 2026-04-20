import { test as setup } from "@playwright/test";
import path from "path";
import { readFileSync, writeFileSync } from "fs";
import process from "process";

import { getAccounts } from "@src/utils/accounts";
import { AuthPage } from "@src/pages/auth.page";
import { Home } from "@src/pages/home.page";

// TODO dynamically only log into accounts that are required for the set of test cases being run.
getAccounts().forEach((user) => {
  setup(`Setup state for role: ${user.role}`, async ({ page, playwright }) => {
    const authFile = path.join(`.auth/${user.role}.json`);

    // --- Exact original: browser UI login to capture session cookies ---
    const authPage = new AuthPage(page);
    await authPage.goto();
    await authPage.fillEmailField(user.email);
    await authPage.fillPasswordField(user.password);
    await authPage.clickContinueButton();

    const homePage = new Home(page);
    await homePage.sidebar.waitFor({ timeout: 10000 });

    // Save storage state (cookies + localStorage) for UI-based test fixtures
    await page.context().storageState({ path: authFile });

    // --- Extension: get id_token directly from the reporting API ---
    // The browser /api/login proxy does not reliably surface a usable id_token,
    // so we call the backend directly with the same credentials.
    const apiCtx = await playwright.request.newContext({
      baseURL: process.env.REPORTING_API_BASE_URL,
    });
    const loginResp = await apiCtx.post("reporting/login", {
      data: { username: user.email, password: user.password },
    });
    const loginData = await loginResp.json();
    await apiCtx.dispose();

    if (!loginData.id_token) {
      throw new Error(
        `id_token not found in reporting API login response for role: ${user.role}`
      );
    }

    // Augment the auth file with id_token
    const authData = JSON.parse(readFileSync(authFile, "utf-8"));
    authData.id_token = loginData.id_token;
    writeFileSync(authFile, JSON.stringify(authData, null, 2));
  });
});
