import type { Page, TestInfo } from "@playwright/test";
import type { ReportingApi } from "@src/api/reporting-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import { InterviewStartPage } from "@src/pages/interview-start.page";
import {
  formatTimer,
  InterviewFlowActions,
  timeToSeconds,
} from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import { VirtualMicrophone } from "@src/utils/virtual-microphone";

type RefreshFlowConfig = {
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: string[];
  sttProvider: SttProvider;
};

const refreshFlowConfig = {
  language: "ja",
  languageLabel: "Japanese",
  providerLabel: "OpenAI",
  questions: [
    "あなたの強みを教えてください。",
    "これまでの職務経歴を教えてください。",
  ],
  sttProvider: "openai",
} satisfies RefreshFlowConfig;

const applicantAudioPulseMs = 700;
const questionCount = refreshFlowConfig.questions.length;
const refreshTestTimeoutMs = 180000;

const seedRefreshInterview = async (
  apiAdmin: ReportingApi,
  timeLimitSeconds: number,
): Promise<string> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+refresh+${timeLimitSeconds}+${timestamp}@givery.co.jp`;

  const companyResp = await apiAdmin.createCompany({
    company_name: `E2E Refresh ${refreshFlowConfig.providerLabel} ${refreshFlowConfig.languageLabel} ${timestamp}`,
    stt_provider: refreshFlowConfig.sttProvider,
  });
  const { company_id: companyId } = await companyResp.json();

  const interviewBuilder = new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Refresh ${refreshFlowConfig.providerLabel} ${refreshFlowConfig.languageLabel} ${timestamp}`,
    )
    .description(`E2E refresh behavior check with ${timeLimitSeconds}s timers`)
    .language(refreshFlowConfig.language)
    .version(2)
    .linkMaxUses(1);

  for (const question of refreshFlowConfig.questions) {
    interviewBuilder.withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(question)
        .category("general")
        .language(refreshFlowConfig.language)
        .timeLimit(timeLimitSeconds),
    );
  }

  const interview = await interviewBuilder.build();

  return interview.interviewUrl;
};

const prepareRefreshInterview = async (
  page: Page,
  interviewUrl: string,
  flow: InterviewFlowActions,
  testInfo: TestInfo,
): Promise<void> => {
  const applicantName = withBrowserApplicantPrefix(
    testInfo,
    `Refresh applicant - ${refreshFlowConfig.providerLabel} - ${refreshFlowConfig.languageLabel} - ${Date.now()}`,
  );

  await page.goto(interviewUrl);
  await flow.enterSetup(applicantName);
  await flow.completeMediaSetup();
  await flow.completeSampleQuestionWithTone();
  await flow.startInterview();
};

const expectStartInterviewScreen = async (page: Page): Promise<void> => {
  const interviewStartPage = new InterviewStartPage(page);

  await expect(interviewStartPage.startInterviewBtn).toBeVisible({
    timeout: 15000,
  });
  await expect(interviewStartPage.startInterviewBtn).toBeEnabled();
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
    refreshFlowConfig.questions[questionIndex],
  );

  return interviewQuestionPage;
};

const startCurrentQuestionTimer = async (
  page: Page,
  questionIndex: number,
  timeLimitSeconds: number,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<InterviewQuestionPage> => {
  return await test.step(`Question ${questionIndex + 1} audio, video, and timer should work`, async () => {
    const interviewQuestionPage = await expectCurrentInterviewQuestion(
      page,
      questionIndex,
    );

    await flow.waitForInterviewerAudioToStart();
    await expect(interviewQuestionPage.remainingTime).toHaveText(
      formatTimer(timeLimitSeconds),
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

const restartInterviewAfterRefresh = async (
  page: Page,
  expectedQuestionIndex: number,
  timeLimitSeconds: number,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<InterviewQuestionPage> => {
  await flow.startInterview();

  return await startCurrentQuestionTimer(
    page,
    expectedQuestionIndex,
    timeLimitSeconds,
    flow,
    virtualMicrophone,
  );
};

const submitCurrentQuestionAndAdvance = async (
  page: Page,
  nextQuestionIndex: number,
  flow: InterviewFlowActions,
): Promise<void> => {
  await test.step(`Submitting should advance to question ${nextQuestionIndex + 1}`, async () => {
    await flow.submitCurrentQuestion();
    await expectCurrentInterviewQuestion(page, nextQuestionIndex);
  });
};

const expectInterviewToFinish = async (page: Page): Promise<void> => {
  await expect(page.getByText("The interview is now complete.")).toBeVisible({
    timeout: 15000,
  });
};

test.describe("Interview Flow - Refresh related cases @interview", () => {
  test("Refreshing after the first question timer starts should restart from the first question", async ({
    freshApiAdmin: apiAdmin,
    page,
  }, testInfo) => {
    test.setTimeout(refreshTestTimeoutMs);

    const timeLimitSeconds = 30;
    const interviewUrl = await seedRefreshInterview(apiAdmin, timeLimitSeconds);
    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareRefreshInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(
      page,
      0,
      timeLimitSeconds,
      flow,
      virtualMicrophone,
    );
    await flow.refreshToStartInterviewScreen();
    await expectStartInterviewScreen(page);
    await restartInterviewAfterRefresh(
      page,
      0,
      timeLimitSeconds,
      flow,
      virtualMicrophone,
    );
    await submitCurrentQuestionAndAdvance(page, 1, flow);
    await startCurrentQuestionTimer(
      page,
      1,
      timeLimitSeconds,
      flow,
      virtualMicrophone,
    );
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);
  });

  test("Refreshing after the first question is submitted should restart from the last question", async ({
    freshApiAdmin: apiAdmin,
    page,
  }, testInfo) => {
    test.setTimeout(refreshTestTimeoutMs);

    const timeLimitSeconds = 5;
    const interviewUrl = await seedRefreshInterview(apiAdmin, timeLimitSeconds);
    const virtualMicrophone = new VirtualMicrophone(page);
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareRefreshInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    await startCurrentQuestionTimer(
      page,
      0,
      timeLimitSeconds,
      flow,
      virtualMicrophone,
    );
    await submitCurrentQuestionAndAdvance(page, 1, flow);
    await flow.refreshToStartInterviewScreen();
    await expectStartInterviewScreen(page);
    await restartInterviewAfterRefresh(
      page,
      1,
      timeLimitSeconds,
      flow,
      virtualMicrophone,
    );
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);
  });
});
