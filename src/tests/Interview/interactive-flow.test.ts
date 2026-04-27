import { LmStudioApi } from "@src/api/lm-studio-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { InterviewFlowActions } from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import {
  answerLeadUpQuestion,
  handleDeepDiveLoop,
  type DeepDiveLoopResult,
  type InteractiveFlowQuestionRecord,
  verifyInteractiveFlowReport,
} from "@src/utils/interactive-flow-helpers";
import {
  VirtualMicrophone,
} from "@src/utils/virtual-microphone";

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
    closingRemark: "Let's move on",
  },
  {
    language: "en",
    languageLabel: "English",
    providerLabel: "ElevenLabs",
    sttProvider: "elevenlabs",
    questionBank: questionBankByLanguage.en,
    voice: "Samantha",
    closingRemark: "Let's move on",
  },
];

// ============================================================
// Constants
// ============================================================

const totalLeadUpQuestions = 3;
const japaneseCharacterPattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
const latinLetterPattern = /[A-Za-z]/g;
const englishTopicCloserPhrases = [
  "lets move on to the next question",
  "lets move on",
];

const countPatternMatches = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;

const normalizeTopicCloserText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const expectTextToMatchLanguage = (
  text: string,
  language: InterviewLanguage,
  label: string,
): void => {
  const japaneseCharacters = countPatternMatches(text, japaneseCharacterPattern);
  const latinLetters = countPatternMatches(text, latinLetterPattern);
  const latinShare =
    latinLetters / Math.max(japaneseCharacters + latinLetters, 1);

  if (language === "en") {
    expect(
      japaneseCharacters,
      `${label} should not contain Japanese characters`,
    ).toBe(0);
    expect(latinLetters, `${label} should contain English letters`).toBeGreaterThan(
      0,
    );
    return;
  }

  expect(
    japaneseCharacters,
    `${label} should contain Japanese characters`,
  ).toBeGreaterThan(0);
  expect(
    latinShare,
    `${label} should stay predominantly in Japanese`,
  ).toBeLessThan(0.2);
};

const expectTopicCloserToMatchLanguage = (
  text: string,
  language: InterviewLanguage,
): void => {
  const normalizedCloser = normalizeTopicCloserText(text);

  if (language === "en") {
    expectTextToMatchLanguage(text, language, `Topic closer "${text}"`);
    expect(
      englishTopicCloserPhrases.includes(normalizedCloser),
      `English topic closer "${text}" should include one of: ${englishTopicCloserPhrases.join(
        ", ",
      )}`,
    ).toBe(true);
    return;
  }

  expectTextToMatchLanguage(text, language, `Topic closer "${text}"`);
  expect(
    englishTopicCloserPhrases.some((phrase) =>
      normalizedCloser.includes(phrase),
    ),
    `Japanese topic closer "${text}" should not include English closer phrases`,
  ).toBe(false);
};

// ============================================================
// Tests
// ============================================================

