import type { Page, TestInfo } from "@playwright/test";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import {
  formatTimer,
  InterviewFlowActions,
  timeToSeconds,
} from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import { VirtualMicrophone } from "@src/utils/virtual-microphone";

type TimerFlowConfig = {
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: string[];
  sttProvider: SttProvider;
  timeLimitSeconds: number;
};

const timerFlowConfig = {
  language: "ja",
  languageLabel: "Japanese",
  providerLabel: "OpenAI",
  questions: [
    "あなたの強みを教えてください。",
    "これまでの職務経歴を教えてください。",
  ],
  sttProvider: "openai",
  timeLimitSeconds: 5,
} satisfies TimerFlowConfig;

const applicantAudioPulseMs = 700;
const questionCount = timerFlowConfig.questions.length;
const timerExpirationTimeoutMs = 15000;
const timerTestTimeoutMs = 180000;

const prepareTimerInterview = async (
  page: Page,
  interviewUrl: string,
  flow: InterviewFlowActions,
  testInfo: TestInfo,
): Promise<void> => {
  const applicantName = withBrowserApplicantPrefix(
    testInfo,
    `Timer applicant - ${timerFlowConfig.providerLabel} - ${timerFlowConfig.languageLabel} - ${Date.now()}`,
  );

  await page.goto(interviewUrl);
  await flow.enterSetup(applicantName);
  await flow.completeMediaSetup();
  await flow.completeSampleQuestionWithTone();
  await flow.startInterview();
};

const expectCurrentInterviewQuestion = async (
  page: Page,
  questionIndex: number,
): Promise<InterviewQuestionPage> => {
  const interviewQuestionPage = new InterviewQuestionPage(page);

  await expect(interviewQuestionPage.interviewerPreview).toBeVisible();
  await expect(interviewQuestionPage.intervieweeVideoFeedback).toBeVisible();
  await expect
    .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
      timeout: 10000,
    })
    .toBe(true);
  await expect(interviewQuestionPage.questionCount).toHaveText(
    `${questionIndex}/${questionCount}`,
    { timeout: 15000 },
  );
  await expect(interviewQuestionPage.questionText).toContainText(
    timerFlowConfig.questions[questionIndex],
  );

  return interviewQuestionPage;
};

