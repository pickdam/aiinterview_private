import type { Page } from "@playwright/test";
import { LmStudioApi } from "@src/api/lm-studio-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
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
  createSpeechAudioBase64,
  VirtualMicrophone,
} from "@src/utils/virtual-microphone";
import {
  calculateTranscriptionSimilarity,
  normalizeForTranscriptionComparison,
  reportGenerationErrorPattern,
  transcriptionErrorPattern,
} from "@src/utils/transcription-comparison";

// ============================================================
// Types
// ============================================================

type QuestionBank = Record<
  string,
  {
    answer: string;
    question: string;
  }
>;

type InteractiveFlowConfig = {
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  sttProvider: SttProvider;
  questionBank: QuestionBank;
  voice: string;
  closingRemark: string;
};

type QuestionRecord = {
  question: string;
  answer: string | null; // null if timed out without answer
  isDeepDive: boolean;
};

type AdvanceMethod = "submit" | "timeout";

type LeadUpQuestionOptions = {
  interviewerAudioAlreadyFinished?: boolean;
};

type AnsweredQuestionRecord = QuestionRecord & {
  answer: string;
};

// ============================================================
// Question Banks
// ============================================================

const questionBankByLanguage = {
  en: {
    strengths: {
      question: "Tell me about your strengths.",
      answer:
        "My strength is organizing problems and working through them steadily. Even when a situation is complex, I break it down, prioritize the next steps, and keep moving forward. I also value clear communication with the people around me and take responsibility for finishing the work.",
    },
    workhistory: {
      question: "Tell me about your work history.",
      answer:
        "I have mainly built my experience in the IT industry. I started at ABC Solutions, where I supported internal system operations and data management. Later, I moved to Next Wave and handled project coordination and communication across teams. I currently work at Sunrise Tech, where I support process improvement and daily operations with my team.",
    },
    teamwork: {
      question: "What do you focus on when working in a team?",
      answer:
        "When working in a team, I prioritize open and transparent communication. I make sure everyone understands the goals and their responsibilities, and I actively share updates on my progress. I also listen carefully to my teammates, respect different perspectives, and work collaboratively to solve problems together.",
    },
  },
  ja: {
    strengths: {
      question: "あなたの強みについて教えてください。",
      answer:
        "私の強みは、課題を整理して、着実に対応できるところです。複雑なことでも一つずつ整理し、優先順位をつけながら進めることができます。また、周囲としっかりコミュニケーションを取りながら、最後まで責任を持ってやり遂げることを大切にしています。",
    },
    workhistory: {
      question: "これまでの職務経歴について教えてください。",
      answer:
        "これまで、主にIT業界で経験を積んできました。 新卒でABCソリューションズ株式会社に入社し、主に社内システムの運用サポートやデータ管理業務を担当しました。 その後、ネクストウェーブ株式会社に転職し、プロジェクトの進行管理や関係部署との調整業務など、より幅広い業務に携わりました。現在はサンライズテック株式会社で、チームと連携しながら業務改善や日々のオペレーション支援に取り組んでいます。",
    },
    teamwork: {
      question: "チームワークで心がけていることを教えてください。",
      answer:
        "私はチームワークにおいて、オープンなコミュニケーションを大切にしています。全員が目標や役割を理解できるよう心がけ、自分の進捗状況も積極的に共有します。また、メンバーの意見をしっかりと聞き、それぞれの視点を尊重しながら、協力して課題を解決していくことを意識しています。",
    },
  },
} satisfies Record<InterviewLanguage, QuestionBank>;

// ============================================================
// Test Scenarios
// ============================================================

const interactiveFlowScenarios: InteractiveFlowConfig[] = [
  {
    language: "ja",
    languageLabel: "Japanese",
    providerLabel: "OpenAI",
    sttProvider: "openai",
    questionBank: questionBankByLanguage.ja,
    voice: "Kyoko",
    closingRemark: "次に進みます",
  },
  {
    language: "ja",
    languageLabel: "Japanese",
    providerLabel: "ElevenLabs",
    sttProvider: "elevenlabs",
    questionBank: questionBankByLanguage.ja,
    voice: "Kyoko",
    closingRemark: "次に進みます",
  },
  {
    language: "en",
    languageLabel: "English",
    providerLabel: "OpenAI",
    sttProvider: "openai",
    questionBank: questionBankByLanguage.en,
    voice: "Samantha",
    closingRemark: "We'll move to the next question.",
  },
  {
    language: "en",
    languageLabel: "English",
    providerLabel: "ElevenLabs",
    sttProvider: "elevenlabs",
    questionBank: questionBankByLanguage.en,
    voice: "Samantha",
    closingRemark: "We'll move to the next question.",
  },
];

