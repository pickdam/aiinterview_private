import { Locator, Page } from "@playwright/test";

export class ReportPage {
  readonly page: Page;

  readonly examDate: Locator;
  readonly candidateInfoCard: Locator;
  readonly candidateName: Locator;
  readonly candidateEmail: Locator;

  readonly examLogSection: Locator;
  readonly examLogHeading: Locator;
  readonly copyAllSummariesButton: Locator;
  readonly recordingVideo: Locator;
  readonly recordingQuestionList: Locator;
  readonly recordingQuestionButtons: Locator;
  readonly answerSummaryTab: Locator;
  readonly transcriptTab: Locator;
  readonly transcriptionButton: Locator;
  readonly answerSummaryPanel: Locator;
  readonly transcriptPanel: Locator;
  readonly transcriptRecords: Locator;
  readonly transcriptPlaybackButtons: Locator;

  readonly aiAnalysisSection: Locator;
  readonly aiAnalysisHeading: Locator;
  readonly totalScoreCard: Locator;
  readonly competencyEvaluationCard: Locator;
  readonly customEvaluationCard: Locator;

  readonly competencyAnalysisSection: Locator;
  readonly competencyAnalysisHeading: Locator;

  readonly suggestedQuestionsSection: Locator;
  readonly suggestedQuestionsHeading: Locator;
  readonly copyAllQuestionsButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.examDate = this.page.getByText(/Exam date:/i);
    this.candidateInfoCard = this.page
      .locator("div.bg-white.rounded-xl.p-6")
      .first();
    this.candidateName = this.candidateInfoCard.locator(".font-bold").first();
    this.candidateEmail = this.candidateInfoCard
      .locator(".text-xs.text-gray-600")
      .first();

    this.examLogHeading = this.page.getByRole("heading", {
      name: "Exam Log",
    });
    this.examLogSection = this.sectionByHeading("Exam Log");
    this.copyAllSummariesButton = this.examLogSection.getByRole("button", {
      name: /Copy all summaries/i,
    });
    this.recordingVideo = this.examLogSection
      .locator('video[aria-label="video player"], video')
      .first();
    this.recordingQuestionList = this.examLogSection.locator("ul").first();
    this.recordingQuestionButtons =
      this.recordingQuestionList.getByRole("button");
    this.answerSummaryTab = this.examLogSection.getByRole("tab", {
      name: /Answer Summary/i,
    });
    this.transcriptTab = this.examLogSection.getByRole("tab", {
      name: /Transcript/i,
    });
    this.transcriptionButton = this.transcriptTab;
    this.answerSummaryPanel = this.examLogSection.getByRole("tabpanel", {
      name: /Answer Summary/i,
    });
    this.transcriptPanel = this.examLogSection.locator(
      '[role="tabpanel"][id*="content-transcript"]',
    );
    this.transcriptRecords = this.transcriptPanel.locator("ol > li");
    this.transcriptPlaybackButtons = this.transcriptPanel.getByRole("button", {
      name: /Play|再生/i,
    });

    this.aiAnalysisHeading = this.page.getByRole("heading", {
      name: "AI Analysis",
    });
    this.aiAnalysisSection = this.sectionByHeading("AI Analysis");
    this.totalScoreCard = this.aiAnalysisSection
      .locator("div")
      .filter({ hasText: /^Total Score$/ })
      .first();
    this.competencyEvaluationCard = this.aiAnalysisSection
      .locator("div")
      .filter({ hasText: /^Competency Evaluation$/ })
      .first();
    this.customEvaluationCard = this.aiAnalysisSection
      .locator("div")
      .filter({ hasText: /^Custom Evaluation$/ })
      .first();

    this.competencyAnalysisHeading = this.page.getByRole("heading", {
      name: "Competency Analysis",
    });
    this.competencyAnalysisSection = this.sectionByHeading(
      "Competency Analysis",
    );

