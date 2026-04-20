import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { Home } from "@src/pages/home.page";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import { ReportPage } from "@src/pages/report.page";
import {
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

type QuestionBank = Record<
  string,
  {
    answer: string;
    question: string;
  }
>;

type LanguageScenario = {
  language: InterviewLanguage;
  languageLabel: string;
  questionBank: QuestionBank;
  sampleAnswer: string;
  ttsVoice: string;
};

type SttProviderScenario = {
  providerLabel: string;
  sttProvider: SttProvider;
};

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
  },
} satisfies Record<InterviewLanguage, QuestionBank>;

const languageScenarios = [
  {
    language: "en",
    languageLabel: "English",
    questionBank: questionBankByLanguage.en,
    sampleAnswer: "My favorite food is curry.",
    ttsVoice: "Samantha",
  },
  {
    language: "ja",
    languageLabel: "Japanese",
    questionBank: questionBankByLanguage.ja,
    sampleAnswer: "私の好きな食べ物はカレーです。",
    ttsVoice: "Kyoko",
  },
] satisfies LanguageScenario[];

const sttProviderScenarios = [
  {
    providerLabel: "OpenAI",
    sttProvider: "openai",
  },
  {
    providerLabel: "ElevenLabs",
    sttProvider: "elevenlabs",
  },
] satisfies SttProviderScenario[];

const interviewFlowScenarios = languageScenarios.flatMap((languageScenario) =>
  sttProviderScenarios.map((sttProviderScenario) => ({
    ...languageScenario,
    ...sttProviderScenario,
  })),
);