test.describe("Interview Flow - Interactive with Deep Dives @interview", () => {
  for (const scenario of interactiveFlowScenarios) {
    test.describe(`${scenario.languageLabel} - ${scenario.providerLabel}`, () => {
      let interviewSessionId: number;
      let interviewUrl: string;

      test.beforeEach(async ({ freshApiAdmin: apiAdmin, interviewCompanyIds }) => {
        const timestamp = Date.now();
        const seededEmail = `product-dev_qa+ai+interactive+${scenario.language}+${scenario.sttProvider}+${timestamp}@givery.co.jp`;
        const companyId = interviewCompanyIds[scenario.sttProvider];

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
        interviewSessionId = interview.interviewSessionId;
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
        const questionRecords: InteractiveFlowQuestionRecord[] = [];
        const deepDiveLoopResults: DeepDiveLoopResult[] = [];

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
        await test.step("Lead-up question 1: answer", async () => {
          await answerLeadUpQuestion({
            flow,
            page,
            questionData: questions[0],
            questionIndex: 0,
            totalLeadUpQuestions,
            virtualMicrophone,
          });
        });
        questionRecords.push({
          question: questions[0].question,
          answer: questions[0].answer,
          isDeepDive: false,
        });
        await test.step("Deep dive loop for lead-up question 1", async () => {
          deepDiveLoopResults.push(await handleDeepDiveLoop({
            closingRemark: scenario.closingRemark,
            deepDiveAdvanceMethod: "submit",
            flow,
            interviewLanguage: scenario.language,
            leadUpAdvanceMethod: "submit",
            leadUpQuestionIndex: 0,
            lmStudio,
            page,
            questionRecords,
            totalLeadUpQuestions,
            virtualMicrophone,
          }));
        });

        // Question 2: timeout lead-up, submit deep-dive
        await test.step("Lead-up question 2: answer", async () => {
          await answerLeadUpQuestion({
            flow,
            interviewerAudioAlreadyFinished: true,
            page,
            questionData: questions[1],
            questionIndex: 1,
            totalLeadUpQuestions,
            virtualMicrophone,
          });
        });
        questionRecords.push({
          question: questions[1].question,
          answer: questions[1].answer,
          isDeepDive: false,
        });
        await test.step("Deep dive loop for lead-up question 2", async () => {
          deepDiveLoopResults.push(await handleDeepDiveLoop({
            closingRemark: scenario.closingRemark,
            deepDiveAdvanceMethod: "submit",
            flow,
            interviewLanguage: scenario.language,
            leadUpAdvanceMethod: "timeout",
            leadUpQuestionIndex: 1,
            lmStudio,
            page,
            questionRecords,
            totalLeadUpQuestions,
            virtualMicrophone,
          }));
        });

        // Question 3: submit lead-up, timeout deep-dive
        await test.step("Lead-up question 3: answer", async () => {
          await answerLeadUpQuestion({
            flow,
            interviewerAudioAlreadyFinished: true,
            page,
            questionData: questions[2],
            questionIndex: 2,
            totalLeadUpQuestions,
            virtualMicrophone,
          });
        });
        questionRecords.push({
          question: questions[2].question,
          answer: questions[2].answer,
          isDeepDive: false,
        });
        await test.step("Deep dive loop for lead-up question 3", async () => {
          deepDiveLoopResults.push(await handleDeepDiveLoop({
            closingRemark: scenario.closingRemark,
            deepDiveAdvanceMethod: "timeout",
            flow,
            interviewLanguage: scenario.language,
            leadUpAdvanceMethod: "submit",
            leadUpQuestionIndex: 2,
            lmStudio,
            page,
            questionRecords,
            totalLeadUpQuestions,
            virtualMicrophone,
          }));
        });

        await test.step("Verify deep dive and topic closer language", async () => {
          const deepDiveQuestions = questionRecords
            .filter((record) => record.isDeepDive)
            .map((record) => record.question);
          const closerTexts = deepDiveLoopResults
            .map((result) => result.closingRemarkText)
            .filter((text): text is string => Boolean(text));

          expect(deepDiveQuestions.length).toBeGreaterThan(0);

          for (const deepDiveQuestion of deepDiveQuestions) {
            expectTextToMatchLanguage(
              deepDiveQuestion,
              scenario.language,
              `Deep dive question "${deepDiveQuestion}"`,
            );
          }

          expect(
            deepDiveLoopResults.slice(0, -1).every((result) => result.sawClosingRemark),
            "Every non-final topic should end with a closer",
          ).toBe(true);
          expect(closerTexts.length).toBeGreaterThanOrEqual(
            totalLeadUpQuestions - 1,
          );

          for (const closerText of closerTexts) {
            expectTopicCloserToMatchLanguage(closerText, scenario.language);
          }
        });

        // Verify interview complete
        await test.step("Verify interview completed", async () => {
          await expect(
            page.getByText(/The interview is now complete|面接が完了しました/i),
          ).toBeVisible({ timeout: 30000 });
        });

        // Verify report and transcripts
        await test.step("Verify report and transcripts", async () => {
          await verifyInteractiveFlowReport({
            interviewSessionId,
            pageAdmin,
            questionRecords,
            scenarioLabel: `${scenario.languageLabel} with ${scenario.providerLabel}`,
          });
        });
      });
    });
  }
});
