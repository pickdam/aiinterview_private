import type { Page } from "@playwright/test";
import { LmStudioApi } from "@src/api/lm-studio-api";
import type { ReportingApi } from "@src/api/reporting-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { InterviewQuestionPage } from "@src/pages/interview-question.page";
import { InterviewFlowActions } from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import {
  answerLeadUpQuestion,
  handleDeepDiveLoop,
  type InteractiveFlowQuestionRecord,
} from "@src/utils/interactive-flow-helpers";
import { VirtualMicrophone } from "@src/utils/virtual-microphone";

type QuestionLevelPromptQuestion = {
  answer: string;
  deepDiveCount: number;
  promptTag?: string;
  question: string;
};

type QuestionLevelPromptScenario = {
  closingRemark: string;
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: QuestionLevelPromptQuestion[];
  sttProvider: SttProvider;
  voice: string;
};

type QuestionLevelPromptIds = {
  firstQuestionPromptId: number;
  thirdQuestionPromptId: number;
};

type SeededQuestionLevelPromptInterview = {
  interviewUrl: string;
  promptIds: QuestionLevelPromptIds;
};

const firstQuestionPromptTag = "[QUESTION ONE CUSTOM PROMPT]";
const thirdQuestionPromptTag = "[QUESTION THREE CUSTOM PROMPT]";
const totalLeadUpQuestions = 3;
const questionLevelPromptTestTimeoutMs = 1200000;
const expectedTaggedDeepDiveMinimum = 2;
const visibleInterviewErrorPattern =
  /Audio playback failed|Audio initialization failed|Media Stream Error|Camera\/Microphone Error|An unexpected error occurred/i;

const questionLevelPromptScenarios = [
  {
    closingRemark: "次に進みます",
    language: "ja",
    languageLabel: "Japanese",
    providerLabel: "OpenAI",
    questions: [
      {
        question: "あなたの強みについて教えてください。",
        answer:
          "私の強みは、複雑な課題を整理して着実に進められることです。状況を分解し、優先順位を決め、周囲と確認しながら最後まで責任を持って対応します。",
        deepDiveCount: 3,
        promptTag: firstQuestionPromptTag,
      },
      {
        question: "これまでの職務経歴について教えてください。",
        answer:
          "これまで主にIT業界で経験を積みました。社内システムの運用サポート、データ管理、プロジェクト進行管理、関係部署との調整を担当しました。",
        deepDiveCount: 0,
      },
      {
        question: "チームで協力した経験について教えてください。",
        answer:
          "部署をまたぐ改善活動で、現場の要望と運用側の制約を整理しました。双方に確認しながら手順を調整し、使いやすい運用に改善しました。",
        deepDiveCount: 3,
        promptTag: thirdQuestionPromptTag,
      },
    ],
    sttProvider: "openai",
    voice: "Kyoko",
  },
  {
    closingRemark: "We'll move to the next question.",
    language: "en",
    languageLabel: "English",
    providerLabel: "OpenAI",
    questions: [
      {
        question: "Tell me about your strengths.",
        answer:
          "My strength is organizing complex problems and moving through them steadily. I break the situation into smaller parts, set priorities, confirm expectations with the people around me, and take responsibility for finishing the work.",
        deepDiveCount: 3,
        promptTag: firstQuestionPromptTag,
      },
      {
        question: "Tell me about your work history.",
        answer:
          "I have mainly built my experience in the IT industry. I started with internal system operations and data management, then moved into project coordination and communication across teams.",
        deepDiveCount: 0,
      },
      {
        question: "Tell me about a time you worked with a team.",
        answer:
          "In one cross-team improvement project, I organized requests from the business side and constraints from operations. I confirmed both sides carefully and helped adjust the process into something easier to use.",
        deepDiveCount: 3,
        promptTag: thirdQuestionPromptTag,
      },
    ],
    sttProvider: "openai",
    voice: "Samantha",
  },
] satisfies QuestionLevelPromptScenario[];

const buildQuestionPrompt = (promptTag: string): string =>
  [
    "あなたは採用面接の深掘り質問を作成する面接官です。",
    "候補者の回答をもとに、面接フローの言語と同じ言語で自然な深掘り質問を作成してください。",
    `絶対条件: この質問に対する全ての深掘り質問には、必ず ${promptTag} をそのまま含めてください。`,
    `深掘り質問の形式は必ず「${promptTag} 質問文 ${promptTag}」にしてください。`,
    `${promptTag} がない深掘り質問を出力してはいけません。`,
    "クロージングの案内文にはこのタグを付けないでください。",
  ].join("\n");

const createQuestionLevelPrompt = async (
  apiAdmin: ReportingApi,
  promptTag: string,
  timestamp: number,
): Promise<number> => {
  const promptResp = await apiAdmin.createQuestionCustomSystemPrompt({
    name: `E2E Question Prompt ${promptTag} ${timestamp}`,
    description: `E2E marker prompt ${promptTag}`,
    system_prompt: buildQuestionPrompt(promptTag),
  });

  await expect(promptResp).toBeOK();

  const promptBody = (await promptResp.json()) as {
    interactive_interview_question_custom_system_prompt_id: number;
  };

  return promptBody.interactive_interview_question_custom_system_prompt_id;
};