// ============================================================
// Constants
// ============================================================

const totalLeadUpQuestions = 3;
const questionTimeoutBufferSeconds = 45;
const timeoutToneDurationMs = 3000;
const timeoutToneIntervalMs = 1000;
const closingRemarkSignals = [
  "次に進みます",
  "We'll move to the next question.",
];
const languageNameByCode = {
  en: "English",
  ja: "Japanese",
} satisfies Record<InterviewLanguage, string>;

// ============================================================
// Helper Functions
// ============================================================

const normalizeVisibleText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

const getQuestionText = async (
  interviewQuestionPage: InterviewQuestionPage,
): Promise<string> => {
  return (await interviewQuestionPage.questionText.innerText()).trim();
};

const isInterviewCompleteVisible = async (page: Page): Promise<boolean> => {
  return page
    .getByText(/The interview is now complete|面接が完了しました/i)
    .isVisible()
    .catch(() => false);
};

const isClosingRemarkText = (
  questionText: string,
  scenarioClosingRemark: string,
): boolean => {
  const normalizedQuestionText = normalizeVisibleText(questionText);
  const possibleClosingRemarks = [
    scenarioClosingRemark,
    ...closingRemarkSignals,
  ];

  return possibleClosingRemarks.some((closingRemark) =>
    normalizedQuestionText.includes(normalizeVisibleText(closingRemark)),
  );
};

const getLatestLeadUpAnswer = (
  questionRecords: QuestionRecord[],
): AnsweredQuestionRecord | undefined => {
  return questionRecords.findLast(
    (record): record is AnsweredQuestionRecord =>
      !record.isDeepDive && record.answer !== null,
  );
};

const buildDeepDiveAnswerPrompt = ({
  interviewLanguage,
  previousLeadUpAnswer,
  questionText,
}: {
  interviewLanguage: InterviewLanguage;
  previousLeadUpAnswer: AnsweredQuestionRecord | undefined;
  questionText: string;
}): string => {
  const languageName = languageNameByCode[interviewLanguage];
  const previousContext = previousLeadUpAnswer
    ? [
        `Previous lead-up question: ${previousLeadUpAnswer.question}`,
        `Previous candidate answer: ${previousLeadUpAnswer.answer}`,
      ].join("\n")
    : "No previous answer context is available.";

  return [
    "You are answering an interactive job interview as the candidate.",
    `The interview language is ${languageName}. Always answer in ${languageName}, even if the follow-up question is written in another language.`,
    "Use the previous candidate answer as context. Do not say that you have not answered yet if the previous answer already contains the relevant information.",
    previousContext,
    `Current follow-up question: ${questionText}`,
    `Answer naturally in ${languageName}. Keep the answer concise, direct, and consistent with the previous answer.`,
  ].join("\n\n");
};

const waitForQuestionTextToChange = async (
  interviewQuestionPage: InterviewQuestionPage,
  previousQuestionText: string,
): Promise<string> => {
  const normalizedPreviousQuestionText =
    normalizeVisibleText(previousQuestionText);

  await expect
    .poll(
      async () =>
        normalizeVisibleText(
          await interviewQuestionPage.questionText.innerText(),
        ),
      {
        timeout: 20000,
      },
    )
    .not.toBe(normalizedPreviousQuestionText);

  return getQuestionText(interviewQuestionPage);
};

