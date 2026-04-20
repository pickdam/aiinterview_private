import { Locator, Page } from "@playwright/test";

export class InterviewStartPage {
  readonly page: Page;

  readonly audioConfirmationDialog: Locator;
  readonly audioConfirmationStartBtn: Locator;
  readonly startInterviewBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.audioConfirmationDialog = this.page.getByRole("alertdialog", {
      name: /Audio Confirmation/i,
    });
    this.audioConfirmationStartBtn = this.audioConfirmationDialog.getByRole(
      "button",
      { name: /^Start$/i },
    );
    this.startInterviewBtn = this.page.getByRole("button", {
      name: /Start Interview/i,
    });
  }

  async clickAudioConfirmationStart(): Promise<void> {
    await this.audioConfirmationStartBtn.click();
  }

  async clickStartInterview(): Promise<void> {
    await this.startInterviewBtn.click();
  }
}
