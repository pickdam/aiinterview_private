import { Locator, Page } from "@playwright/test";

export class InterviewQuestionPage {
  readonly page: Page;

  readonly progressBar: Locator;
  readonly questionCount: Locator;
  readonly interviewerPreview: Locator;
  readonly intervieweeVideoFeedback: Locator;
  readonly questionTitle: Locator;
  readonly questionText: Locator;
  readonly remainingTime: Locator;
  readonly submitAnswerBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    this.progressBar = this.page.getByTestId("progress-bar");
    this.questionCount = this.page.getByTestId("label-progress-text");
    this.interviewerPreview = this.page
      .getByRole("img", {
        name: "Interviewer",
      })
      .first();
    this.intervieweeVideoFeedback = this.page.getByTestId("preview_web_camera");
    this.questionTitle = this.page.getByTestId("label-question-title");
    this.questionText = this.page.getByTestId("label-question-text");
    this.remainingTime = this.page.getByTestId("remaining-time");
    this.submitAnswerBtn = this.page.getByRole("button", {
      name: /Submit Answer/i,
    });
  }

  async isIntervieweeVideoPlaying(): Promise<boolean> {
    return this.intervieweeVideoFeedback.evaluate((video: HTMLVideoElement) => {
      return (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        !video.ended &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      );
    });
  }

  async clickSubmitAnswer(): Promise<void> {
    await this.submitAnswerBtn.click();
  }
}