const waitForCurrentQuestionTimerToExpire = async (
  interviewQuestionPage: InterviewQuestionPage,
  virtualMicrophone: VirtualMicrophone,
): Promise<void> => {
  const initialQuestionText = normalizeVisibleText(
    await getQuestionText(interviewQuestionPage),
  );
  const remainingSeconds = timeToSeconds(
    await interviewQuestionPage.remainingTime.innerText(),
  );
  const timeoutMs = (remainingSeconds + questionTimeoutBufferSeconds) * 1000;

  await expect
    .poll(
      async () => {
        await virtualMicrophone.emitTone(timeoutToneDurationMs);

        if (await isInterviewCompleteVisible(interviewQuestionPage.page)) {
          return true;
        }

        const currentQuestionText = normalizeVisibleText(
          await getQuestionText(interviewQuestionPage).catch(() => ""),
        );

        if (
          currentQuestionText &&
          currentQuestionText !== initialQuestionText
        ) {
          return true;
        }

        const currentTimerSeconds = await interviewQuestionPage.remainingTime
          .innerText()
          .then(timeToSeconds)
          .catch(() => 0);

        return currentTimerSeconds <= 1;
      },
      {
        intervals: [timeoutToneIntervalMs],
        timeout: timeoutMs,
      },
    )
    .toBe(true);
};

const waitForCurrentQuestionTimerToStart = async (
  interviewQuestionPage: InterviewQuestionPage,
  initialTimerSeconds: number,
): Promise<void> => {
  await expect
    .poll(
      async () =>
        timeToSeconds(await interviewQuestionPage.remainingTime.innerText()),
      {
        intervals: [500],
        timeout: 30000,
      },
    )
    .toBeLessThan(initialTimerSeconds);
};

/**
 * Answer a lead-up question and verify all expected behavior
 * NOTE: Does NOT submit/advance - that happens in the deep dive loop after closing remarks
 */
const answerLeadUpQuestion = async (
  page: Page,
  questionIndex: number,
  questionData: { question: string; answer: string },
  flow: InterviewFlowActions,
  virtualMicrophone: VirtualMicrophone,
  { interviewerAudioAlreadyFinished = false }: LeadUpQuestionOptions = {},
): Promise<void> => {
  await test.step(`Lead-up question ${questionIndex + 1}: Answer`, async () => {
    const interviewQuestionPage = new InterviewQuestionPage(page);

    // Verify question appears
    await expect(interviewQuestionPage.interviewerPreview).toBeVisible();
    await expect(interviewQuestionPage.intervieweeVideoFeedback).toBeVisible();
    await expect
      .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
        timeout: 10000,
      })
      .toBe(true);

    // Verify counter shows correct lead-up question index
    await expect(interviewQuestionPage.questionCount).toHaveText(
      `${questionIndex}/${totalLeadUpQuestions}`,
      { timeout: 15000 },
    );

    // Verify question text
    await expect(interviewQuestionPage.questionText).toContainText(
      questionData.question,
    );

    // Candidate input is accepted only after the interviewer has finished.
    if (!interviewerAudioAlreadyFinished) {
      await flow.waitForInterviewerAudioToFinish();
    }

    // Verify timer shows full time
    const initialTimerText = formatTimer(60);
    await expect(interviewQuestionPage.remainingTime).toHaveText(
      initialTimerText,
    );

    // Generate and play answer audio
    const answerAudioBase64 = createSpeechAudioBase64(questionData.answer, {
      voice: virtualMicrophone["options"].voice,
    });
    await virtualMicrophone.playAudioBase64(answerAudioBase64);

    // Verify timer started counting down
    const initialTimerSeconds = timeToSeconds(
      await interviewQuestionPage.remainingTime.innerText(),
    );
    await waitForCurrentQuestionTimerToStart(
      interviewQuestionPage,
      initialTimerSeconds,
    );

    // Verify submit button enabled
    await expect(interviewQuestionPage.submitAnswerBtn).toBeEnabled({
      timeout: 15000,
    });
  });
};

/**
 * Handle the deep dive loop for a lead-up question
 * Also handles advancing the lead-up question first
 */
