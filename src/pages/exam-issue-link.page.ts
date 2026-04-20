import { Locator, Page } from "@playwright/test";

export class ExamIssueLink {
  readonly page: Page

  readonly emailInput: Locator
  readonly termsAgreeBtn: Locator
  readonly TOSLink: Locator
  readonly privacyPolicyLink: Locator
  readonly thirdPartyAgreeBtn: Locator
  readonly submitBtn: Locator
  readonly successMessage: Locator


  constructor(page: Page) {
    this.page = page;

    this.emailInput = this.page.locator('input[name="email"]');
    this.termsAgreeBtn = this.page.locator('button[id="terms-agree"]')
    this.TOSLink = this.page.getByText(/Terms of Service/i).first()
    this.privacyPolicyLink = this.page.getByText(/Privacy Policy/i).first()
    this.thirdPartyAgreeBtn = this.page.locator('button[id="third-party-agree"]')
    this.submitBtn = this.page.getByRole('button',{name: /Send instructions email/i})
    this.successMessage = this.page.getByText(/Instructions email sent!/i)
  }

  async goto(commonLink: string) {
    await this.page.goto(`/exam-link-issue/${commonLink}`)
  }

  async fillEmailField(email: string) {
    await this.emailInput.fill(email)
  }

  async clickTOSLink() {
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup'),
      this.TOSLink.click(),
    ]);
    await popup.close();
    await this.page.bringToFront();
  }

  async clickPrivacyPolicyLink() {
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup'),
      this.privacyPolicyLink.click(),
    ]);
    await popup.close();
    await this.page.bringToFront();
  }

  async checkTermsAndConditions(){
    await this.termsAgreeBtn.click()
  }

  async checkThirdParty(){
    await this.thirdPartyAgreeBtn.click()
  }

  async clickSubmit(){
    await this.submitBtn.click()
  }

}