const createQuestionLevelPrompts = async (
  apiAdmin: ReportingApi,
  timestamp: number,
): Promise<QuestionLevelPromptIds> => {
  const firstQuestionPromptId = await createQuestionLevelPrompt(
    apiAdmin,
    firstQuestionPromptTag,
    timestamp,
  );
  const thirdQuestionPromptId = await createQuestionLevelPrompt(
    apiAdmin,
    thirdQuestionPromptTag,
    timestamp,
  );

  return { firstQuestionPromptId, thirdQuestionPromptId };
};

const patchQuestionLevelPrompt = async (
  apiAdmin: ReportingApi,
  interviewFlowId: number,
  questionId: number,
  promptId: number,
): Promise<void> => {
  const promptResp =
    await apiAdmin.updateInteractiveInterviewQuestionCustomSystemPrompt(
      interviewFlowId,
      questionId,
      {
        interactive_interview_question_custom_system_prompt_id: promptId,
      },
    );

  await expect(promptResp).toBeOK();
};

const seedQuestionLevelPromptInterview = async (
  apiAdmin: ReportingApi,
  companyId: number,
  scenario: QuestionLevelPromptScenario,
): Promise<SeededQuestionLevelPromptInterview> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+interactive+question-prompt+${scenario.language}+${timestamp}@givery.co.jp`;
  const promptIds = await createQuestionLevelPrompts(apiAdmin, timestamp);

  const interviewBuilder = new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Interactive Question Prompt ${scenario.providerLabel} ${scenario.languageLabel} ${timestamp}`,
    )
    .description("E2E interactive question-level custom prompt check")
    .language(scenario.language)
    .version(2)
    .interactive(true)
    .linkMaxUses(1);
  const questionPromptIds = [
    promptIds.firstQuestionPromptId,
    null,
    promptIds.thirdQuestionPromptId,
  ];

  for (const [questionIndex, question] of scenario.questions.entries()) {
    interviewBuilder.withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(question.question)
        .category("general")
        .language(scenario.language)
        .timeLimit(60)
        .deepDives(question.deepDiveCount, question.deepDiveCount)
        .customSystemPrompt(questionPromptIds[questionIndex]),
    );
  }

  const interview = await interviewBuilder.build();

  await patchQuestionLevelPrompt(
    apiAdmin,
    interview.interviewFlowId,
    interview.questionIds[0],
    promptIds.firstQuestionPromptId,
  );
  await patchQuestionLevelPrompt(
    apiAdmin,
    interview.interviewFlowId,
    interview.questionIds[2],
    promptIds.thirdQuestionPromptId,
  );

  return {
    interviewUrl: interview.interviewUrl,
    promptIds,
  };
};

const recordLeadUpAnswer = (
  questionRecords: InteractiveFlowQuestionRecord[],
  question: QuestionLevelPromptQuestion,
): void => {
  questionRecords.push({
    question: question.question,
    answer: question.answer,
    isDeepDive: false,
  });
};

const getDeepDiveQuestionsSince = (
  questionRecords: InteractiveFlowQuestionRecord[],
  startIndex: number,
): string[] => {
  return questionRecords
    .slice(startIndex)
    .filter((questionRecord) => questionRecord.isDeepDive)
    .map((questionRecord) => questionRecord.question);
};

const expectDeepDivePromptMarkers = ({
  expectedPromptTag,
  forbiddenPromptTag,
  questions,
}: {
  expectedPromptTag: string;
  forbiddenPromptTag: string;
  questions: string[];
}): void => {
  const expectedTagMatches = questions.filter((question) =>
    question.includes(expectedPromptTag),
  );
  const forbiddenTagMatches = questions.filter((question) =>
    question.includes(forbiddenPromptTag),
  );
  const questionList = questions.join("\n\n");

  expect(questions).toHaveLength(3);
  expect(
    expectedTagMatches.length,
    `Expected at least ${expectedTaggedDeepDiveMinimum} deep dives to include ${expectedPromptTag}. Questions:\n${questionList}`,
  ).toBeGreaterThanOrEqual(expectedTaggedDeepDiveMinimum);
  expect(
    forbiddenTagMatches.length,
    `Expected no deep dives to include ${forbiddenPromptTag}. Questions:\n${questionList}`,
  ).toBe(0);
};

const expectNoVisibleInterviewErrors = async (page: Page): Promise<void> => {
  await expect(
    page.locator("main").getByText(visibleInterviewErrorPattern),
  ).toHaveCount(0);
};

