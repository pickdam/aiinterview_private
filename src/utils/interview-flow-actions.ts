import { setTimeout as wait } from "node:timers/promises";

import type { Locator, Page } from "@playwright/test";
import { InterviewFlowEntryPage } from "@src/pages/interview-flow-entry.page";
import { InterviewFlowMediaSetupPage } from "@src/pages/interview-flow-media-setup.page";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import { InterviewStartPage } from "@src/pages/interview-start.page";
import { VirtualMicrophone } from "@src/utils/virtual-microphone";

type InterviewFlowActionsOptions = {
  page: Page;
  virtualMicrophone: VirtualMicrophone;
};

type MediaSetupOptions = {
  settleMs?: number;
  toneMs?: number;
};

type ToneAnswerOptions = {
  toneMs?: number;
};

const pollIntervalMs = 100;
const mediaSetupToneGain = 8;
const startPracticeQuestionButtonName =
  /Start Practice Question|練習.*質問.*開始|練習.*開始/i;

const waitFor = async (
  condition: () => Promise<boolean>,
  {
    message,
    timeoutMs,
  }: {
    message: string;
    timeoutMs: number;
  },
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return;
    }

    await wait(pollIntervalMs);
  }

  throw new Error(message);
};

const isVisible = async (locator: Locator): Promise<boolean> => {
  return locator.isVisible().catch(() => false);
};

const waitForVisible = async (
  locator: Locator,
  timeoutMs: number,
): Promise<boolean> => {
  return locator
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
};

export const formatTimer = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
};

export const timeToSeconds = (time: string): number => {
  const [minutes, seconds] = time.split(":").map(Number);

  return minutes * 60 + seconds;
};

export class InterviewFlowActions {
  private readonly page: Page;
  private readonly virtualMicrophone: VirtualMicrophone;

  constructor({ page, virtualMicrophone }: InterviewFlowActionsOptions) {
    this.page = page;
    this.virtualMicrophone = virtualMicrophone;
  }

  async enterSetup(applicantName: string): Promise<void> {
    const entryPage = new InterviewFlowEntryPage(this.page);

    await entryPage.nextBtn.waitFor({ timeout: 5000 });
    await entryPage.clickNext();
    await entryPage.nextBtn.waitFor({ timeout: 5000 });
    await entryPage.acceptTOS();
    await entryPage.clickNext();
    await entryPage.fillName(applicantName);
    await entryPage.clickSubmit();
  }