test.describe("Interview Flow - Non-interactive", () => {
  for (const scenario of interviewFlowScenarios) {
    test.describe(`${scenario.languageLabel} - ${scenario.providerLabel}`, () => {
      let seededEmail: string;
      let interviewUrl: string;

      test.beforeEach(async ({ apiAdmin }) => {
        seededEmail = `product-dev_qa+ai+nonint+${scenario.language}+${scenario.sttProvider}+${Date.now()}@givery.co.jp`;

        const companyResp = await apiAdmin.createCompany({
          company_name: `E2E Non-interactive ${scenario.providerLabel} ${scenario.languageLabel} ${Date.now()}`,
          stt_provider: scenario.sttProvider,
        });
        const { company_id: companyId } = await companyResp.json();

        const interviewBuilder = new InterviewBuilder(apiAdmin)
          .forCompany(companyId)
          .sendTo(seededEmail)
          .name(
            `E2E Non-interactive ${scenario.providerLabel} ${scenario.languageLabel} ${Date.now()}`,
          )
          .description(
            `E2E test for non-interactive ${scenario.languageLabel} interview flow using ${scenario.providerLabel}`,
          )
          .language(scenario.language)
          .version(2)
          .linkMaxUses(1);

        for (const { question } of Object.values(scenario.questionBank)) {
          interviewBuilder.withQuestion((questionBuilder) =>
            questionBuilder
              .transcript(question)
              .category("general")
              .language(scenario.language)
              .timeLimit(60),
          );
        }

        const interview = await interviewBuilder.build();
        interviewUrl = interview.interviewUrl;
      });

      test(`User should be able to take a non-interactive interview flow in ${scenario.languageLabel} with ${scenario.providerLabel}`, async ({
        page,
        pageAdmin,
      }, testInfo) => {
        test.setTimeout(600000);

        const applicantName = withBrowserApplicantPrefix(
          testInfo,
          `Non-interactive applicant - ${scenario.providerLabel} - ${scenario.languageLabel} - ${Date.now()}`,
        );
        const interviewQuestions = Object.values(scenario.questionBank);
        const questionCount = interviewQuestions.length;
        const interviewQuestionCases = interviewQuestions.map(
          ({ answer, question }, questionIndex) => ({
            answerAudioBase64: createSpeechAudioBase64(answer, {
              voice: scenario.ttsVoice,
            }),
            question,
            questionIndex,
          }),
        );
        const intermediateInterviewQuestionCases = interviewQuestionCases.slice(
          0,
          -1,
        );
        const finalInterviewQuestionCase =
          interviewQuestionCases[questionCount - 1];
        const virtualMicrophone = new VirtualMicrophone(page, {
          speechStartDelayMs: 1500,
          voice: scenario.ttsVoice,
        });
        const flow = new InterviewFlowActions({ page, virtualMicrophone });

        await virtualMicrophone.install();

        await page.goto(interviewUrl);

        await test.step("The applicant should be able to take the entry steps", async () => {
          await flow.enterSetup(applicantName);
        });

        await test.step("The applicant should be able to finish the media setup", async () => {
          await flow.completeMediaSetup({ toneMs: 7000 });
        });

        await test.step("The microphone and camera test should start", async () => {
          await flow.completeSampleQuestionWithTone();
          await expect(page).not.toHaveURL(/sample-exam/);
        });

        await test.step("The applicant should be able to start the interview", async () => {
          await flow.startInterview();
        });

        const answerInterviewQuestion = async ({
          answerAudioBase64,
          question,
          questionIndex,
        }: (typeof interviewQuestionCases)[number]) => {
          const interviewQuestionPage = new InterviewQuestionPage(page);

          await expect(interviewQuestionPage.interviewerPreview).toBeVisible();
          await expect(
            interviewQuestionPage.intervieweeVideoFeedback,
          ).toBeVisible();
          await expect
            .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
              timeout: 10000,
            })
            .toBe(true);
          await expect(interviewQuestionPage.questionCount).toHaveText(
            `${questionIndex}/${questionCount}`,
          );
          await expect(interviewQuestionPage.questionText).toContainText(
            question,
          );
          await flow.waitForInterviewerAudioToStart();

          const initialRemainingTime =
            await interviewQuestionPage.remainingTime.innerText();

          await virtualMicrophone.playAudioBase64(answerAudioBase64);

          await expect
            .poll(() => interviewQuestionPage.remainingTime.innerText(), {
              timeout: 30000,
            })
            .not.toBe(initialRemainingTime);

          const updatedRemainingTime =
            await interviewQuestionPage.remainingTime.innerText();

          expect(timeToSeconds(updatedRemainingTime)).toBeLessThan(
            timeToSeconds(initialRemainingTime),
          );
          await expect(interviewQuestionPage.submitAnswerBtn).toBeEnabled();

          return interviewQuestionPage;
        };

        for (const questionCase of intermediateInterviewQuestionCases) {
          await test.step(`The applicant should be able to answer interview question ${
            questionCase.questionIndex + 1
          }`, async () => {
            const interviewQuestionPage =
              await answerInterviewQuestion(questionCase);

            await flow.submitCurrentQuestion();
            await expect(interviewQuestionPage.questionCount).toHaveText(
              `${questionCase.questionIndex + 1}/${questionCount}`,
              { timeout: 15000 },
            );
          });
        }

        await test.step(`The applicant should be able to answer interview question ${
          finalInterviewQuestionCase.questionIndex + 1
        }`, async () => {
          await answerInterviewQuestion(finalInterviewQuestionCase);

          await flow.submitCurrentQuestion();
          await expect(
            page.getByText("The interview is now complete."),
          ).toBeVisible({
            timeout: 30000,
          });
        });

        await test.step(`The Admin should be able to verify the transcription for the flow in ${scenario.languageLabel} with ${scenario.providerLabel}`, async () => {
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
          await expect(async () => {
            await reportTab.reload({ waitUntil: "domcontentloaded" });
            await expect(
              reportPage.page
                .locator("main")
                .getByText(reportGenerationErrorPattern),
            ).toHaveCount(0);
            await expect(reportPage.examLogHeading).toBeVisible({
              timeout: 10000,
            });
            await expect(reportPage.recordingVideo).toBeVisible();
          }).toPass({
            intervals: [15000, 30000, 60000],
            timeout: 420000,
          });
          await expect(reportPage.recordingQuestionButtons).toHaveCount(
            questionCount,
          );

          await reportPage.openTranscript();
          await expect(reportPage.transcriptPanel).toBeVisible();
          await expect(
            reportPage.examLogSection.getByText(transcriptionErrorPattern),
          ).toHaveCount(0);
          await expect
            .poll(
              async () =>
                (await reportPage.getCandidateTranscriptTexts()).length,
              {
                timeout: 60000,
              },
            )
            .toBeGreaterThanOrEqual(questionCount);

          const transcriptTexts =
            await reportPage.getCandidateTranscriptTexts();

          for (const transcriptText of transcriptTexts) {
            expect(
              normalizeForTranscriptionComparison(transcriptText).length,
            ).toBeGreaterThan(0);
            expect(transcriptText).not.toMatch(transcriptionErrorPattern);
          }

          for (const { answer, questionIndex } of interviewQuestions.map(
            ({ answer }, questionIndex) => ({ answer, questionIndex }),
          )) {
            const bestTranscriptSimilarity = Math.max(
              ...transcriptTexts.map((transcriptText) =>
                calculateTranscriptionSimilarity(answer, transcriptText),
              ),
            );

            expect(
              bestTranscriptSimilarity,
              `Question ${questionIndex + 1} transcript should be at least 70% similar to the submitted answer`,
            ).toBeGreaterThanOrEqual(0.6);
          }

          await reportPage.selectRecordingQuestion(1);
          await expect
            .poll(() => reportPage.isRecordingReady(), { timeout: 30000 })
            .toBe(true);

          const initialRecordingTime =
            await reportPage.getRecordingCurrentTime();

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
      });
    });
  }
});