test.describe("Interview Flow - Interactive question-level prompts @interview", () => {
  for (const scenario of questionLevelPromptScenarios) {
    test(`Question-level prompts should apply only to configured deep dives in ${scenario.languageLabel}`, async ({
      freshApiAdmin: apiAdmin,
      interviewCompanyIds,
      page,
    }, testInfo) => {
      test.setTimeout(questionLevelPromptTestTimeoutMs);

      const seededInterview = await seedQuestionLevelPromptInterview(
        apiAdmin,
        interviewCompanyIds[scenario.sttProvider],
        scenario,
      );
      const applicantName = withBrowserApplicantPrefix(
        testInfo,
        `Interactive Question Prompt applicant - ${scenario.providerLabel} - ${scenario.languageLabel} - ${seededInterview.promptIds.firstQuestionPromptId} - ${Date.now()}`,
      );
      const virtualMicrophone = new VirtualMicrophone(page, {
        speechStartDelayMs: 1500,
        voice: scenario.voice,
      });
      const flow = new InterviewFlowActions({ page, virtualMicrophone });
      const lmStudio = new LmStudioApi(page);
      const questionRecords: InteractiveFlowQuestionRecord[] = [];
      const [firstQuestion, secondQuestion, thirdQuestion] = scenario.questions;

      await virtualMicrophone.install();
      await page.goto(seededInterview.interviewUrl);

      await test.step("Complete interview setup", async () => {
        await flow.enterSetup(applicantName);
        await flow.completeMediaSetup({ toneMs: 7000 });
        await flow.completeSampleQuestionWithTone();
        await flow.startInterview();
      });

      await test.step("Question 1 should use its question-level prompt for deep dives", async () => {
        await answerLeadUpQuestion({
          flow,
          page,
          questionData: firstQuestion,
          questionIndex: 0,
          totalLeadUpQuestions,
          virtualMicrophone,
        });
        recordLeadUpAnswer(questionRecords, firstQuestion);

        const firstDeepDiveStartIndex = questionRecords.length;
        const deepDiveResult = await handleDeepDiveLoop({
          closingRemark: scenario.closingRemark,
          deepDiveAdvanceMethod: ["timeout", "submit", "submit"],
          flow,
          interviewLanguage: scenario.language,
          leadUpAdvanceMethod: "timeout",
          leadUpQuestionIndex: 0,
          lmStudio,
          page,
          questionRecords,
          totalLeadUpQuestions,
          virtualMicrophone,
        });

        expect(deepDiveResult.deepDiveCount).toBe(3);
        expect(deepDiveResult.sawClosingRemark).toBe(true);
        expectDeepDivePromptMarkers({
          expectedPromptTag: firstQuestionPromptTag,
          forbiddenPromptTag: thirdQuestionPromptTag,
          questions: getDeepDiveQuestionsSince(
            questionRecords,
            firstDeepDiveStartIndex,
          ),
        });
      });

      await test.step("Question 2 should advance without deep dives or custom prompt markers", async () => {
        const questionRecordStartIndex = questionRecords.length;

        await answerLeadUpQuestion({
          flow,
          interviewerAudioAlreadyFinished: true,
          page,
          questionData: secondQuestion,
          questionIndex: 1,
          totalLeadUpQuestions,
          virtualMicrophone,
        });
        recordLeadUpAnswer(questionRecords, secondQuestion);
        await flow.submitCurrentQuestion();

        const interviewQuestionPage = new InterviewQuestionPage(page);
        await expect(interviewQuestionPage.questionCount).toHaveText("2/3", {
          timeout: 30000,
        });
        await expect(interviewQuestionPage.questionText).toContainText(
          thirdQuestion.question,
          { timeout: 30000 },
        );
        await flow.waitForInterviewerAudioToFinish();

        expect(
          getDeepDiveQuestionsSince(questionRecords, questionRecordStartIndex),
        ).toHaveLength(0);
      });

      await test.step("Question 3 should use its own question-level prompt for deep dives", async () => {
        await answerLeadUpQuestion({
          flow,
          interviewerAudioAlreadyFinished: true,
          page,
          questionData: thirdQuestion,
          questionIndex: 2,
          totalLeadUpQuestions,
          virtualMicrophone,
        });
        recordLeadUpAnswer(questionRecords, thirdQuestion);

        const thirdDeepDiveStartIndex = questionRecords.length;
        const deepDiveResult = await handleDeepDiveLoop({
          closingRemark: scenario.closingRemark,
          deepDiveAdvanceMethod: "submit",
          flow,
          interviewLanguage: scenario.language,
          leadUpAdvanceMethod: "submit",
          leadUpQuestionIndex: 2,
          lmStudio,
          page,
          questionRecords,
          totalLeadUpQuestions,
          virtualMicrophone,
        });

        expect(deepDiveResult.deepDiveCount).toBe(3);
        expect(deepDiveResult.sawClosingRemark).toBe(true);
        expectDeepDivePromptMarkers({
          expectedPromptTag: thirdQuestionPromptTag,
          forbiddenPromptTag: firstQuestionPromptTag,
          questions: getDeepDiveQuestionsSince(
            questionRecords,
            thirdDeepDiveStartIndex,
          ),
        });
      });

      await test.step("Interview should finish without visible issues", async () => {
        await expect(
          page.getByText(/The interview is now complete|面接が完了しました/i),
        ).toBeVisible({ timeout: 30000 });
        await expectNoVisibleInterviewErrors(page);
      });
    });
  }
});
