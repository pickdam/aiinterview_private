import { setTimeout as wait } from "node:timers/promises";

import type { Page, TestInfo } from "@playwright/test";
import type { ReportingApi } from "@src/api/reporting-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { refreshAdminBrowserAuth } from "@src/utils/api-auth";
import { Home } from "@src/pages/home.page";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import { ReportPage } from "@src/pages/report.page";
import {
  formatTimer,
  InterviewFlowActions,
  timeToSeconds,
} from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import {
  calculateTranscriptionSimilarity,
  normalizeForTranscriptionComparison,
  reportGenerationErrorPattern,
  transcriptionErrorPattern,
} from "@src/utils/transcription-comparison";
import {
  createSpeechAudioBase64,
  VirtualMicrophone,
} from "@src/utils/virtual-microphone";

type ManyQuestionsCase = {
  answer: string;
  answerAudioBase64: string;
  question: string;
  questionIndex: number;
};

type ManyQuestionsFlowConfig = {
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: Array<{
    answer: string;
    question: string;
  }>;
  sttProvider: SttProvider;
  timeLimitSeconds: number;
  ttsVoice: string;
};

type SeededInterview = {
  interviewUrl: string;
  seededEmail: string;
};

const manyQuestionsFlowConfig = {
  language: "ja",
  languageLabel: "Japanese",
  providerLabel: "OpenAI",
  questions: [
    {
      question: "あなたの強みについて教えてください。",
      answer:
        "私の強みは、複雑な課題を整理して着実に進められることです。優先順位を決め、周囲と確認しながら最後まで責任を持って対応します。",
    },
    {
      question: "これまでの職務経歴について教えてください。",
      answer:
        "これまで主にIT業界で経験を積みました。社内システムの運用サポート、データ管理、プロジェクト進行管理、関係部署との調整を担当しました。",
    },
    {
      question: "仕事で大切にしていることを教えてください。",
      answer:
        "仕事では目的の確認と情報共有を大切にしています。関係者と認識を合わせ、問題が起きた時は早めに相談して安定した成果につなげます。",
    },
    {
      question: "困難な状況を乗り越えた経験を教えてください。",
      answer:
        "システム移行時に作業遅延が起きたことがあります。影響範囲を整理し、優先度の高い作業から分担して進め、予定内に移行を完了しました。",
    },
    {
      question: "チームで協力した経験について教えてください。",
      answer:
        "部署をまたぐ改善活動で、現場の要望と運用側の制約を整理しました。双方に確認しながら手順を調整し、使いやすい運用に改善しました。",
    },
    {
      question: "新しいことを学んだ経験を教えてください。",
      answer:
        "新しい分析ツールを担当した時は、公式資料を読み、検証環境で操作を試しました。学んだ内容を手順書にまとめ、チームにも共有しました。",
    },
    {
      question: "ミスを防ぐために工夫していることを教えてください。",
      answer:
        "作業前に目的、手順、確認項目を整理しています。完了後はチェックリストで見直し、重要な変更は第三者にも確認してもらいます。",
    },
    {
      question: "周囲と意見が違った時の対応を教えてください。",
      answer:
        "まず相手の背景と懸念を聞くようにしています。その上で事実と目的を整理し、複数の案を比較して合意しやすい進め方を提案します。",
    },
    {
      question: "今後伸ばしたいスキルについて教えてください。",
      answer:
        "今後はデータを使った課題分析力を伸ばしたいです。業務改善の効果を数字で説明し、より納得感のある提案ができるようになりたいです。",
    },
    {
      question: "最後に自己PRをお願いします。",
      answer:
        "私は地道に状況を整理し、周囲と協力しながら仕事を進めることができます。変化がある場面でも落ち着いて対応し、成果につなげます。",
    },
  ],
  sttProvider: "openai",
  timeLimitSeconds: 30,
  ttsVoice: "Kyoko",
} satisfies ManyQuestionsFlowConfig;

const questionCount = manyQuestionsFlowConfig.questions.length;
const timedOutQuestionIndex = 4;
const questionPromptSettleMs = 3000;
const questionAdvanceTimeoutMs = 45000;
const reportReadyTimeoutMs = 900000;
const manyQuestionsTestTimeoutMs = 1200000;
const minimumTranscriptSimilarity = 0.6;
const visibleInterviewErrorPattern =
  /Audio playback failed|Audio initialization failed|Media Stream Error|Camera\/Microphone Error|An unexpected error occurred/i;

