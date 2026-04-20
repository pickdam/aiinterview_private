import { Locator, Page } from "@playwright/test";

export class InterviewFlowMediaSetupPage {
  readonly page: Page;

  readonly videoPreview: Locator;
  readonly deviceDropdowns: Locator;
  readonly cameraDropdown: Locator;
  readonly microphoneDropdown: Locator;
  readonly microphoneTestHeading: Locator;
  readonly inputLevelLabel: Locator;
  readonly startMicrophoneTestBtn: Locator;
  readonly submitBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.videoPreview = this.page.locator("video").first();
    this.deviceDropdowns = this.page.getByRole("combobox");
    this.cameraDropdown = this.deviceDropdowns
      .filter({ has: this.page.locator("svg.lucide-video") })
      .first();
    this.microphoneDropdown = this.deviceDropdowns
      .filter({ has: this.page.locator("svg.lucide-mic") })
      .first();
    this.microphoneTestHeading = this.page.getByText("Microphone Test", {
      exact: true,
    });
    this.inputLevelLabel = this.page.getByText("Input Level", { exact: true });
    this.startMicrophoneTestBtn = this.page.getByRole("button", {
      name: /Start Test|Retest/i,
    });
    this.submitBtn = this.page.getByRole("button", {
      name: /Start Sample Question/i,
    });
  }

  async isVideoPlaying(): Promise<boolean> {
    return this.videoPreview.evaluate((video: HTMLVideoElement) => {
      return (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        !video.ended &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      );
    });
  }

  async startMicrophoneTest(): Promise<void> {
    await this.startMicrophoneTestBtn.click();
  }

  async clickSubmit(): Promise<void> {
    await this.submitBtn.click();
  }
}
