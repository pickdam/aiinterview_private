import { Locator, Page } from "@playwright/test";

export class AuthPage {
  readonly page: Page;

  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.emailInput = this.page.locator('input[name="email"]');
    this.passwordInput = this.page.locator('input[type="password"]');
    this.submitBtn = this.page.locator('button[type="submit"]');
  }

  async goto() {
    await this.page.goto("/login");
  }

  async fillEmailField(email: string) {
    await this.emailInput.fill(email);
  }

  async fillPasswordField(password: string) {
    await this.passwordInput.fill(password);
  }

  async clickContinueButton() {
    await this.submitBtn.click();
  }
}