const handleDeepDiveLoop = async (
  page: Page,
  leadUpQuestionIndex: number,
  leadUpAdvanceMethod: AdvanceMethod,
  deepDiveAdvanceMethod: AdvanceMethod,
  interviewLanguage: InterviewLanguage,
  lmStudio: LmStudioApi,
  virtualMicrophone: VirtualMicrophone,
  flow: InterviewFlowActions,
  closingRemark: string,
  questionRecords: QuestionRecord[],
): Promise<void> => {
  await test.step(`Deep dive loop for question ${leadUpQuestionIndex + 1}`, async () => {
    const interviewQuestionPage = new InterviewQuestionPage(page);
    let deepDiveCount = 0;
    let previousQuestionText = await getQuestionText(interviewQuestionPage);

    // First, handle advancing the lead-up question
    if (leadUpAdvanceMethod === "submit") {
      await flow.submitCurrentQuestion();
    } else {
      // Wait for timer to expire
      await waitForCurrentQuestionTimerToExpire(
        interviewQuestionPage,
        virtualMicrophone,
      );
    }

    // Now handle deep dive questions
    let shouldContinueDeepDiveLoop = true;
    while (shouldContinueDeepDiveLoop) {
      if (await isInterviewCompleteVisible(page)) {
        shouldContinueDeepDiveLoop = false;
        continue;
      }

      let questionText = await getQuestionText(interviewQuestionPage).catch(
        () => "",
      );

      if (
        normalizeVisibleText(questionText) ===
        normalizeVisibleText(previousQuestionText)
      ) {
        // Reset and wait for next audio (deep dive question or closing remark)
        await virtualMicrophone.resetObservedAudioPlayback();
        await flow.waitForInterviewerAudioToStart();

        // Read the text while the audio is still playing. The closing remark can
        // disappear immediately after playback when the app advances.
        questionText = await waitForQuestionTextToChange(
          interviewQuestionPage,
          previousQuestionText,
        );
      }

      // Check if closing remark detected
      if (isClosingRemarkText(questionText, closingRemark)) {
        await flow.waitForInterviewerAudioToFinish().catch(async (error) => {
          if (!(await isInterviewCompleteVisible(page))) {
            throw error;
          }
        });
        await test.step(`Closing remark detected: "${closingRemark}"`, async () => {
          // Deep dives complete - closing remark shown
          expect(deepDiveCount).toBeGreaterThanOrEqual(1);
        });
        shouldContinueDeepDiveLoop = false;
        continue;
      }

      await flow.waitForInterviewerAudioToFinish().catch(async (error) => {
        if (!(await isInterviewCompleteVisible(page))) {
          throw error;
        }
      });
      previousQuestionText = questionText;
      deepDiveCount++;

      await test.step(`Deep dive question ${deepDiveCount} for lead-up ${leadUpQuestionIndex + 1}`, async () => {
        // Verify counter hasn't changed (still showing lead-up index)
        await expect(interviewQuestionPage.questionCount).toHaveText(
          `${leadUpQuestionIndex}/${totalLeadUpQuestions}`,
        );

        // Send question to LM Studio (start early, in parallel)
        const answerPromise = lmStudio.ask(
          buildDeepDiveAnswerPrompt({
            interviewLanguage,
            previousLeadUpAnswer: getLatestLeadUpAnswer(questionRecords),
            questionText,
          }),
          {
            maxTokens: 150,
            systemPrompt:
              "You are the interview candidate. Answer only with the candidate's spoken response.",
          },
        );

        // Capture the timer before applicant audio. The timer starts only after
        // candidate input is heard.
        const initialTimerSeconds = timeToSeconds(
          await interviewQuestionPage.remainingTime.innerText(),
        );

        // Wait for LM Studio response
        const answer = await answerPromise;

        // Record this deep dive Q&A
        questionRecords.push({
          question: questionText,
          answer: answer,
          isDeepDive: true,
        });

        // Generate audio and play
        await virtualMicrophone.speak(answer);

        // Verify the applicant audio started the timer before checking submit.
        await waitForCurrentQuestionTimerToStart(
          interviewQuestionPage,
          initialTimerSeconds,
        );

        // Verify submit button enabled
        await expect(interviewQuestionPage.submitAnswerBtn).toBeEnabled({
          timeout: 30000,
        });

        // Advance based on method
        if (deepDiveAdvanceMethod === "submit") {
          await flow.submitCurrentQuestion();
        } else {
          // Wait for timeout
          await waitForCurrentQuestionTimerToExpire(
            interviewQuestionPage,
            virtualMicrophone,
          );
        }
      });
    }

    // After closing remark, wait for auto-advancement
    await test.step(`Wait for auto-advancement after closing remark`, async () => {
      // Wait for counter to update or interview to complete
      const nextQuestionIndex = leadUpQuestionIndex + 1;
      if (nextQuestionIndex < totalLeadUpQuestions) {
        // Should advance to next lead-up question
        await virtualMicrophone.resetObservedAudioPlayback();
        await expect(interviewQuestionPage.questionCount).toHaveText(
          `${nextQuestionIndex}/${totalLeadUpQuestions}`,
          { timeout: 30000 },
        );
        await flow.waitForInterviewerAudioToFinish();
      } else {
        // Interview should be complete
        await expect(
          page.getByText(/The interview is now complete|面接が完了しました/i),
        ).toBeVisible({ timeout: 30000 });
      }
    });
  });
};