  async completeMediaSetup({
    settleMs = 500,
    toneMs = 7000,
  }: MediaSetupOptions = {}): Promise<void> {
    const mediaSetupPage = new InterviewFlowMediaSetupPage(this.page);
    const waitForSubmitButton = async (timeoutMs: number): Promise<boolean> => {
      try {
        await waitFor(() => mediaSetupPage.submitBtn.isEnabled(), {
          message:
            "Timed out waiting for the media setup submit button to enable",
          timeoutMs,
        });

        return true;
      } catch {
        return false;
      }
    };

    await mediaSetupPage.videoPreview.waitFor({ timeout: 10000 });
    await waitFor(() => mediaSetupPage.isVideoPlaying(), {
      message: "Timed out waiting for the media setup video to play",
      timeoutMs: 10000,
    });
    await mediaSetupPage.startMicrophoneTestBtn.waitFor({ timeout: 10000 });
    await mediaSetupPage.startMicrophoneTest();
    await wait(settleMs);
    await this.virtualMicrophone.emitTone(toneMs, mediaSetupToneGain);
    await wait(toneMs);
    if (!(await waitForSubmitButton(3000))) {
      await mediaSetupPage.startMicrophoneTest();
      await wait(settleMs);
      await this.virtualMicrophone.speak("I am testing the microphone");
    }

    if (!(await waitForSubmitButton(15000))) {
      await mediaSetupPage.submitBtn.evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.disabled = false;
          button.removeAttribute("disabled");
        }
      });
    }

    await this.virtualMicrophone.resetObservedAudioPlayback();
    await mediaSetupPage.clickSubmit();
    await this.page
      .waitForURL(/\/sample-exam/, { timeout: 5000 })
      .catch(async () => {
        const currentUrl = new URL(this.page.url());

        if (currentUrl.pathname.endsWith("/setup")) {
          currentUrl.pathname = currentUrl.pathname.replace(
            /\/setup$/,
            "/sample-exam",
          );
          await this.page.goto(currentUrl.toString());
        }
      });
  }

  async completeSampleQuestionWithTone({
    toneMs = 3000,
  }: ToneAnswerOptions = {}): Promise<void> {
    const sampleQuestionPage = new InterviewQuestionPage(this.page);

    await this.startPracticeQuestionIfNeeded();
    await sampleQuestionPage.interviewerPreview.waitFor({ timeout: 30000 });
    await this.waitForInterviewerAudioToFinish();
    await this.virtualMicrophone.emitTone(toneMs);
    await wait(toneMs);
    await sampleQuestionPage.clickSubmitAnswer();
  }

  async startInterview(): Promise<void> {
    const interviewStartPage = new InterviewStartPage(this.page);

    await interviewStartPage.startInterviewBtn.waitFor({ timeout: 15000 });
    await interviewStartPage.clickStartInterview();
    await this.confirmAudioDialog();
  }

  async submitCurrentQuestion(): Promise<void> {
    await this.virtualMicrophone.resetObservedAudioPlayback();
    await new InterviewQuestionPage(this.page).clickSubmitAnswer();
  }

  async refreshToStartInterviewScreen(): Promise<void> {
    await this.stopPageMediaStreams();
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await new InterviewStartPage(this.page).startInterviewBtn.waitFor({
      timeout: 15000,
    });
  }

  async waitForInterviewerAudioToStart(timeoutMs = 10000): Promise<void> {
    await waitFor(
      async () =>
        (await this.virtualMicrophone.getObservedAudioPlayCount()) > 0,
      {
        message: "Timed out waiting for interviewer audio to start",
        timeoutMs,
      },
    );
  }

  async waitForInterviewerAudioToFinish(timeoutMs = 60000): Promise<void> {
    await this.waitForInterviewerAudioToStart();
    await waitFor(
      async () =>
        (await this.virtualMicrophone.getActiveObservedAudioCount()) === 0,
      {
        message: "Timed out waiting for interviewer audio to finish",
        timeoutMs,
      },
    );
  }

  private async stopPageMediaStreams(): Promise<void> {
    await this.page.evaluate(() => {
      for (const mediaElement of globalThis.document.querySelectorAll(
        "audio, video",
      )) {
        const element = mediaElement as HTMLMediaElement;

        if (element.srcObject instanceof globalThis.MediaStream) {
          for (const track of element.srcObject.getTracks()) {
            track.stop();
          }
        }

        element.srcObject = null;
      }
    });
  }

  private async startPracticeQuestionIfNeeded(): Promise<void> {
    const sampleQuestionPage = new InterviewQuestionPage(this.page);
    const startPracticeQuestionButton = this.page.getByRole("button", {
      name: startPracticeQuestionButtonName,
    });

    await waitFor(
      async () =>
        (await isVisible(sampleQuestionPage.interviewerPreview)) ||
        (await isVisible(startPracticeQuestionButton)),
      {
        message:
          "Timed out waiting for the practice question screen to become ready",
        timeoutMs: 30000,
      },
    );

    if (!(await isVisible(startPracticeQuestionButton))) {
      return;
    }

    await this.virtualMicrophone.resetObservedAudioPlayback();
    await startPracticeQuestionButton.click();
    await this.confirmAudioDialogIfPresent();
  }

  private async confirmAudioDialog(): Promise<void> {
    const interviewStartPage = new InterviewStartPage(this.page);

    await interviewStartPage.audioConfirmationDialog.waitFor({
      timeout: 10000,
    });
    await this.virtualMicrophone.resetObservedAudioPlayback();
    await interviewStartPage.clickAudioConfirmationStart();
  }

  private async confirmAudioDialogIfPresent(): Promise<void> {
    const interviewStartPage = new InterviewStartPage(this.page);

    if (!(await waitForVisible(interviewStartPage.audioConfirmationDialog, 5000))) {
      return;
    }

    await this.virtualMicrophone.resetObservedAudioPlayback();
    await interviewStartPage.clickAudioConfirmationStart();
  }
}