const startCurrentQuestionTimer = async (
  page: Page,
  questionIndex: number,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<InterviewQuestionPage> => {
  return await test.step(`Question ${questionIndex + 1} audio should play and the timer should start`, async () => {
    const interviewQuestionPage = await expectCurrentInterviewQuestion(
      page,
      questionIndex,
    );
    const initialTimerText = formatTimer(timerFlowConfig.timeLimitSeconds);

    await flow.waitForInterviewerAudioToStart();
    await expect(interviewQuestionPage.remainingTime).toHaveText(
      initialTimerText,
    );

    const initialTimerSeconds = timeToSeconds(
      await interviewQuestionPage.remainingTime.innerText(),
    );

    await expect
      .poll(
        async () => {
          await virtualMicrophone.emitTone(applicantAudioPulseMs);

          return timeToSeconds(
            await interviewQuestionPage.remainingTime.innerText(),
          );
        },
        {
          intervals: [500],
          timeout: 10000,
        },
      )
      .toBeLessThan(initialTimerSeconds);

    return interviewQuestionPage;
  });
};

const waitForQuestionTimerToAdvance = async (
  page: Page,
  nextQuestionIndex: number,
  flow: InterviewFlowActions,
): Promise<void> => {
  await test.step(`The timer should advance to question ${nextQuestionIndex + 1}`, async () => {
    await expectCurrentInterviewQuestion(page, nextQuestionIndex);
    await flow.waitForInterviewerAudioToStart();
  });
};

const waitForCurrentTimerToShow = async (
  page: Page,
  expectedSeconds: number,
): Promise<void> => {
  const interviewQuestionPage = new InterviewQuestionPage(page);

  await expect
    .poll(
      async () =>
        timeToSeconds(await interviewQuestionPage.remainingTime.innerText()),
      {
        intervals: [100],
        timeout: timerExpirationTimeoutMs,
      },
    )
    .toBe(expectedSeconds);
};

const submitCurrentQuestionAndAdvance = async (
  page: Page,
  nextQuestionIndex: number,
  flow: InterviewFlowActions,
): Promise<void> => {
  await test.step(`Submitting should advance to question ${nextQuestionIndex + 1}`, async () => {
    await flow.submitCurrentQuestion();
    await expectCurrentInterviewQuestion(page, nextQuestionIndex);
    await flow.waitForInterviewerAudioToStart();
  });
};

const expectInterviewToFinish = async (page: Page): Promise<void> => {
  await expect(page.getByText("The interview is now complete.")).toBeVisible({
    timeout: timerExpirationTimeoutMs,
  });
};

test.describe("Interview Flow - Timer related cases @interview", () => {
  let interviewUrl: string;

  test.beforeEach(async ({ freshApiAdmin: apiAdmin, interviewCompanyIds }) => {
    const timestamp = Date.now();
    const seededEmail = `product-dev_qa+ai+timer+${timestamp}@givery.co.jp`;
    const companyId = interviewCompanyIds[timerFlowConfig.sttProvider];

    const interviewBuilder = new InterviewBuilder(apiAdmin)
      .forCompany(companyId)
      .sendTo(seededEmail)
      .name(
        `E2E Timer ${timerFlowConfig.providerLabel} ${timerFlowConfig.languageLabel} ${timestamp}`,
      )
      .description("E2E timer behavior check for non-interactive interviews")
      .language(timerFlowConfig.language)
      .version(2)
      .linkMaxUses(1);

    for (const question of timerFlowConfig.questions) {
      interviewBuilder.withQuestion((questionBuilder) =>
        questionBuilder
          .transcript(question)
          .category("general")
          .language(timerFlowConfig.language)
          .timeLimit(timerFlowConfig.timeLimitSeconds),
      );
    }

    const interview = await interviewBuilder.build();
    interviewUrl = interview.interviewUrl;
  });

  test("A timed-out first question should advance to the second question and start its timer", async ({
    page,
  }, testInfo) => {
    test.setTimeout(timerTestTimeoutMs);

    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareTimerInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(page, 0, flow, virtualMicrophone);
    await waitForQuestionTimerToAdvance(page, 1, flow);
    await startCurrentQuestionTimer(page, 1, flow, virtualMicrophone);
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);
  });

  test("Submitting the first question and timing out the second question should finish the interview", async ({
    page,
  }, testInfo) => {
    test.setTimeout(timerTestTimeoutMs);

    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareTimerInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(page, 0, flow, virtualMicrophone);
    await submitCurrentQuestionAndAdvance(page, 1, flow);
    await startCurrentQuestionTimer(page, 1, flow, virtualMicrophone);
    await expectInterviewToFinish(page);
  });

  test("Submitting the first question at one second should advance to the second question and start its timer", async ({
    page,
  }, testInfo) => {
    test.setTimeout(timerTestTimeoutMs);

    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareTimerInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(page, 0, flow, virtualMicrophone);
    await waitForCurrentTimerToShow(page, 1);
    await submitCurrentQuestionAndAdvance(page, 1, flow);
    await startCurrentQuestionTimer(page, 1, flow, virtualMicrophone);
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);
  });

  test("Submitting the second question at one second should finish the interview", async ({
    page,
  }, testInfo) => {
    test.setTimeout(timerTestTimeoutMs);

    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareTimerInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(page, 0, flow, virtualMicrophone);
    await submitCurrentQuestionAndAdvance(page, 1, flow);
    await startCurrentQuestionTimer(page, 1, flow, virtualMicrophone);
    await waitForCurrentTimerToShow(page, 1);
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);
  });
});