/**
 * Verify the report generation and transcript accuracy
 */
const verifyReport = async (
  pageAdmin: Page,
  seededEmail: string,
  questionRecords: QuestionRecord[],
  scenario: InteractiveFlowConfig,
): Promise<void> => {
  await test.step(`Verify report for ${scenario.languageLabel} with ${scenario.providerLabel}`, async () => {
    const dashboard = new Home(pageAdmin);

    await dashboard.goto();
    await dashboard.searchCandidateByEmail(seededEmail);
    await expect(dashboard.openReportLink).toBeVisible({
      timeout: 120000,
    });

    const [reportTab] = await Promise.all([
      pageAdmin.waitForEvent("popup"),
      dashboard.openReport(),
    ]);
    const reportPage = new ReportPage(reportTab);

    await reportTab.waitForLoadState("domcontentloaded");
    await reportTab.bringToFront();

    // Wait for report generation with retries
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
      intervals: [15000, 30000, 60000],
      timeout: 420000,
    });

    // Verify total question count (lead-up + deep dives)
    const totalQuestions = questionRecords.length;
    await expect(reportPage.recordingQuestionButtons).toHaveCount(
      totalQuestions,
    );

    // Open transcript panel
    await reportPage.openTranscript();
    await expect(reportPage.transcriptPanel).toBeVisible();
    await expect(
      reportPage.examLogSection.getByText(transcriptionErrorPattern),
    ).toHaveCount(0);

    // Wait for all transcripts to be generated
    const answeredQuestions = questionRecords.filter((q) => q.answer !== null);
    await expect
      .poll(
        async () => (await reportPage.getCandidateTranscriptTexts()).length,
        {
          timeout: 60000,
        },
      )
      .toBeGreaterThanOrEqual(answeredQuestions.length);

    const transcriptTexts = await reportPage.getCandidateTranscriptTexts();

    // Verify no transcription errors
    for (const transcriptText of transcriptTexts) {
      expect(
        normalizeForTranscriptionComparison(transcriptText).length,
      ).toBeGreaterThan(0);
      expect(transcriptText).not.toMatch(transcriptionErrorPattern);
    }

    // Verify transcript accuracy for all answered questions
    for (const { question, answer, isDeepDive } of answeredQuestions) {
      if (answer === null) continue;

      const bestTranscriptSimilarity = Math.max(
        ...transcriptTexts.map((transcriptText) =>
          calculateTranscriptionSimilarity(answer, transcriptText),
        ),
      );

      const questionType = isDeepDive ? "Deep dive" : "Lead-up";
      expect(
        bestTranscriptSimilarity,
        `${questionType} question "${question.substring(0, 50)}..." transcript should be at least 60% similar`,
      ).toBeGreaterThanOrEqual(0.6);
    }

    // Verify recording video works
    await reportPage.selectRecordingQuestion(1);
    await expect
      .poll(() => reportPage.isRecordingReady(), { timeout: 30000 })
      .toBe(true);

    const initialRecordingTime = await reportPage.getRecordingCurrentTime();

    await reportPage.playRecording();
    await expect
      .poll(() => reportPage.getRecordingCurrentTime(), {
        timeout: 15000,
      })
      .toBeGreaterThan(initialRecordingTime);
    await expect
      .poll(() => reportPage.isRecordingPlaying(), { timeout: 10000 })
      .toBe(true);
    await reportPage.pauseRecording();
  });
};

// ============================================================
// Tests
// ============================================================

