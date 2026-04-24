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

type MixedCustomPromptQuestion = {
  answer: string;
  deepDiveCount: number;
  question: string;
};

type MixedCustomPromptScenario = {
  closingRemark: string;
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  questions: MixedCustomPromptQuestion[];
  sttProvider: SttProvider;
  voice: string;
};

type MixedPromptIds = {
  firstQuestionPromptId: number;
  flowPromptId: number;
  thirdQuestionPromptId: number;
};

type SeededMixedPromptInterview = {
  interviewUrl: string;
  promptIds: MixedPromptIds;
};

const flowPromptTag = "[FLOW MIXED CUSTOM PROMPT]";
const firstQuestionPromptTag = "[MIXED QUESTION ONE CUSTOM PROMPT]";
const thirdQuestionPromptTag = "[MIXED QUESTION THREE CUSTOM PROMPT]";
const expectedFlowTaggedDeepDiveMinimum = 1;
const expectedQuestionTaggedDeepDiveMinimum = 1;
const totalLeadUpQuestions = 3;
const mixedPromptTestTimeoutMs = 1200000;
const visibleInterviewErrorPattern =
  /Audio playback failed|Audio initialization failed|Media Stream Error|Camera\/Microphone Error|An unexpected error occurred/i;

const mixedPromptScenarios = [
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
      },
    ],
    sttProvider: "openai",
    voice: "Samantha",
  },
] satisfies MixedCustomPromptScenario[];

const buildFlowPrompt = (): string =>
  [
    "あなたは採用面接の深掘り質問を作成する面接官です。",
    "候補者の回答をもとに、面接フローの言語と同じ言語で自然な深掘り質問を作成してください。",
    `絶対条件: 全ての深掘り質問には、必ず ${flowPromptTag} をそのまま含めてください。`,
    `深掘り質問の形式は必ず「${flowPromptTag} 質問文 ${flowPromptTag}」にしてください。`,
    "質問単位のプロンプトで別のタグが指定されている場合は、そのタグも必ず維持してください。",
    `${flowPromptTag} がない深掘り質問を出力してはいけません。`,
    "クロージングの案内文にはこのタグを付けないでください。",
  ].join("\n");

const buildQuestionPrompt = (promptTag: string): string =>
  [
    "あなたは採用面接の深掘り質問を作成する面接官です。",
    "候補者の回答をもとに、面接フローの言語と同じ言語で自然な深掘り質問を作成してください。",
    `フロー全体のプロンプトで ${flowPromptTag} が指定されている場合は、必ずそのタグを維持してください。`,
    `この質問用プロンプトは ${flowPromptTag} を置き換えるものではありません。${flowPromptTag} に加えて ${promptTag} を追加してください。`,
    `絶対条件: この質問に対する全ての深掘り質問には、必ず ${promptTag} をそのまま含めてください。`,
    `推奨形式は「${flowPromptTag} ${promptTag} 質問文 ${promptTag} ${flowPromptTag}」です。`,
    `${promptTag} がない深掘り質問を出力してはいけません。`,
    "クロージングの案内文にはこのタグを付けないでください。",
  ].join("\n");

const createFlowPrompt = async (
  apiAdmin: ReportingApi,
  timestamp: number,
): Promise<number> => {
  const promptResp = await apiAdmin.createCustomSystemPrompt({
    name: `E2E Mixed Flow Prompt ${timestamp}`,
    description: "E2E mixed flow-level prompt marker",
    system_prompt: buildFlowPrompt(),
  });

  await expect(promptResp).toBeOK();

  const promptBody = (await promptResp.json()) as {
    interactive_interview_custom_system_prompt_id: number;
  };

  return promptBody.interactive_interview_custom_system_prompt_id;
};

const createQuestionPrompt = async (
  apiAdmin: ReportingApi,
  promptTag: string,
  timestamp: number,
): Promise<number> => {
  const promptResp = await apiAdmin.createQuestionCustomSystemPrompt({
    name: `E2E Mixed Question Prompt ${promptTag} ${timestamp}`,
    description: `E2E mixed question marker ${promptTag}`,
    system_prompt: buildQuestionPrompt(promptTag),
  });

  await expect(promptResp).toBeOK();

  const promptBody = (await promptResp.json()) as {
    interactive_interview_question_custom_system_prompt_id: number;
  };

  return promptBody.interactive_interview_question_custom_system_prompt_id;
};

const createMixedPromptIds = async (
  apiAdmin: ReportingApi,
  timestamp: number,
): Promise<MixedPromptIds> => {
  const flowPromptId = await createFlowPrompt(apiAdmin, timestamp);
  const firstQuestionPromptId = await createQuestionPrompt(
    apiAdmin,
    firstQuestionPromptTag,
    timestamp,
  );
  const thirdQuestionPromptId = await createQuestionPrompt(
    apiAdmin,
    thirdQuestionPromptTag,
    timestamp,
  );

  return { firstQuestionPromptId, flowPromptId, thirdQuestionPromptId };
};