const seedManyQuestionsInterview = async (
  apiAdmin: ReportingApi,
): Promise<SeededInterview> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+many-questions+${timestamp}@givery.co.jp`;

  const companyResp = await apiAdmin.createCompany({
    company_name: `E2E Many Questions ${manyQuestionsFlowConfig.providerLabel} ${manyQuestionsFlowConfig.languageLabel} ${timestamp}`,
    stt_provider: manyQuestionsFlowConfig.sttProvider,
  });
  const { company_id: companyId } = await companyResp.json();

  const interviewBuilder = new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Many Questions ${manyQuestionsFlowConfig.providerLabel} ${manyQuestionsFlowConfig.languageLabel} ${timestamp}`,
    )
    .description("E2E non-interactive flow check with ten questions")
    .language(manyQuestionsFlowConfig.language)
    .version(2)
    .linkMaxUses(1);

  for (const { question } of manyQuestionsFlowConfig.questions) {
    interviewBuilder.withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(question)
        .category("general")
        .language(manyQuestionsFlowConfig.language)
        .timeLimit(manyQuestionsFlowConfig.timeLimitSeconds),
    );
  }

  const interview = await interviewBuilder.build();

  return {
    interviewUrl: interview.interviewUrl,
    seededEmail,
  };
};

const prepareInterview = async (
  page: Page,
  interviewUrl: string,
  flow: InterviewFlowActions,
  testInfo: TestInfo,
): Promise<void> => {
  const applicantName = withBrowserApplicantPrefix(
    testInfo,
    `Many Questions applicant - ${manyQuestionsFlowConfig.providerLabel} - ${manyQuestionsFlowConfig.languageLabel} - ${Date.now()}`,
  );

  await page.goto(interviewUrl);
  await flow.enterSetup(applicantName);
  await flow.completeMediaSetup({ toneMs: 7000 });
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
  questionCase: ManyQuestionsCase,
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
    formatTimer(manyQuestionsFlowConfig.timeLimitSeconds),
  );

  return interviewQuestionPage;
};

const answerCurrentQuestion = async (
  page: Page,
  questionCase: ManyQuestionsCase,
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

const submitCurrentQuestionAndAdvance = async (
  page: Page,
  nextQuestionCase: ManyQuestionsCase,
  flow: InterviewFlowActions,
): Promise<void> => {
  await test.step(`Submitting should advance to question ${nextQuestionCase.questionIndex + 1}`, async () => {
    await flow.submitCurrentQuestion();
    await expectCurrentInterviewQuestion(page, nextQuestionCase);
  });
};

const waitForTimerToAdvanceToQuestion = async (
  page: Page,
  nextQuestionCase: ManyQuestionsCase,
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
): Promise<void> => {
  await test.step(`The timer should advance to question ${nextQuestionCase.questionIndex + 1}`, async () => {
    await virtualMicrophone.resetObservedAudioPlayback();
    await expectCurrentInterviewQuestion(
      page,
      nextQuestionCase,
      questionAdvanceTimeoutMs,
    );
    await flow.waitForInterviewerAudioToStart();
    await expectNoVisibleInterviewErrors(page);
  });
};

const expectInterviewToFinish = async (page: Page): Promise<void> => {
  await expect(page.getByText("The interview is now complete.")).toBeVisible({
    timeout: 30000,
  });
  await expectNoVisibleInterviewErrors(page);
};

const openGeneratedReport = async (
  pageAdmin: Page,
  seededEmail: string,
): Promise<ReportPage> => {
  const dashboard = new Home(pageAdmin);

  await refreshAdminBrowserAuth(pageAdmin);
  await dashboard.goto();
  await dashboard.searchCandidateByEmail(seededEmail);
  await expect(dashboard.openReportLink).toBeVisible({
    timeout: 180000,
  });

  const [reportTab] = await Promise.all([
    pageAdmin.waitForEvent("popup"),
    dashboard.openReport(),
  ]);
  const reportPage = new ReportPage(reportTab);

  await reportTab.waitForLoadState("domcontentloaded");
  await reportTab.bringToFront();
  await expect(async () => {
    await reportTab.reload({ waitUntil: "domcontentloaded" });
    await expect(
      reportPage.page.locator("main").getByText(reportGenerationErrorPattern),
    ).toHaveCount(0);
    await expect(reportPage.examLogHeading).toBeVisible({
      timeout: 10000,
    });
    await expect(reportPage.recordingVideo).toBeVisible();
  }).toPass({
    intervals: [30000, 60000, 120000],
    timeout: reportReadyTimeoutMs,
  });

  return reportPage;
};

const expectReportTranscriptions = async (
  reportPage: ReportPage,
  expectedAnswers: string[],
): Promise<void> => {
  await expect(reportPage.recordingQuestionButtons).toHaveCount(questionCount);

  await reportPage.openTranscript();
  await expect(reportPage.transcriptPanel).toBeVisible();
  await expect(
    reportPage.examLogSection.getByText(transcriptionErrorPattern),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await reportPage.getCandidateTranscriptTexts()).length, {
      timeout: 120000,
    })
    .toBeGreaterThanOrEqual(questionCount);

  const transcriptTexts = await reportPage.getCandidateTranscriptTexts();

  for (const transcriptText of transcriptTexts) {
    expect(
      normalizeForTranscriptionComparison(transcriptText).length,
    ).toBeGreaterThan(0);
    expect(transcriptText).not.toMatch(transcriptionErrorPattern);
  }

  for (const [answerIndex, expectedAnswer] of expectedAnswers.entries()) {
    const bestTranscriptSimilarity = Math.max(
      ...transcriptTexts.map((transcriptText) =>
        calculateTranscriptionSimilarity(expectedAnswer, transcriptText),
      ),
    );

    expect(
      bestTranscriptSimilarity,
      `Question ${answerIndex + 1} transcript should be at least 60% similar to the submitted answer`,
    ).toBeGreaterThanOrEqual(minimumTranscriptSimilarity);
  }
};