test.describe("Interview Flow - Interactive with Deep Dives", () => {
  for (const scenario of interactiveFlowScenarios) {
    test.describe(`${scenario.languageLabel} - ${scenario.providerLabel}`, () => {
      let seededEmail: string;
      let interviewUrl: string;

      test.beforeEach(async ({ apiAdmin }) => {
        const timestamp = Date.now();
        seededEmail = `product-dev_qa+ai+interactive+${scenario.language}+${scenario.sttProvider}+${timestamp}@givery.co.jp`;

        const companyResp = await apiAdmin.createCompany({
          company_name: `E2E Interactive ${scenario.providerLabel} ${scenario.languageLabel} ${timestamp}`,
          stt_provider: scenario.sttProvider,
        });
        const { company_id: companyId } = await companyResp.json();

        const interviewBuilder = new InterviewBuilder(apiAdmin)
          .forCompany(companyId)
          .sendTo(seededEmail)
          .name(
            `E2E Interactive ${scenario.providerLabel} ${scenario.languageLabel}`,
          )
          .description("E2E interactive interview with deep dives")
          .language(scenario.language)
          .version(2)
          .interactive(true) // Enable interactive mode
          .linkMaxUses(1);

        // Add 3 lead-up questions with deep dive configuration
        for (const { question } of Object.values(scenario.questionBank)) {
          interviewBuilder.withQuestion(
            (qb) =>
              qb
                .transcript(question)
                .category("general")
                .language(scenario.language)
                .timeLimit(60)
                .deepDives(1, 1), // min=1, max=1
          );
        }

        const interview = await interviewBuilder.build();
        interviewUrl = interview.interviewUrl;
      });

      test(`User should be able to take an interactive interview with deep dives in ${scenario.languageLabel} with ${scenario.providerLabel}`, async ({
        page,
        pageAdmin,
      }, testInfo) => {
        test.setTimeout(900000); // 15 minutes

        const applicantName = withBrowserApplicantPrefix(
          testInfo,
          `Interactive applicant - ${scenario.providerLabel} - ${scenario.languageLabel} - ${Date.now()}`,
        );

        const questions = Object.values(scenario.questionBank);
        const questionRecords: QuestionRecord[] = [];

        const virtualMicrophone = new VirtualMicrophone(page, {
          speechStartDelayMs: 1500,
          voice: scenario.voice,
        });
        const flow = new InterviewFlowActions({ page, virtualMicrophone });
        const lmStudio = new LmStudioApi(page);

        await virtualMicrophone.install();
        await page.goto(interviewUrl);

        await test.step("Complete interview setup", async () => {
          await flow.enterSetup(applicantName);
          await flow.completeMediaSetup({ toneMs: 7000 });
          await flow.completeSampleQuestionWithTone();
          await flow.startInterview();
        });

        // Question 1: submit lead-up, submit deep-dive
        await answerLeadUpQuestion(
          page,
          0,
          questions[0],
          flow,
          virtualMicrophone,
        );
        questionRecords.push({
          question: questions[0].question,
          answer: questions[0].answer,
          isDeepDive: false,
        });
        await handleDeepDiveLoop(
          page,
          0,
          "submit",
          "submit",
          scenario.language,
          lmStudio,
          virtualMicrophone,
          flow,
          scenario.closingRemark,
          questionRecords,
        );

        // Question 2: timeout lead-up, submit deep-dive
        await answerLeadUpQuestion(
          page,
          1,
          questions[1],
          flow,
          virtualMicrophone,
          { interviewerAudioAlreadyFinished: true },
        );
        questionRecords.push({
          question: questions[1].question,
          answer: questions[1].answer,
          isDeepDive: false,
        });
        await handleDeepDiveLoop(
          page,
          1,
          "timeout",
          "submit",
          scenario.language,
          lmStudio,
          virtualMicrophone,
          flow,
          scenario.closingRemark,
          questionRecords,
        );

        // Question 3: submit lead-up, timeout deep-dive
        await answerLeadUpQuestion(
          page,
          2,
          questions[2],
          flow,
          virtualMicrophone,
          { interviewerAudioAlreadyFinished: true },
        );
        questionRecords.push({
          question: questions[2].question,
          answer: questions[2].answer,
          isDeepDive: false,
        });
        await handleDeepDiveLoop(
          page,
          2,
          "submit",
          "timeout",
          scenario.language,
          lmStudio,
          virtualMicrophone,
          flow,
          scenario.closingRemark,
          questionRecords,
        );

        // Verify interview complete
        await test.step("Verify interview completed", async () => {
          await expect(
            page.getByText(/The interview is now complete|面接が完了しました/i),
          ).toBeVisible({ timeout: 30000 });
        });

        // Verify report and transcripts
        await verifyReport(pageAdmin, seededEmail, questionRecords, scenario);
      });
    });
  }
});
