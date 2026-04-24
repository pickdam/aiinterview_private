import { LmStudioApi } from "@src/api/lm-studio-api";
import type { ReportingApi } from "@src/api/reporting-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import { InterviewBuilder } from "@src/builders/interview-builder";
import { expect, test } from "@src/fixtures/fixtures";
import { InterviewFlowActions } from "@src/utils/interview-flow-actions";
import { withBrowserApplicantPrefix } from "@src/utils/browser-project";
import {
  answerLeadUpQuestion,
  handleDeepDiveLoop,
  type InteractiveFlowQuestionRecord,
} from "@src/utils/interactive-flow-helpers";
import { VirtualMicrophone } from "@src/utils/virtual-microphone";

type InteractiveCustomPromptScenario = {
  closingRemark: string;
  language: InterviewLanguage;
  languageLabel: string;
  providerLabel: string;
  question: {
    answer: string;
    question: string;
  };
  sttProvider: SttProvider;
  voice: string;
};

type SeededCustomPromptInterview = {
  interviewUrl: string;
  promptId: number;
};

const customPromptControlTag = "[FLOW CUSTOM PROMPT]";
const customPromptDeepDiveCount = 3;
const totalLeadUpQuestions = 1;
const customPromptTestTimeoutMs = 900000;

const customPromptSystemPrompt = [
  "あなたは採用面接の深掘り質問を作成する面接官です。",
  "候補者の回答をもとに、面接フローの言語と同じ言語で自然な深掘り質問を作成してください。",
  `深掘り質問を作成するときは、質問文の末尾に必ず ${customPromptControlTag} をそのまま追加してください。`,
  "クロージングの案内文にはこのタグを付けないでください。",
].join("\n");

const customPromptScenarios = [
  {
    closingRemark: "次に進みます",
    language: "ja",
    languageLabel: "Japanese",
    providerLabel: "OpenAI",
    question: {
      question: "あなたの強みについて教えてください。",
      answer:
        "私の強みは、複雑な課題を整理して着実に進められることです。状況を分解し、優先順位を決め、周囲と確認しながら最後まで責任を持って対応します。",
    },
    sttProvider: "openai",
    voice: "Kyoko",
  },
  {
    closingRemark: "We'll move to the next question.",
    language: "en",
    languageLabel: "English",
    providerLabel: "OpenAI",
    question: {
      question: "Tell me about your strengths.",
      answer:
        "My strength is organizing complex problems and moving through them steadily. I break the situation into smaller parts, set priorities, confirm expectations with the people around me, and take responsibility for finishing the work.",
    },
    sttProvider: "openai",
    voice: "Samantha",
  },
] satisfies InteractiveCustomPromptScenario[];

const expectedCustomPromptTagMatches = Array(customPromptDeepDiveCount).fill(
  true,
);

const createCustomSystemPrompt = async (
  apiAdmin: ReportingApi,
  timestamp: number,
): Promise<number> => {
  const promptResp = await apiAdmin.createCustomSystemPrompt({
    name: `E2E Custom Prompt ${timestamp}`,
    description: "E2E custom prompt marker for interactive deep dives",
    system_prompt: customPromptSystemPrompt,
  });

  await expect(promptResp).toBeOK();

  const promptBody = (await promptResp.json()) as {
    interactive_interview_custom_system_prompt_id: number;
  };

  return promptBody.interactive_interview_custom_system_prompt_id;
};

const seedInteractiveCustomPromptInterview = async (
  apiAdmin: ReportingApi,
  companyId: number,
  scenario: InteractiveCustomPromptScenario,
): Promise<SeededCustomPromptInterview> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+interactive+custom-prompt+${scenario.language}+${timestamp}@givery.co.jp`;
  const promptId = await createCustomSystemPrompt(apiAdmin, timestamp);

  const interview = await new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Interactive Custom Prompt ${scenario.providerLabel} ${scenario.languageLabel} ${timestamp}`,
    )
    .description("E2E interactive custom system prompt check")
    .language(scenario.language)
    .version(2)
    .interactive(true)
    .customPrompt(promptId)
    .linkMaxUses(1)
    .withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(scenario.question.question)
        .category("general")
        .language(scenario.language)
        .timeLimit(60)
        .deepDives(customPromptDeepDiveCount, customPromptDeepDiveCount),
    )
    .build();

  return {
    interviewUrl: interview.interviewUrl,
    promptId,
  };
};

const expectCustomPromptAppliedToDeepDives = (
  questionRecords: InteractiveFlowQuestionRecord[],
): void => {
  const deepDiveQuestions = questionRecords
    .filter((questionRecord) => questionRecord.isDeepDive)
    .map((questionRecord) => questionRecord.question);

  expect(deepDiveQuestions).toHaveLength(customPromptDeepDiveCount);
  expect(
    deepDiveQuestions.map((question) =>
      question.includes(customPromptControlTag),
    ),
  ).toEqual(expectedCustomPromptTagMatches);
};

test.describe("Interview Flow - Interactive custom system prompt @interview", () => {
  for (const scenario of customPromptScenarios) {
    test(`Custom system prompt should mark every deep dive in ${scenario.languageLabel}`, async ({
      freshApiAdmin: apiAdmin,
      interviewCompanyIds,
      page,
    }, testInfo) => {
      test.setTimeout(customPromptTestTimeoutMs);

      const seededInterview = await seedInteractiveCustomPromptInterview(
        apiAdmin,
        interviewCompanyIds[scenario.sttProvider],
        scenario,
      );
      const applicantName = withBrowserApplicantPrefix(
        testInfo,
        `Interactive Custom Prompt applicant - ${scenario.providerLabel} - ${scenario.languageLabel} - ${seededInterview.promptId} - ${Date.now()}`,
      );
      const virtualMicrophone = new VirtualMicrophone(page, {
        speechStartDelayMs: 1500,
        voice: scenario.voice,
      });
      const flow = new InterviewFlowActions({ page, virtualMicrophone });
      const lmStudio = new LmStudioApi(page);
      const questionRecords: InteractiveFlowQuestionRecord[] = [];

      await virtualMicrophone.install();
      await page.goto(seededInterview.interviewUrl);

      await test.step("Complete interview setup", async () => {
        await flow.enterSetup(applicantName);
        await flow.completeMediaSetup({ toneMs: 7000 });
        await flow.completeSampleQuestionWithTone();
        await flow.startInterview();
      });

      await test.step("Lead-up question should accept applicant answer", async () => {
        await answerLeadUpQuestion({
          flow,
          page,
          questionData: scenario.question,
          questionIndex: 0,
          totalLeadUpQuestions,
          virtualMicrophone,
        });
      });
      questionRecords.push({
        question: scenario.question.question,
        answer: scenario.question.answer,
        isDeepDive: false,
      });

      await test.step("Deep dive loop should apply the custom system prompt", async () => {
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

        expect(deepDiveResult.deepDiveCount).toBe(customPromptDeepDiveCount);
        expect(deepDiveResult.sawClosingRemark).toBe(true);
        expectCustomPromptAppliedToDeepDives(questionRecords);
      });

      await test.step("Interview should finish without visible issues", async () => {
        await expect(
          page.getByText(/The interview is now complete|面接が完了しました/i),
        ).toBeVisible({ timeout: 30000 });
        await expect(
          page.locator("main").getByText(
            /Audio playback failed|Audio initialization failed|Media Stream Error|Camera\/Microphone Error|An unexpected error occurred/i,
          ),
        ).toHaveCount(0);
      });
    });
  }
});