const patchQuestionPrompt = async (
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

const seedMixedPromptInterview = async (
  apiAdmin: ReportingApi,
  companyId: number,
  scenario: MixedCustomPromptScenario,
): Promise<SeededMixedPromptInterview> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+interactive+mixed-prompts+${scenario.language}+${timestamp}@givery.co.jp`;
  const promptIds = await createMixedPromptIds(apiAdmin, timestamp);

  const interviewBuilder = new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Interactive Mixed Prompts ${scenario.providerLabel} ${scenario.languageLabel} ${timestamp}`,
    )
    .description("E2E interactive mixed custom prompt check")
    .language(scenario.language)
    .version(2)
    .interactive(true)
    .customPrompt(promptIds.flowPromptId)
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

  await patchQuestionPrompt(
    apiAdmin,
    interview.interviewFlowId,
    interview.questionIds[0],
    promptIds.firstQuestionPromptId,
  );
  await patchQuestionPrompt(
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
  question: MixedCustomPromptQuestion,
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

const expectTagPresence = ({
  minimumMatchCount,
  questions,
  tag,
}: {
  minimumMatchCount: number;
  questions: string[];
  tag: string;
}): void => {
  const questionList = questions.join("\n\n");
  const matchCount = questions.filter((question) => question.includes(tag))
    .length;

  expect(
    matchCount,
    `Expected at least ${minimumMatchCount} deep dives to include ${tag}. Questions:\n${questionList}`,
  ).toBeGreaterThanOrEqual(minimumMatchCount);
};

const expectTagAbsence = ({
  questions,
  tag,
}: {
  questions: string[];
  tag: string;
}): void => {
  const questionList = questions.join("\n\n");
  const matchCount = questions.filter((question) => question.includes(tag))
    .length;

  expect(
    matchCount,
    `Expected no deep dives to include ${tag}. Questions:\n${questionList}`,
  ).toBe(0);
};

const expectMixedPromptMarkers = ({
  expectedQuestionTag,
  forbiddenQuestionTag,
  questions,
}: {
  expectedQuestionTag: string;
  forbiddenQuestionTag: string;
  questions: string[];
}): void => {
  // Mixed prompts can surface either marker per deep dive, but both prompt layers must be represented.
  expect(questions).toHaveLength(3);
  expectTagPresence({
    minimumMatchCount: expectedFlowTaggedDeepDiveMinimum,
    questions,
    tag: flowPromptTag,
  });
  expectTagPresence({
    minimumMatchCount: expectedQuestionTaggedDeepDiveMinimum,
    questions,
    tag: expectedQuestionTag,
  });
  expectTagAbsence({
    questions,
    tag: forbiddenQuestionTag,
  });
};

const expectNoVisibleInterviewErrors = async (page: Page): Promise<void> => {
  await expect(
    page.locator("main").getByText(visibleInterviewErrorPattern),
  ).toHaveCount(0);
};

test.describe("Interview Flow - Interactive mixed custom prompts @interview", () => {
  for (const scenario of mixedPromptScenarios) {
    test(`Flow and question prompts should both be represented in ${scenario.languageLabel}`, async ({
      freshApiAdmin: apiAdmin,
      interviewCompanyIds,
      page,
    }, testInfo) => {
      test.setTimeout(mixedPromptTestTimeoutMs);

      const seededInterview = await seedMixedPromptInterview(
        apiAdmin,
        interviewCompanyIds[scenario.sttProvider],
        scenario,
      );
      const applicantName = withBrowserApplicantPrefix(
        testInfo,
        `Interactive Mixed Prompt applicant - ${scenario.providerLabel} - ${scenario.languageLabel} - ${seededInterview.promptIds.flowPromptId} - ${Date.now()}`,
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

      await test.step("Question 1 should include the flow marker and its question marker", async () => {
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
        expectMixedPromptMarkers({
          expectedQuestionTag: firstQuestionPromptTag,
          forbiddenQuestionTag: thirdQuestionPromptTag,
          questions: getDeepDiveQuestionsSince(
            questionRecords,
            firstDeepDiveStartIndex,
          ),
        });
      });

      await test.step("Question 2 should advance without deep dives", async () => {
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

      await test.step("Question 3 should include the flow marker and its question marker", async () => {
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
        expectMixedPromptMarkers({
          expectedQuestionTag: thirdQuestionPromptTag,
          forbiddenQuestionTag: firstQuestionPromptTag,
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