test.describe("Interview Flow - Non-interactive many questions @interview", () => {
  test("A Japanese non-interactive flow should handle ten answered questions with one timeout", async ({
    freshApiAdmin: apiAdmin,
    page,
    pageAdmin,
  }, testInfo) => {
    test.setTimeout(manyQuestionsTestTimeoutMs);

    const { interviewUrl, seededEmail } =
      await seedManyQuestionsInterview(apiAdmin);
    const questionCases = manyQuestionsFlowConfig.questions.map(
      ({ answer, question }, questionIndex) => ({
        answer,
        answerAudioBase64: createSpeechAudioBase64(answer, {
          voice: manyQuestionsFlowConfig.ttsVoice,
        }),
        question,
        questionIndex,
      }),
    );
    const submitBeforeTimeoutCases = questionCases.slice(
      0,
      timedOutQuestionIndex,
    );
    const timedOutQuestionCase = questionCases[timedOutQuestionIndex];
    const submitAfterTimeoutCases = questionCases.slice(
      timedOutQuestionIndex + 1,
    );
    const finalQuestionCase =
      submitAfterTimeoutCases[submitAfterTimeoutCases.length - 1];
    const virtualMicrophone = new VirtualMicrophone(page, {
      speechStartDelayMs: 1500,
      voice: manyQuestionsFlowConfig.ttsVoice,
    });
    const flow = new InterviewFlowActions({ page, virtualMicrophone });

    await virtualMicrophone.install();
    await prepareInterview(page, interviewUrl, flow, testInfo);
    await expect(page).toHaveURL(/\/interview\//);

    for (const questionCase of submitBeforeTimeoutCases) {
      await answerCurrentQuestion(page, questionCase, flow, virtualMicrophone);
      await submitCurrentQuestionAndAdvance(
        page,
        questionCases[questionCase.questionIndex + 1],
        flow,
      );
    }

    await answerCurrentQuestion(
      page,
      timedOutQuestionCase,
      flow,
      virtualMicrophone,
    );
    await waitForTimerToAdvanceToQuestion(
      page,
      questionCases[timedOutQuestionCase.questionIndex + 1],
      flow,
      virtualMicrophone,
    );

    for (const questionCase of submitAfterTimeoutCases.slice(0, -1)) {
      await answerCurrentQuestion(page, questionCase, flow, virtualMicrophone);
      await submitCurrentQuestionAndAdvance(
        page,
        questionCases[questionCase.questionIndex + 1],
        flow,
      );
    }

    await answerCurrentQuestion(
      page,
      finalQuestionCase,
      flow,
      virtualMicrophone,
    );
    await flow.submitCurrentQuestion();
    await expectInterviewToFinish(page);

    const reportPage = await openGeneratedReport(pageAdmin, seededEmail);

    await expectReportTranscriptions(
      reportPage,
      questionCases.map(({ answer }) => answer),
    );
  });
});
