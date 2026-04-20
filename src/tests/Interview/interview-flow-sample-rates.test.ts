import { setTimeout as wait } from "node:timers/promises";

import type { Page, TestInfo } from "@playwright/test";
import type { ReportingApi } from "@src/api/reporting-api";
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
import {
  createSpeechAudioBase64,
  VirtualMicrophone,
} from "@src/utils/virtual-microphone";

type SampleRateQuestion = {
  answer: string;
  question: string;
};

type SampleRateFlowConfig = {
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: SampleRateQuestion[];
  sttProvider: SttProvider;
  timeLimitSeconds: number;
  ttsVoice: string;
};

type SampleRateQuestionCase = SampleRateQuestion & {
  answerAudioBase64: string;
  questionIndex: number;
};

const sampleRateFlowConfig = {
  language: "ja",
  languageLabel: "Japanese",
  providerLabel: "OpenAI",
  questions: [
    {
      question: "あなたの強みについて教えてください。",
      answer:
        "私の強みは、課題を整理して着実に進められることです。複雑な状況でも要素を分けて考え、優先順位を決めながら最後まで責任を持って対応します。",
    },
    {
      question: "これまでの職務経歴について教えてください。",
      answer:
        "これまで主にIT業界で経験を積んできました。社内システムの運用サポート、データ管理、プロジェクトの進行管理、関係部署との調整などを担当してきました。",
    },
    {
      question: "仕事で大切にしていることを教えてください。",
      answer:
        "仕事では、周囲との認識合わせと継続的な改善を大切にしています。目的を確認し、必要な情報を共有しながら、チームで安定して成果を出せるように行動します。",
    },
  ],
  sttProvider: "openai",
  timeLimitSeconds: 30,
  ttsVoice: "Kyoko",
} satisfies SampleRateFlowConfig;

const sampleRatesHz = [44100, 88200, 96000] as const;
const questionCount = sampleRateFlowConfig.questions.length;
const questionAdvanceTimeoutMs = 45000;
const questionPromptSettleMs = 3000;
const sampleRateTestTimeoutMs = 240000;
const visibleInterviewErrorPattern =
  /Audio playback failed|Audio initialization failed|Media Stream Error|Camera\/Microphone Error|An unexpected error occurred/i;

const seedSampleRateInterview = async (
  apiAdmin: ReportingApi,
  sampleRateHz: number,
): Promise<string> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+sample-rate+${sampleRateHz}+${timestamp}@givery.co.jp`;

  const companyResp = await apiAdmin.createCompany({
    company_name: `E2E Sample Rate ${sampleRateFlowConfig.providerLabel} ${sampleRateFlowConfig.languageLabel} ${sampleRateHz} ${timestamp}`,
    stt_provider: sampleRateFlowConfig.sttProvider,
  });
  const { company_id: companyId } = await companyResp.json();

  const interviewBuilder = new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Sample Rate ${sampleRateFlowConfig.providerLabel} ${sampleRateFlowConfig.languageLabel} ${sampleRateHz} ${timestamp}`,
    )
    .description(
      `E2E sample-rate behavior check for ${sampleRateHz} Hz applicant audio`,
    )
    .language(sampleRateFlowConfig.language)
    .version(2)
    .linkMaxUses(1);

  for (const { question } of sampleRateFlowConfig.questions) {
    interviewBuilder.withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(question)
        .category("general")
        .language(sampleRateFlowConfig.language)
        .timeLimit(sampleRateFlowConfig.timeLimitSeconds),
    );
  }

  const interview = await interviewBuilder.build();

  return interview.interviewUrl;
};

const prepareSampleRateInterview = async (
  page: Page,
  interviewUrl: string,
  flow: InterviewFlowActions,
  testInfo: TestInfo,
): Promise<void> => {
  const applicantName = withBrowserApplicantPrefix(
    testInfo,
    `Sample-rate (${sampleRatesHz}) applicant - ${sampleRateFlowConfig.providerLabel} - ${sampleRateFlowConfig.languageLabel} - ${Date.now()}`,
  );

  await page.goto(interviewUrl);
  await flow.enterSetup(applicantName);
  await flow.completeMediaSetup();
  await flow.completeSampleQuestionWithTone();
  await flow.startInterview();
};

const expectNoVisibleInterviewErrors = async (page: Page): Promise<void> => {
  await expect(
    page.locator("main").getByText(visibleInterviewErrorPattern),
  ).toHaveCount(0);
};

const expectCurrentInterviewQuestion = async (
  page: Page,
  questionCase: SampleRateQuestionCase,
  timeout = 15000,
): Promise<InterviewQuestionPage> => {
  const interviewQuestionPage = new InterviewQuestionPage(page);

  await expectNoVisibleInterviewErrors(page);
  await expect(interviewQuestionPage.interviewerPreview).toBeVisible({
    timeout,
  });
  await expect(interviewQuestionPage.intervieweeVideoFeedback).toBeVisible();
  await expect
    .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
      timeout: 10000,
    })
    .toBe(true);
  await expect(interviewQuestionPage.questionCount).toHaveText(
    `${questionCase.questionIndex}/${questionCount}`,
    { timeout },
  );
  await expect(interviewQuestionPage.questionText).toContainText(
    questionCase.question,
  );
  await expect(interviewQuestionPage.remainingTime).toHaveText(
    formatTimer(sampleRateFlowConfig.timeLimitSeconds),
  );

  return interviewQuestionPage;
};

