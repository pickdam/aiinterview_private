import { LmStudioApi } from "@src/api/lm-studio-api";
import type { InterviewLanguage, SttProvider } from "@src/api/types";
import type { ReportingApi } from "@src/api/reporting-api";
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

type InteractiveMinMaxFlowConfig = {
  closingRemark: string;
  deepDiveMax: number;
  deepDiveMin: number;
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

const interactiveMinMaxFlowConfig = {
  closingRemark: "次に進みます",
  deepDiveMax: 3,
  deepDiveMin: 3,
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
} satisfies InteractiveMinMaxFlowConfig;

const totalLeadUpQuestions = 1;
const interactiveMinMaxTestTimeoutMs = 600000;

const seedInteractiveMinMaxInterview = async (
  apiAdmin: ReportingApi,
): Promise<string> => {
  const timestamp = Date.now();
  const seededEmail = `product-dev_qa+ai+interactive+minmax+${timestamp}@givery.co.jp`;

  const companyResp = await apiAdmin.createCompany({
    company_name: `E2E Interactive Min Max ${interactiveMinMaxFlowConfig.providerLabel} ${interactiveMinMaxFlowConfig.languageLabel} ${timestamp}`,
    stt_provider: interactiveMinMaxFlowConfig.sttProvider,
  });
  const { company_id: companyId } = await companyResp.json();

  const interview = await new InterviewBuilder(apiAdmin)
    .forCompany(companyId)
    .sendTo(seededEmail)
    .name(
      `E2E Interactive Min Max ${interactiveMinMaxFlowConfig.providerLabel} ${interactiveMinMaxFlowConfig.languageLabel} ${timestamp}`,
    )
    .description("E2E interactive deep-dive min/max configuration check")
    .language(interactiveMinMaxFlowConfig.language)
    .version(2)
    .interactive(true)
    .linkMaxUses(1)
    .withQuestion((questionBuilder) =>
      questionBuilder
        .transcript(interactiveMinMaxFlowConfig.question.question)
        .category("general")
        .language(interactiveMinMaxFlowConfig.language)
        .timeLimit(60)
        .deepDives(
          interactiveMinMaxFlowConfig.deepDiveMin,
          interactiveMinMaxFlowConfig.deepDiveMax,
        ),
    )
    .build();

  return interview.interviewUrl;
};

test.describe("Interview Flow - Interactive deep dive min/max @interview", () => {
  test("Japanese interactive flow should generate exactly three deep dives for a 3-3 configuration", async ({
    freshApiAdmin: apiAdmin,
    page,
  }, testInfo) => {
    test.setTimeout(interactiveMinMaxTestTimeoutMs);

    const interviewUrl = await seedInteractiveMinMaxInterview(apiAdmin);
    const applicantName = withBrowserApplicantPrefix(
      testInfo,
      `Interactive Min Max applicant - ${interactiveMinMaxFlowConfig.providerLabel} - ${interactiveMinMaxFlowConfig.languageLabel} - ${Date.now()}`,
    );
    const virtualMicrophone = new VirtualMicrophone(page, {
      speechStartDelayMs: 1500,
      voice: interactiveMinMaxFlowConfig.voice,
    });
    const flow = new InterviewFlowActions({ page, virtualMicrophone });
    const lmStudio = new LmStudioApi(page);
    const questionRecords: InteractiveFlowQuestionRecord[] = [];

    await virtualMicrophone.install();
    await page.goto(interviewUrl);

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
        questionData: interactiveMinMaxFlowConfig.question,
        questionIndex: 0,
        totalLeadUpQuestions,
        virtualMicrophone,
      });
    });
    questionRecords.push({
      question: interactiveMinMaxFlowConfig.question.question,
      answer: interactiveMinMaxFlowConfig.question.answer,
      isDeepDive: false,
    });

    await test.step("Deep dive loop should respect the 3-3 min/max configuration", async () => {
      const deepDiveResult = await handleDeepDiveLoop({
        closingRemark: interactiveMinMaxFlowConfig.closingRemark,
        deepDiveAdvanceMethod: "submit",
        flow,
        interviewLanguage: interactiveMinMaxFlowConfig.language,
        leadUpAdvanceMethod: "submit",
        leadUpQuestionIndex: 0,
        lmStudio,
        page,
        questionRecords,
        totalLeadUpQuestions,
        virtualMicrophone,
      });

      expect(deepDiveResult.deepDiveCount).toBe(
        interactiveMinMaxFlowConfig.deepDiveMax,
      );
      expect(deepDiveResult.sawClosingRemark).toBe(true);
      expect(questionRecords).toHaveLength(
        totalLeadUpQuestions + interactiveMinMaxFlowConfig.deepDiveMax,
      );
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
});