    this.suggestedQuestionsHeading = this.page.getByRole("heading", {
      name: "Suggested Questions for Next Interview",
    });
    this.suggestedQuestionsSection = this.sectionByHeading(
      "Suggested Questions for Next Interview",
    );
    this.copyAllQuestionsButton = this.suggestedQuestionsSection.getByRole(
      "button",
      {
        name: /Copy all questions/i,
      },
    );
  }

  private sectionByHeading(heading: string): Locator {
    return this.page.locator(
      `xpath=//h1[normalize-space()="${heading}"]/ancestor::div[contains(@class, "bg-white") and contains(@class, "rounded-xl")][1]`,
    );
  }

  async goto(interviewSessionId: string | number): Promise<void> {
    await this.page.goto(`/company/reports/${interviewSessionId}`);
  }

  getRecordingQuestionButton(questionNumber: number): Locator {
    return this.recordingQuestionButtons.nth(questionNumber - 1);
  }

  getRecordingQuestionCategory(questionNumber: number): Locator {
    return this.getRecordingQuestionButton(questionNumber)
      .locator("span")
      .nth(1);
  }

  async selectRecordingQuestion(questionNumber: number): Promise<void> {
    await this.getRecordingQuestionButton(questionNumber).click();
  }

  async openTranscript(): Promise<void> {
    await this.transcriptTab.click();
  }

  async openAnswerSummary(): Promise<void> {
    await this.answerSummaryTab.click();
  }

  getAnswerSummaryItem(questionNumber: number): Locator {
    return this.answerSummaryPanel.locator("ol > li").nth(questionNumber - 1);
  }

  getTranscriptItem(questionNumber: number): Locator {
    return this.transcriptPanel.locator("ol > li").nth(questionNumber - 1);
  }

  getTranscriptPlaybackButton(questionNumber: number): Locator {
    return this.transcriptPlaybackButtons.nth(questionNumber - 1);
  }

  async getTranscriptRecordTexts(): Promise<string[]> {
    const transcriptRecordTexts = await this.transcriptRecords.evaluateAll(
      (records) =>
        records
          .map((record) => (record as HTMLElement).innerText.trim())
          .filter(Boolean),
    );

    if (transcriptRecordTexts.length > 0) {
      return transcriptRecordTexts;
    }

    return this.transcriptPanel
      .locator("p")
      .evaluateAll((paragraphs) =>
        paragraphs
          .map((paragraph) => (paragraph as HTMLElement).innerText.trim())
          .filter(Boolean),
      );
  }

  async getCandidateTranscriptTexts(): Promise<string[]> {
    const candidateTranscriptTexts = await this.transcriptRecords.evaluateAll(
      (records) => {
        const candidateLabelPattern = /^(Candidate|受験者|候補者)$/;
        const speakerLabelPattern =
          /^(Interviewer|Candidate|面接官|受験者|候補者)$/;

        return records
          .flatMap((record) => {
            const paragraphTexts = Array.from(record.querySelectorAll("p"))
              .map((paragraph) => paragraph.textContent?.trim() ?? "")
              .filter(Boolean);

            return paragraphTexts
              .flatMap((text, index) => {
                if (!candidateLabelPattern.test(text)) {
                  return [];
                }

                const candidateTexts: string[] = [];

                for (
                  let candidateTextIndex = index + 1;
                  candidateTextIndex < paragraphTexts.length;
                  candidateTextIndex += 1
                ) {
                  const candidateText = paragraphTexts[candidateTextIndex];

                  if (speakerLabelPattern.test(candidateText)) {
                    break;
                  }

                  candidateTexts.push(candidateText);
                }

                return candidateTexts.length > 0
                  ? [candidateTexts.join("\n")]
                  : [];
              })
              .filter(Boolean);
          })
          .filter(Boolean);
      },
    );

    if (candidateTranscriptTexts.length > 0) {
      return candidateTranscriptTexts;
    }

    return this.getTranscriptRecordTexts();
  }

  async playRecording(): Promise<void> {
    await this.recordingVideo.evaluate(async (video: HTMLVideoElement) => {
      await video.play();
    });
  }

  async pauseRecording(): Promise<void> {
    await this.recordingVideo.evaluate((video: HTMLVideoElement) => {
      video.pause();
    });
  }

  async getRecordingSource(): Promise<string> {
    return (
      (await this.recordingVideo.getAttribute("src")) ??
      (await this.recordingVideo.evaluate(
        (video: HTMLVideoElement) => video.currentSrc,
      ))
    );
  }

  async getRecordingCurrentTime(): Promise<number> {
    return this.recordingVideo.evaluate(
      (video: HTMLVideoElement) => video.currentTime,
    );
  }

  async isRecordingReady(): Promise<boolean> {
    return this.recordingVideo.evaluate((video: HTMLVideoElement) => {
      return video.readyState >= HTMLMediaElement.HAVE_METADATA;
    });
  }

  async isRecordingPlaying(): Promise<boolean> {
    return this.recordingVideo.evaluate((video: HTMLVideoElement) => {
      return (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        !video.ended &&
        video.currentTime > 0
      );
    });
  }
}