const answerCurrentQuestionWithAudio = async (
  page: Page,
  questionCase: SampleRateQuestionCase,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<InterviewQuestionPage> => {
  return await test.step(`Question ${questionCase.questionIndex + 1} should accept applicant audio`, async () => {
    const interviewQuestionPage = await expectCurrentInterviewQuestion(
      page,
      questionCase,
    );

    await flow.waitForInterviewerAudioToStart();
    await wait(questionPromptSettleMs);
    await expectNoVisibleInterviewErrors(page);

    const initialTimerSeconds = timeToSeconds(
      await interviewQuestionPage.remainingTime.innerText(),
    );
    const applicantAudioPlayback = virtualMicrophone.playAudioBase64(
      questionCase.answerAudioBase64,
    );

    await expect(interviewQuestionPage.submitAnswerBtn).toBeEnabled({
      timeout: 15000,
    });
    await expect
      .poll(
        async () =>
          timeToSeconds(await interviewQuestionPage.remainingTime.innerText()),
        {
          intervals: [500, 1000],
          timeout: 30000,
        },
      )
      .toBeLessThan(initialTimerSeconds);

    const applicantAudioDurationSeconds = await applicantAudioPlayback;

    expect(applicantAudioDurationSeconds).toBeGreaterThan(0);
    await expect
      .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
        timeout: 10000,
      })
      .toBe(true);
    await expectNoVisibleInterviewErrors(page);

    return interviewQuestionPage;
  });
};

const waitForTimerToAdvanceToQuestion = async (
  page: Page,
  questionCase: SampleRateQuestionCase,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<void> => {
  await test.step(`The timer should advance to question ${questionCase.questionIndex + 1}`, async () => {
    await virtualMicrophone.resetObservedAudioPlayback();
    await expectCurrentInterviewQuestion(
      page,
      questionCase,
      questionAdvanceTimeoutMs,
    );
    await flow.waitForInterviewerAudioToStart();
    await expectNoVisibleInterviewErrors(page);
  });
};

const submitCurrentQuestionAndAdvance = async (
  page: Page,
  nextQuestionCase: SampleRateQuestionCase,
  flow: InterviewFlowActions,
): Promise<void> => {
  await test.step(`Submitting should advance to question ${nextQuestionCase.questionIndex + 1}`, async () => {
    await flow.submitCurrentQuestion();
    await expectCurrentInterviewQuestion(page, nextQuestionCase);
  });
};

const expectInterviewToFinish = async (page: Page): Promise<void> => {
  await expect(page.getByText("The interview is now complete.")).toBeVisible({
    timeout: 30000,
  });
  await expectNoVisibleInterviewErrors(page);
};

test.describe("Interview Flow - Applicant audio sample rates", () => {
  for (const sampleRateHz of sampleRatesHz) {
    test(`The non-interactive flow should finish with ${sampleRateHz} Hz applicant audio`, async ({
      apiAdmin,
      page,
    }, testInfo) => {
      test.setTimeout(sampleRateTestTimeoutMs);

      const interviewUrl = await seedSampleRateInterview(
        apiAdmin,
        sampleRateHz,
      );
      const questionCases = sampleRateFlowConfig.questions.map(
        ({ answer, question }, questionIndex) => ({
          answer,
          answerAudioBase64: createSpeechAudioBase64(answer, {
            sampleRateHz,
            voice: sampleRateFlowConfig.ttsVoice,
          }),
          question,
          questionIndex,
        }),
      );
      const virtualMicrophone = new VirtualMicrophone(page, {
        speechStartDelayMs: 1500,
        voice: sampleRateFlowConfig.ttsVoice,
      });
      const flow = new InterviewFlowActions({ page, virtualMicrophone });

      await virtualMicrophone.install();
      await prepareSampleRateInterview(page, interviewUrl, flow, testInfo);
      await expect(page).toHaveURL(/\/interview\//);

      await answerCurrentQuestionWithAudio(
        page,
        questionCases[0],
        flow,
        virtualMicrophone,
      );
      await waitForTimerToAdvanceToQuestion(
        page,
        questionCases[1],
        flow,
        virtualMicrophone,
      );
      await answerCurrentQuestionWithAudio(
        page,
        questionCases[1],
        flow,
        virtualMicrophone,
      );
      await submitCurrentQuestionAndAdvance(page, questionCases[2], flow);
      await answerCurrentQuestionWithAudio(
        page,
        questionCases[2],
        flow,
        virtualMicrophone,
      );
      await flow.submitCurrentQuestion();
      await expectInterviewToFinish(page);
    });
  }
});
